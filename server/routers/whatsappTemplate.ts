// ── WhatsApp Templates Router (extraído de routers.ts no PR #10 — só move) ──
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { createMessage, getConversationByPhone, updateMessageExternalId, setWindowExpired } from "../db";
import { emitNewMessage } from "../socket";
import {
  listTemplates, sendWhatsAppTemplate, isTemplateApproved, isTemplatesConfigured,
} from "../whatsappTemplates";

export const whatsappTemplateRouter = router({
  // Check if templates are configured
  isConfigured: adminProcedure.query(() => {
    return isTemplatesConfigured();
  }),

  // List available templates
  list: adminProcedure.query(async () => {
    return listTemplates();
  }),

  // Check if a template is approved
  checkApproval: adminProcedure
    .input(z.object({ templateName: z.string() }))
    .query(async ({ input }) => {
      const approved = await isTemplateApproved(input.templateName);
      return { approved };
    }),

  // Send a template message manually and save it in the conversation
  send: adminProcedure
    .input(z.object({
      phone: z.string(),
      templateName: z.string(),
      bodyParams: z.array(z.string()).default([]),
      language: z.string().default("pt_BR"),
      conversationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await sendWhatsAppTemplate(
        input.phone,
        input.templateName,
        input.bodyParams,
        input.language
      );
      if (!result.success) throw new Error(result.error ?? "Falha ao enviar template");

      // Find the conversation by phone if conversationId not provided
      let conversationId = input.conversationId;
      if (!conversationId) {
        const conv = await getConversationByPhone(input.phone);
        conversationId = conv?.id;
      }

      // Save the template message in the conversation
      if (conversationId) {
        // Build a human-readable content for the template message
        let templateContent = `[Template: ${input.templateName}]`;
        if (input.bodyParams.length > 0) {
          templateContent += `\nPar\u00e2metros: ${input.bodyParams.join(", ")}`;
        }

        const msg = await createMessage({
          conversationId,
          content: templateContent,
          senderType: "bot",
          senderName: "Sistema",
          messageType: "text",
          metadata: {
            isTemplate: true,
            templateName: input.templateName,
            templateParams: input.bodyParams,
            templateLanguage: input.language,
          },
        });

        // Save the wamid for delivery tracking
        if (result.messageId && msg) {
          await updateMessageExternalId(msg.id, result.messageId);
        }

        // Reset window expired flag since template reopens the window
        await setWindowExpired(conversationId, false);

        // Emit the new message via socket
        emitNewMessage(conversationId, msg);
      }

      return result;
    }),
});
