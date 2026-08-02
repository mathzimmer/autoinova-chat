// ── Message Router (extraído de routers.ts no PR #10 — só move) ─────────────
import { z } from "zod";
import crypto from "crypto";
import { and, eq, like, or } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDb, listMessages, createMessage, getConversationById, updateConversation,
  getLeadByConversationId, updateMessageExternalId, setWindowExpired,
} from "../db";
import { sendTextMessage, sendImageMessage, sendAudioMessage, sendVideoMessage, isConfigured as isWhatsAppConfigured } from "../whatsapp";
import { sendPlatformMessage, isInstagramConfigured, isFacebookConfigured } from "../instagramFacebook";
import { storagePut } from "../storage";
import { convertWebmToOgg, needsConversionForWhatsApp, isWebmAudio } from "../audioConverter";
import { invokeLLM } from "../_core/llm";
import { transcribeAudio } from "../_core/voiceTranscription";
import { emitNewMessage, emitConversationUpdate } from "../socket";

export const messageRouter = router({
  list: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return listMessages(input.conversationId, input.limit);
    }),

  /** Envia fotos de um veículo do estoque (URLs do JSON sincronizado) */
  sendVehiclePhotos: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      vehicleId: z.number(),
      imageUrls: z.array(z.string().url()).min(1).max(10),
      caption: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const conv = await getConversationById(input.conversationId);
      if (!conv?.phone) throw new Error("Conversa sem telefone");

      // Atendente assume a conversa ao enviar fotos
      await updateConversation(input.conversationId, { aiActive: false, assignedTo: ctx.user.id });

      // Roteia por canal da conversa (bug: antes ia sempre pela Matriz oficial)
      const zConvId = conv.channel === "zernio" ? ((conv.metadata as any)?.zernioConversationId as string | undefined) : undefined;
      const zAccId = conv.channel === "zernio" ? (((conv.metadata as any)?.zernioAccountId as string | undefined) || (conv as any).instanceName || undefined) : undefined;
      const evoInstance = conv.channel === "evolution" ? (conv as any).instanceName as string | undefined : undefined;
      const evoJid = conv.channel === "evolution" ? (((conv.metadata as any)?.evolutionLidJid as string) || ((conv.metadata as any)?.evolutionRemoteJid as string) || conv.phone) : conv.phone;

      let sent = 0;
      const errors: string[] = [];
      for (let i = 0; i < input.imageUrls.length; i++) {
        const url = input.imageUrls[i];
        const caption = i === 0 ? (input.caption || "") : "";
        let result: { success: boolean; messageId?: string; error?: string };
        if (conv.channel === "zernio") {
          if (!zConvId) { result = { success: false, error: "Zernio: conversa sem sessão ativa (cliente precisa ter mandado a 1ª mensagem)" }; }
          else {
            const { zernioSendMedia } = await import("../zernioService");
            result = await zernioSendMedia(zConvId, url, "image", zAccId, caption);
          }
        } else if (conv.channel === "evolution" && evoInstance) {
          const { evolutionSendMedia } = await import("../evolutionService");
          try {
            const r = await evolutionSendMedia(evoInstance, evoJid!, url, "image", caption);
            result = { success: true, messageId: (r as any)?.key?.id ? `evo_${(r as any).key.id}` : undefined };
          } catch (e) { result = { success: false, error: e instanceof Error ? e.message : "erro" }; }
        } else if (conv.channel === "whatsapp" && (conv as any).instanceName) {
          const { sendMediaFromNumber } = await import("../whatsappMultiNumber");
          result = await sendMediaFromNumber((conv as any).instanceName, conv.phone, url, "image", caption);
        } else {
          result = await sendImageMessage(conv.phone, url, caption);
        }
        if (result.success) {
          const msg = await createMessage({
            conversationId: input.conversationId,
            content: caption || "[Foto do veículo]",
            senderType: "agent",
            senderName: ctx.user.name || "Atendente",
            messageType: "image",
            metadata: { mediaUrl: url, caption, vehicleId: input.vehicleId },
            externalId: result.messageId,
          });
          emitNewMessage(input.conversationId, msg);
          sent++;
        } else {
          errors.push(result.error || "erro");
        }
        // Delay entre fotos para manter a ordem no WhatsApp
        if (i < input.imageUrls.length - 1) await new Promise(r => setTimeout(r, 900));
      }
      if (sent === 0) throw new Error("Nenhuma foto enviada: " + (errors[0] || "erro desconhecido"));
      return { sent, failed: errors.length };
    }),

  /** IA sugere a próxima resposta do atendente com base no histórico */
  suggestReply: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      historyCount: z.number().min(2).max(50).default(10),
    }))
    .mutation(async ({ input }) => {
      const msgs = await listMessages(input.conversationId, input.historyCount);
      if (!msgs || msgs.length === 0) throw new Error("Sem histórico nesta conversa");

      const lead = await getLeadByConversationId(input.conversationId);
      const ordered = [...msgs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const transcript = ordered
        .filter(m => m.senderType !== "internal")
        .map(m => {
          const role = m.senderType === "customer" ? "Cliente" : m.senderType === "bot" ? "IA" : "Atendente";
          return `${role}: ${m.content}`;
        }).join("\n");

      const leadContext = lead
        ? `\nContexto do lead: interesse em ${lead.vehicleInterest || "não definido"}; etapa do funil: ${lead.funnelStatus}; pagamento: ${lead.paymentMethod || "não informado"}; troca: ${lead.hasTrade ? lead.tradeVehicle || "sim" : "não"}.`
        : "";

      const { invokeLLM } = await import("../_core/llm");
      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Você é um vendedor experiente de uma concessionária de veículos (Auto Inova). Com base no histórico da conversa, sugira a PRÓXIMA mensagem que o atendente deve enviar ao cliente. Regras: responda APENAS com o texto da mensagem sugerida (sem aspas, sem explicações, sem markdown); tom cordial e direto, português do Brasil; objetivo: avançar a venda (qualificar, agendar test-drive, fechar); no máximo 3 frases.${leadContext}`,
          },
          { role: "user", content: `Histórico (últimas ${ordered.length} mensagens):\n\n${transcript}\n\nSugira a próxima resposta do atendente:` },
        ],
      });
      const raw = resp.choices?.[0]?.message?.content;
      const suggestion = (typeof raw === "string" ? raw : "").trim();
      if (!suggestion) throw new Error("A IA não retornou sugestão");
      return { suggestion };
    }),

  send: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      content: z.string().min(1),
      senderType: z.enum(["agent", "bot", "internal"]).default("agent"),
    }))
    .mutation(async ({ input, ctx }) => {
      // Nota interna: visível só para o time, NUNCA vai para o cliente
      if (input.senderType === "internal") {
        const note = await createMessage({
          conversationId: input.conversationId,
          content: input.content,
          senderType: "internal",
          senderName: ctx.user.name || "Atendente",
          messageType: "text",
        });
        emitNewMessage(input.conversationId, note);
        return note;
      }

      // When agent sends a message, automatically pause AI
      if (input.senderType === "agent") {
        await updateConversation(input.conversationId, {
          aiActive: false,
          assignedTo: ctx.user.id,
        });
        emitConversationUpdate(input.conversationId, { aiActive: false, assignedTo: ctx.user.id });
      }

      const message = await createMessage({
        conversationId: input.conversationId,
        content: input.content,
        senderType: input.senderType,
        senderName: ctx.user.name || "Atendente",
        messageType: "text",
      });

      emitNewMessage(input.conversationId, message);

      // Send message to the correct platform
      let deliveryStatus: "sent" | "failed" | null = null;
      let deliveryError: string | null = null;
      let windowExpired = false;

      const conv = await getConversationById(input.conversationId);
      if (conv) {
        try {
          let sendResult: { success: boolean; messageId?: string; error?: string } = { success: false, error: "No platform" };

          if (conv.channel === "evolution" && (conv as any).instanceName && conv.phone) {
            // Conversa de instância Evolution: envia pela API da instância.
            // Usa o remoteJid original (essencial para contatos @lid, onde o
            // "telefone" é um ID interno do WhatsApp e não roteia sozinho).
            const { evolutionSendText } = await import("../evolutionService");
            let toJid = ((conv.metadata as any)?.evolutionRemoteJid as string) || "";
            if (!toJid) {
              // Conversa espelhada antes do fix do metadata: busca o JID na tabela Evolution
              try {
                const db = await getDb();
                if (db) {
                  const { evolutionConversations } = await import("../../drizzle/schema");
                  const { eq, and: andOp, or: orOp, like: likeOp } = await import("drizzle-orm");
                  const evoConv = (await db.select().from(evolutionConversations)
                    .where(andOp(
                      eq(evolutionConversations.instanceName, (conv as any).instanceName),
                      orOp(eq(evolutionConversations.phone, conv.phone), likeOp(evolutionConversations.remoteJid, `${conv.phone}@%`)),
                    )).limit(1))[0];
                  if (evoConv?.remoteJid) {
                    toJid = evoConv.remoteJid;
                    // Salva no metadata para os próximos envios
                    await updateConversation(input.conversationId, {
                      metadata: { ...((conv.metadata as any) || {}), evolutionRemoteJid: toJid },
                    } as any);
                  }
                }
              } catch { /* fallback abaixo */ }
            }
            if (!toJid) toJid = conv.phone;
            // Endereçamento LID: contatos migrados só aceitam envio pelo @lid
            // (enviar pelo número gera erro 463 assíncrono no WhatsApp).
            // Tenta o @lid primeiro quando conhecido; se a Evolution recusar
            // sincronamente, cai para o JID/número tradicional.
            const lidJid = (conv.metadata as any)?.evolutionLidJid as string | undefined;
            const candidates = Array.from(new Set([lidJid, toJid].filter(Boolean))) as string[];
            sendResult = { success: false, error: "Sem destino" };
            for (const candidate of candidates) {
              console.log(`[EvolutionSend] Tentando enviar: instancia=${(conv as any).instanceName}, toJid=${candidate}, conv=${conv.id}`);
              try {
                const evoResult = await evolutionSendText((conv as any).instanceName, candidate, input.content);
                const evoMsgId = (evoResult as any)?.key?.id;
                console.log(`[EvolutionSend] ✅ Aceito pela Evolution: msgId=${evoMsgId || "?"} (via ${candidate})`);
                sendResult = { success: true, messageId: evoMsgId ? `evo_${evoMsgId}` : undefined };
                break;
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : "Falha no envio Evolution";
                console.error(`[EvolutionSend] ❌ Recusado (${candidate}): ${errMsg}`);
                sendResult = { success: false, error: errMsg };
              }
            }
          } else if (conv.channel === "zernio") {
            // Conversa Zernio: responde via API do Zernio dentro da conversa dele.
            const zConvId = (conv.metadata as any)?.zernioConversationId as string | undefined;
            const zAccId = ((conv.metadata as any)?.zernioAccountId as string | undefined) || (conv as any).instanceName || undefined;
            if (!zConvId) {
              sendResult = { success: false, error: "Conversa sem zernioConversationId (só é possível responder após a 1ª mensagem do cliente)" };
            } else {
              const { zernioReply } = await import("../zernioService");
              sendResult = await zernioReply(zConvId, input.content, zAccId);
            }
          } else if (conv.channel === "whatsapp" && (conv as any).instanceName && conv.phone) {
            // Número oficial ADICIONAL: envia pelo token daquele número
            const { sendTextFromNumber } = await import("../whatsappMultiNumber");
            sendResult = await sendTextFromNumber((conv as any).instanceName, conv.phone, input.content);
          } else if (conv.channel === "whatsapp" && isWhatsAppConfigured() && conv.phone) {
            sendResult = await sendTextMessage(conv.phone, input.content);
          } else if (conv.channel === "instagram" && isInstagramConfigured() && conv.platformUserId) {
            sendResult = await sendPlatformMessage("instagram", conv.platformUserId, input.content);
          } else if (conv.channel === "facebook" && isFacebookConfigured() && conv.platformUserId) {
            sendResult = await sendPlatformMessage("facebook", conv.platformUserId, input.content);
          }

          if (sendResult.success && sendResult.messageId) {
            await updateMessageExternalId(message.id, sendResult.messageId);
            deliveryStatus = "sent";
          } else if (sendResult.error) {
            deliveryError = sendResult.error;
            deliveryStatus = "failed";

            // Detect 24h window expiry (WhatsApp only)
            if (conv.channel === "whatsapp") {
              const isWindowError = sendResult.error.includes('131047') || 
                sendResult.error.includes('Re-engagement') ||
                sendResult.error.includes('outside the allowed window');
              
              if (isWindowError) {
                windowExpired = true;
                await setWindowExpired(input.conversationId, true);
                console.log(`[WhatsApp] 24h window expired for conversation ${input.conversationId}. Template required.`);
              }
            }

            // System message about delivery failure
            await createMessage({
              conversationId: input.conversationId,
              content: `\u26a0\ufe0f Mensagem não entregue: ${deliveryError}`,
              senderType: "bot",
              senderName: "Sistema",
              messageType: "system",
            }).then(sysMsg => {
              if (sysMsg) emitNewMessage(input.conversationId, sysMsg);
            }).catch(() => {});
          }
        } catch (err: any) {
          console.error(`[${conv.channel}] Failed to send agent message:`, err);
          deliveryError = err.message || "Erro desconhecido";
          deliveryStatus = "failed";
        }
      }

      return { ...message, deliveryStatus, deliveryError, windowExpired };
    }),

  sendMedia: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      mediaType: z.enum(["image", "audio", "video"]),
      base64Data: z.string(), // base64 encoded file data
      mimeType: z.string(),
      fileName: z.string().optional(),
      caption: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // When agent sends media, automatically pause AI
      await updateConversation(input.conversationId, {
        aiActive: false,
        assignedTo: ctx.user.id,
      });
      emitConversationUpdate(input.conversationId, { aiActive: false, assignedTo: ctx.user.id });

      // Upload original to S3 (for chat display)
      const buffer = Buffer.from(input.base64Data, "base64");
      const uploadMimeType = input.mimeType;
      const uploadExt = input.mimeType.split("/")[1]?.split(";")[0] || "bin";

      console.log(`[SendMedia] Received ${input.mediaType}: mimeType=${input.mimeType}, size=${buffer.length} bytes`);

      // === AUDIO CONVERSION FOR WHATSAPP ===
      // RULE: NEVER send webm to WhatsApp. Always convert to ogg first.
      // If conversion fails, audio is NOT sent to WhatsApp (but still saved in chat).
      // Strategy: Upload OGG directly to WhatsApp Media API (recommended by Meta)
      // instead of using hosted URL links (which can be inaccessible).
      let whatsappAudioUrl: string | null = null;
      let whatsappAudioBuffer: Buffer | null = null;
      let audioConversionFailed = false;

      if (input.mediaType === "audio" && needsConversionForWhatsApp(input.mimeType)) {
        console.log(`[SendMedia] ⚠️ Audio needs conversion: ${input.mimeType} is NOT accepted by WhatsApp`);
        console.log(`[SendMedia] Original format: ${input.mimeType}`);
        console.log(`[SendMedia] Target format: audio/ogg (opus codec)`);

        try {
          const oggBuffer = await convertWebmToOgg(buffer);
          whatsappAudioBuffer = oggBuffer;
          
          // Also upload to S3 for backup/reference
          const oggRandomSuffix = crypto.randomBytes(8).toString("hex");
          const oggFileKey = `chat-media/${ctx.user.id}/${Date.now()}-${oggRandomSuffix}.ogg`;
          const { url: oggUrl } = await storagePut(oggFileKey, oggBuffer, "audio/ogg");
          whatsappAudioUrl = oggUrl;

          console.log(`[SendMedia] ✅ Audio converted successfully`);
          console.log(`[SendMedia]   Original: ${input.mimeType} (${buffer.length} bytes)`);
          console.log(`[SendMedia]   Converted: audio/ogg (${oggBuffer.length} bytes)`);
          console.log(`[SendMedia]   S3 backup URL: ${oggUrl}`);
          console.log(`[SendMedia]   Will upload directly to WhatsApp Media API`);
        } catch (err: any) {
          audioConversionFailed = true;
          console.error(`[SendMedia] ❌ Audio conversion FAILED: ${err.message}`);
          console.error(`[SendMedia] ❌ Audio will NOT be sent to WhatsApp (webm is not accepted)`);
        }
      } else if (input.mediaType === "audio") {
        // Audio is already in a WhatsApp-compatible format, keep the buffer for direct upload
        whatsappAudioBuffer = buffer;
        console.log(`[SendMedia] Audio already in compatible format: ${input.mimeType}`);
      }

      // Upload original file to S3 (for chat display in the CRM)
      const randomSuffix = crypto.randomBytes(8).toString("hex");
      const fileKey = `chat-media/${ctx.user.id}/${Date.now()}-${randomSuffix}.${uploadExt}`;
      const { url: mediaUrl } = await storagePut(fileKey, buffer, uploadMimeType);
      console.log(`[SendMedia] Original file uploaded to S3: ${mediaUrl}`);

      // Save message to database
      const content = input.mediaType === "image"
        ? (input.caption || "[Imagem enviada]")
        : input.mediaType === "video"
        ? (input.caption || "[Vídeo enviado]")
        : "[Mensagem de voz]";

      const message = await createMessage({
        conversationId: input.conversationId,
        content,
        senderType: "agent",
        senderName: ctx.user.name || "Atendente",
        messageType: input.mediaType,
        metadata: { mediaUrl, mimeType: input.mimeType, fileName: input.fileName },
      });

      emitNewMessage(input.conversationId, message);

      // Transcreve o ÁUDIO que o atendente envia (assíncrono) → a IA usa no contexto
      if (input.mediaType === "audio") {
        const audioForTranscript = whatsappAudioUrl || mediaUrl;
        (async () => {
          try {
            const t = await transcribeAudio({ audioUrl: audioForTranscript, language: "pt", prompt: "Transcrever mensagem de voz do vendedor sobre veículos e automóveis" });
            if ("text" in t && t.text) {
              const { updateMessageMetadata } = await import("../db");
              await updateMessageMetadata(message.id, { transcribedText: t.text });
              try { emitConversationUpdate(input.conversationId, {}); } catch { /* opcional */ }
              console.log(`[SendMedia] áudio do atendente transcrito: "${t.text.slice(0, 60)}"`);
            }
          } catch (e) { console.error("[SendMedia] transcrição outbound falhou:", e); }
        })();
      }

      // === ENVIO PARA INSTÂNCIA EVOLUTION ===
      const convForSend = await getConversationById(input.conversationId);
      if (convForSend?.channel === "evolution" && (convForSend as any).instanceName && convForSend.phone) {
        const { evolutionSendMedia, evolutionSendAudio } = await import("../evolutionService");
        const meta = (convForSend.metadata as any) || {};
        const toJid = (meta.evolutionLidJid as string) || (meta.evolutionRemoteJid as string) || convForSend.phone;
        const instName = (convForSend as any).instanceName as string;

        const sendPromise = input.mediaType === "audio"
          // Áudio: endpoint dedicado de VOZ (ptt) com o ogg convertido
          ? evolutionSendAudio(instName, toJid, whatsappAudioUrl || mediaUrl)
          : evolutionSendMedia(instName, toJid, mediaUrl, input.mediaType, input.caption, input.fileName);

        sendPromise.then((r) => {
          console.log(`[SendMedia] ✅ Evolution ${input.mediaType} enviado:`, JSON.stringify(r).substring(0, 200));
        }).catch((err) => {
          console.error(`[SendMedia] ❌ Evolution ${input.mediaType} falhou:`, err);
        });
        return message;
      }

      // === ENVIO PARA INSTÂNCIA ZERNIO (coexistência oficial) ===
      if (convForSend?.channel === "zernio") {
        const zConvId = (convForSend.metadata as any)?.zernioConversationId as string | undefined;
        const zAccId = ((convForSend.metadata as any)?.zernioAccountId as string | undefined) || (convForSend as any).instanceName || undefined;
        if (!zConvId) {
          console.error("[SendMedia] Zernio sem zernioConversationId — não é possível enviar mídia");
        } else {
          const { zernioSendMedia } = await import("../zernioService");
          const attType = input.mediaType === "image" ? "image" : input.mediaType === "video" ? "video" : "audio";
          // Áudio de voz precisa ser .ogg opus → usa a versão convertida (whatsappAudioUrl)
          const urlToSend = input.mediaType === "audio" ? (whatsappAudioUrl || mediaUrl) : mediaUrl;
          zernioSendMedia(zConvId, urlToSend, attType as any, zAccId, input.caption, input.mediaType === "audio")
            .then((r) => console.log(`[SendMedia] ${r.success ? "✅" : "❌"} Zernio ${input.mediaType}:`, r.error || r.messageId))
            .catch((err) => console.error(`[SendMedia] ❌ Zernio ${input.mediaType} falhou:`, err));
        }
        return message;
      }

      // === ENVIO POR NÚMERO OFICIAL ADICIONAL (multi-número) ===
      if (convForSend?.channel === "whatsapp" && (convForSend as any).instanceName && convForSend.phone) {
        const { sendMediaFromNumber } = await import("../whatsappMultiNumber");
        const urlToSend = input.mediaType === "audio" ? (whatsappAudioUrl || mediaUrl) : mediaUrl;
        sendMediaFromNumber((convForSend as any).instanceName, convForSend.phone, urlToSend, input.mediaType, input.caption)
          .then((r) => console.log(`[SendMedia] ${r.success ? "✅" : "❌"} Oficial ${input.mediaType}:`, r.error || r.messageId))
          .catch((err) => console.error(`[SendMedia] ❌ Oficial ${input.mediaType} falhou:`, err));
        return message;
      }

      // === SEND TO WHATSAPP (oficial) ===
      if (isWhatsAppConfigured()) {
        const conv = convForSend;
        console.log(`[SendMedia] WhatsApp configured. Conv: ${conv?.id}, channel: ${conv?.channel}, phone: ${conv?.phone}`);

        if (conv && conv.channel === "whatsapp" && conv.phone) {
          if (input.mediaType === "image") {
            console.log(`[SendMedia] Sending image to WhatsApp: phone=${conv.phone}, URL=${mediaUrl}`);
            sendImageMessage(conv.phone, mediaUrl, input.caption).then((result) => {
              console.log(`[SendMedia] WhatsApp image result:`, JSON.stringify(result));
            }).catch((err) => {
              console.error("[WhatsApp] Failed to send agent image:", err);
            });

          } else if (input.mediaType === "video") {
            console.log(`[SendMedia] Sending video to WhatsApp: phone=${conv.phone}, URL=${mediaUrl}`);
            sendVideoMessage(conv.phone, mediaUrl, input.caption).then((result) => {
              console.log(`[SendMedia] WhatsApp video result:`, JSON.stringify(result));
            }).catch((err) => {
              console.error("[WhatsApp] Failed to send agent video:", err);
            });

          } else if (input.mediaType === "audio") {
            // STRICT RULE: Never send webm to WhatsApp
            if (audioConversionFailed) {
              console.error(`[SendMedia] ❌ BLOCKED: Audio NOT sent to WhatsApp because conversion failed`);
              console.error(`[SendMedia] ❌ Original format ${input.mimeType} is not accepted by WhatsApp`);
            } else if (isWebmAudio(input.mimeType) && !whatsappAudioUrl) {
              console.error(`[SendMedia] ❌ BLOCKED: webm audio cannot be sent to WhatsApp without conversion`);
            } else {
              // Use converted ogg URL, or original if it's already in a WhatsApp-compatible format
              const audioUrlForWhatsApp = whatsappAudioUrl || mediaUrl;
              const finalMime = whatsappAudioUrl ? "audio/ogg" : input.mimeType;
              console.log(`[SendMedia] Sending audio to WhatsApp:`);
              console.log(`[SendMedia]   Phone: ${conv.phone}`);
              console.log(`[SendMedia]   URL: ${audioUrlForWhatsApp}`);
              console.log(`[SendMedia]   MIME: ${finalMime}`);
              console.log(`[SendMedia]   Was converted: ${!!whatsappAudioUrl}`);

              // Pass the buffer for direct upload to WhatsApp Media API (recommended)
              sendAudioMessage(conv.phone, audioUrlForWhatsApp, whatsappAudioBuffer || undefined).then((result) => {
                console.log(`[SendMedia] ✅ WhatsApp audio result:`, JSON.stringify(result));
              }).catch((err) => {
                console.error(`[WhatsApp] ❌ Failed to send agent audio:`, err);
              });
            }
          }
        }
      } else {
        console.log(`[SendMedia] WhatsApp not configured, skipping delivery`);
      }

      return message;
    }),
});
