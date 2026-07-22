/**
 * Sincronizador de recuperação do Zernio.
 *
 * Enquanto o CRM está fora do ar (durante um deploy, por ex.), os webhooks do
 * Zernio falham e as mensagens não são espelhadas. A mensagem NÃO se perde — ela
 * continua no WhatsApp/Zernio. Este sincronizador puxa as conversas e mensagens
 * recentes de cada instância Zernio e insere o que faltou.
 *
 * É seguro rodar quantas vezes quiser: o mirror já deduplica por externalId e por
 * conteúdo, então mensagens que já existem são ignoradas.
 *
 * Roda automaticamente ~30s após o boot (cobre a janela do deploy) e como rede de
 * segurança a cada 15 min. Também pode ser disparado manualmente (zernio.sync).
 */
import { getDb } from "./db";
import { listZernioInstances, mirrorZernioMessage } from "./db";
import { zernioListConversations, zernioFetchMessages, parseZernioMessage, hostZernioMedia } from "./zernioService";
import { withJobLock } from "./jobLock";

export async function runZernioSync(opts?: { convsPerAccount?: number; msgsPerConv?: number }): Promise<{ inserted: number }> {
  const db = await getDb();
  if (!db) return { inserted: 0 };

  const convsPerAccount = opts?.convsPerAccount ?? 40;
  const msgsPerConv = opts?.msgsPerConv ?? 15;
  let inserted = 0;

  let instances: any[] = [];
  try { instances = await listZernioInstances(); } catch { return { inserted: 0 }; }
  if (!instances.length) return { inserted: 0 };
  console.log(`[ZernioSync] iniciando (${instances.length} instância(s))`);
  let debugged = false;

  for (const inst of instances) {
    const accountId = (inst as any).accountId as string;
    if (!accountId) continue;

    let convs: any[] = [];
    try {
      convs = await zernioListConversations(accountId, convsPerAccount);
    } catch (e) {
      console.error(`[ZernioSync] listar conversas falhou (${accountId}):`, e instanceof Error ? e.message : e);
      continue; // endpoint/formato pode variar — segue para a próxima conta
    }

    for (const conv of convs) {
      const zConvId = String(conv?.id || conv?._id || conv?.conversationId || "");
      if (!zConvId) continue;

      let msgs: any[] = [];
      try {
        msgs = await zernioFetchMessages(zConvId, accountId, msgsPerConv);
      } catch (e) {
        console.error(`[ZernioSync] mensagens falhou (conv ${zConvId}):`, e instanceof Error ? e.message : e);
        continue;
      }

      for (const m of msgs) {
        try {
          // DIAGNÓSTICO: mostra o formato cru da 1ª mensagem (para ajustar o parser)
          if (!debugged) { debugged = true; console.log(`[ZernioSync] amostra de mensagem crua:`, JSON.stringify(m).slice(0, 900)); }

          // Reaproveita o MESMO parser do webhook, montando um "payload" equivalente.
          const parsed = parseZernioMessage({ message: m, conversation: conv, account: { id: accountId } });
          if (!parsed.phone && !parsed.conversationId) continue;
          // Não grava mensagem de texto vazia (evita poluir o inbox com "[text]")
          if (parsed.messageType === "text" && !(parsed.content || "").trim()) continue;

          // Mídia: re-hospeda no S3 (mesma lógica do webhook); se falhar, guarda a
          // URL crua — o proxy do inbox resolve na renderização.
          let mediaUrl = parsed.mediaUrl;
          if (parsed.mediaUrl && parsed.messageType !== "text") {
            const kind = parsed.messageType === "audio" ? "audio"
              : parsed.messageType === "image" ? "image"
              : parsed.messageType === "video" ? "video" : "document";
            const hosted = await hostZernioMedia(parsed.mediaUrl, parsed.mimeType || "", kind as any, accountId).catch(() => undefined);
            if (hosted) mediaUrl = hosted;
          }

          const result = await mirrorZernioMessage({
            zernioConversationId: parsed.conversationId,
            accountId: parsed.accountId || accountId,
            phone: parsed.phone,
            contactName: parsed.name || parsed.senderName,
            content: parsed.content,
            messageType: parsed.messageType,
            direction: parsed.direction,
            senderName: parsed.senderName || parsed.name || parsed.phone || "Cliente",
            mediaUrl,
            externalId: parsed.externalId,
            timestamp: parsed.timestamp,
            dedupeContent: true,   // evita duplicar o que o webhook já gravou
          });
          // mirror retorna null quando é duplicada (externalId já existe)
          if (result && !result.isDuplicate) inserted++;
        } catch (e) {
          console.error(`[ZernioSync] falha ao espelhar mensagem:`, e instanceof Error ? e.message : e);
        }
      }
    }
  }

  if (inserted > 0) console.log(`[ZernioSync] recuperou ${inserted} mensagem(ns) que faltavam`);
  return { inserted };
}

/** Versão com lock (evita duas execuções simultâneas). */
export async function runZernioSyncLocked(opts?: { convsPerAccount?: number; msgsPerConv?: number }): Promise<void> {
  await withJobLock("zernio_sync", async () => { await runZernioSync(opts); }).catch((e) =>
    console.error("[ZernioSync] erro:", e),
  );
}
