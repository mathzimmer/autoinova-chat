// ── Settings Router (extraído de routers.ts no PR #10 — só move) ────────────
import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb, getSetting, upsertSetting, getAllSettings } from "../db";
import { DEFAULT_PERSONALITY_PROMPT, CORE_PROMPT, COMMERCIAL_PROMPT, getCorePrompt, getCommercialPrompt, getPersonalityPrompt } from "../ai";
import { setDebounceDelay } from "../messageDebounce";
import { chatFlowSessions } from "../../drizzle/schema";

export const settingsRouter = router({
  /** Parametrização Completa da IA do CRM (Temperaturas, Auto-Tags, Linha do Tempo e Estoque) */
  getAiCrmConfig: protectedProcedure.query(async () => {
    const raw = await getSetting("ai_crm_config");
    const defaultConfig = {
      temperatureMap: {
        novo: "frio",
        interesse_definido: "morno",
        pagamento_definido: "quente",
        dados_pessoais: "quente",
        dados_troca: "quente",
        encaminhado_vendedor: "muito_quente",
        negociando: "muito_quente",
        fechado: "muito_quente",
        perdido: "frio",
      },
      autoTags: [
        { keyword: "financiamento", tag: "Simulação" },
        { keyword: "troca", tag: "Com Troca" },
        { keyword: "consórcio", tag: "Consórcio" },
        { keyword: "visita", tag: "Agendamento" },
      ],
      timelineLogging: {
        logStageChange: true,
        logDataCollected: true,
        logOnSellerTransfer: true,
        noteStyle: "objetivo",
      },
      stockRules: {
        preferSameStore: true,
        requirePhoto: false,
        autoSearchOnVehicleInterest: true,
      },
      funnelStageInstructions: {
        interesse_definido: "Pergunte sobre preferências de modelo, ano e uso quando o cliente demonstrar interesse.",
        pagamento_definido: "Identifique se prefere financiamento, à vista, consórcio ou troca.",
        dados_pessoais: "Colete o nome do cliente e a cidade onde reside.",
        dados_troca: "Pergunte modelo, ano e km do carro de troca se aplicável.",
      },
    };
    try {
      if (!raw) return defaultConfig;
      const parsed = JSON.parse(raw);
      return {
        ...defaultConfig,
        ...parsed,
        temperatureMap: { ...defaultConfig.temperatureMap, ...(parsed.temperatureMap || {}) },
        timelineLogging: { ...defaultConfig.timelineLogging, ...(parsed.timelineLogging || {}) },
        stockRules: { ...defaultConfig.stockRules, ...(parsed.stockRules || {}) },
      };
    } catch {
      return defaultConfig;
    }
  }),

  saveAiCrmConfig: adminProcedure
    .input(z.object({
      temperatureMap: z.record(z.string(), z.enum(["frio", "morno", "quente", "muito_quente"])),
      autoTags: z.array(z.object({
        keyword: z.string().min(1),
        tag: z.string().min(1),
      })),
      timelineLogging: z.object({
        logStageChange: z.boolean(),
        logDataCollected: z.boolean(),
        logOnSellerTransfer: z.boolean(),
        noteStyle: z.enum(["objetivo", "detalhado"]),
      }),
      stockRules: z.object({
        preferSameStore: z.boolean(),
        requirePhoto: z.boolean(),
        autoSearchOnVehicleInterest: z.boolean(),
      }),
      funnelStageInstructions: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ai_crm_config", JSON.stringify(input), ctx.user.id);
      return { success: true };
    }),

  /** Auto-qualificação de leads por IA (liga/desliga + teto de estágio) */
  getAutoQualify: protectedProcedure.query(async () => {
    return {
      enabled: (await getSetting("auto_qualify_enabled")) === "true",
      maxStage: (await getSetting("auto_qualify_max_stage")) || "negociando",
    };
  }),
  saveAutoQualify: adminProcedure
    .input(z.object({
      enabled: z.boolean(),
      maxStage: z.enum(["interesse_definido", "pagamento_definido", "dados_pessoais", "dados_troca", "encaminhado_vendedor", "negociando"]).default("negociando"),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("auto_qualify_enabled", input.enabled ? "true" : "false", ctx.user.id);
      await upsertSetting("auto_qualify_max_stage", input.maxStage, ctx.user.id);
      return { success: true };
    }),

  /** Estilo dos comentários da IA nos leads (curto/objetivo x detalhado) */
  /** Uso do disco do servidor (pra avisar antes de encher e quebrar mídia/uploads). */
  diskUsage: protectedProcedure.query(async () => {
    try {
      const { statfs } = await import("fs/promises");
      const s: any = await statfs("/");
      const bsize = Number(s.bsize) || 4096;
      const total = Number(s.blocks) * bsize;
      const freeRoot = Number(s.bfree) * bsize;
      const avail = Number(s.bavail) * bsize;   // livre para usuário comum
      const used = total - freeRoot;
      const percent = used + avail > 0 ? Math.round((used / (used + avail)) * 100) : 0;
      return { ok: true, totalBytes: total, usedBytes: used, availBytes: avail, percent };
    } catch (e) {
      return { ok: false, totalBytes: 0, usedBytes: 0, availBytes: 0, percent: 0, error: e instanceof Error ? e.message : "erro" };
    }
  }),

  getIaCommentStyle: protectedProcedure.query(async () => {
    return { style: (await getSetting("ia_comment_style")) || "objetivo" };
  }),
  saveIaCommentStyle: adminProcedure
    .input(z.object({ style: z.enum(["objetivo", "equilibrado", "detalhado"]) }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ia_comment_style", input.style, ctx.user.id);
      return { success: true };
    }),

  /** Nomes customizados das etapas do funil (ex.: renomear "Dados pessoais" → "Documentação") */
  getFunnelLabels: protectedProcedure.query(async () => {
    const raw = await getSetting("funnel_stage_labels");
    try { return raw ? (JSON.parse(raw) as Record<string, string>) : {}; } catch { return {}; }
  }),

  saveFunnelLabels: adminProcedure
    .input(z.record(z.string(), z.string().max(40)))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("funnel_stage_labels", JSON.stringify(input), ctx.user.id);
      return { success: true };
    }),

  /** Permissões de menu por cargo (admin sempre vê tudo) */
  getNavPermissions: protectedProcedure.query(async () => {
    const raw = await getSetting("nav_permissions");
    try { return raw ? (JSON.parse(raw) as Record<string, string[]>) : null; } catch { return null; }
  }),

  saveNavPermissions: adminProcedure
    .input(z.record(z.string(), z.array(z.string())))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("nav_permissions", JSON.stringify(input), ctx.user.id);
      return { success: true };
    }),

  /** Config de atendimento: CSAT + carência de reabertura */
  getAttendanceConfig: adminProcedure.query(async () => {
    const [csatEnabled, graceMinutes, csatWindow] = await Promise.all([
      getSetting("csat_enabled"),
      getSetting("reopen_grace_minutes"),
      getSetting("csat_window_minutes"),
    ]);
    return {
      csatEnabled: csatEnabled === "true",
      graceMinutes: Number(graceMinutes) || 30,
      csatWindowMinutes: Number(csatWindow) || 15,
    };
  }),

  saveAttendanceConfig: adminProcedure
    .input(z.object({
      csatEnabled: z.boolean(),
      graceMinutes: z.number().min(0).max(1440),
      csatWindowMinutes: z.number().min(1).max(120),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("csat_enabled", input.csatEnabled ? "true" : "false", ctx.user.id);
      await upsertSetting("reopen_grace_minutes", String(input.graceMinutes), ctx.user.id);
      await upsertSetting("csat_window_minutes", String(input.csatWindowMinutes), ctx.user.id);
      return { success: true };
    }),

  /** Ferramentas/config do Agente Geral (modo livre) */
  getFreeAgentConfig: protectedProcedure.query(async () => {
    const raw = await getSetting("ai_free_tools");
    let tools: string[] = [];
    try { tools = raw ? JSON.parse(raw) : []; } catch { tools = []; }
    return { enabledTools: tools };
  }),

  saveFreeAgentConfig: adminProcedure
    .input(z.object({ enabledTools: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ai_free_tools", JSON.stringify(input.enabledTools), ctx.user.id);
      return { success: true };
    }),

  getPrompt: protectedProcedure.query(async () => {
    // Return all layers (current values from DB or defaults)
    const corePrompt = await getCorePrompt();
    const commercialPrompt = await getCommercialPrompt();
    const personalityPrompt = await getPersonalityPrompt();

    // Check which layers are customized
    const customCore = await getSetting("ai_core_prompt");
    const customCommercial = await getSetting("ai_commercial_prompt");
    const customPersonality = await getSetting("ai_personality_prompt");
    const legacyPrompt = await getSetting("ai_prompt");

    return {
      corePrompt,
      commercialPrompt,
      personalityPrompt,
      coreIsCustom: !!(customCore && customCore.trim()),
      commercialIsCustom: !!(customCommercial && customCommercial.trim()),
      personalityIsCustom: !!(customPersonality && customPersonality.trim()) || !!(legacyPrompt && legacyPrompt.trim()),
      defaultCorePrompt: CORE_PROMPT,
      defaultCommercialPrompt: COMMERCIAL_PROMPT,
      defaultPersonalityPrompt: DEFAULT_PERSONALITY_PROMPT,
    };
  }),

  savePrompt: adminProcedure
    .input(z.object({
      layer: z.enum(["core", "commercial", "personality"]),
      prompt: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const keyMap: Record<string, string> = {
        core: "ai_core_prompt",
        commercial: "ai_commercial_prompt",
        personality: "ai_personality_prompt",
      };
      await upsertSetting(keyMap[input.layer], input.prompt, ctx.user.id);
      // Clear legacy prompt if saving personality (migration)
      if (input.layer === "personality") {
        const legacyPrompt = await getSetting("ai_prompt");
        if (legacyPrompt) {
          await upsertSetting("ai_prompt", "", ctx.user.id);
        }
      }
      return { success: true };
    }),

  resetPrompt: adminProcedure
    .input(z.object({
      layer: z.enum(["core", "commercial", "personality"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const keyMap: Record<string, string> = {
        core: "ai_core_prompt",
        commercial: "ai_commercial_prompt",
        personality: "ai_personality_prompt",
      };
      const defaultMap: Record<string, string> = {
        core: CORE_PROMPT,
        commercial: COMMERCIAL_PROMPT,
        personality: DEFAULT_PERSONALITY_PROMPT,
      };
      await upsertSetting(keyMap[input.layer], "", ctx.user.id);
      if (input.layer === "personality") {
        await upsertSetting("ai_prompt", "", ctx.user.id);
      }
      return { success: true, defaultPrompt: defaultMap[input.layer] };
    }),

  getAll: protectedProcedure.query(async () => {
    return getAllSettings();
  }),

  save: adminProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting(input.key, input.value, ctx.user.id);
      return { success: true };
    }),

  getDebounceDelay: protectedProcedure.query(async () => {
    const saved = await getSetting("debounce_delay_ms");
    return { delayMs: saved ? parseInt(saved, 10) : 8000 };
  }),

  saveDebounceDelay: adminProcedure
    .input(z.object({ delayMs: z.number().min(1000).max(30000) }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("debounce_delay_ms", String(input.delayMs), ctx.user.id);
      setDebounceDelay(input.delayMs);
      return { success: true, delayMs: input.delayMs };
    }),

  // ─── Global AI & Flows Toggle ─────────────────────────────────
  getGlobalStatus: protectedProcedure.query(async () => {
    const aiEnabled = await getSetting("ai_global_enabled");
    const flowsEnabled = await getSetting("flows_global_enabled");
    const matrizHidden = await getSetting("inbox_hide_matriz");
    return {
      aiEnabled: aiEnabled !== "false", // default true
      flowsEnabled: flowsEnabled !== "false", // default true
      matrizHidden: matrizHidden === "true", // default false (Matriz visível)
    };
  }),

  // Esconde/mostra a aba "Matriz (oficial)" no inbox — para quem migrou 100%
  // para instâncias/números próprios e não usa mais o número da Matriz.
  setMatrizHidden: adminProcedure
    .input(z.object({ hidden: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("inbox_hide_matriz", String(input.hidden), ctx.user.id);
      console.log(`[Settings] Aba Matriz ${input.hidden ? "ESCONDIDA" : "VISÍVEL"} por user ${ctx.user.id}`);
      return { success: true, hidden: input.hidden };
    }),

  setGlobalAI: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("ai_global_enabled", String(input.enabled), ctx.user.id);
      console.log(`[Settings] IA global ${input.enabled ? "ATIVADA" : "DESATIVADA"} por user ${ctx.user.id}`);
      return { success: true, enabled: input.enabled };
    }),

  setGlobalFlows: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await upsertSetting("flows_global_enabled", String(input.enabled), ctx.user.id);
      console.log(`[Settings] Fluxos globais ${input.enabled ? "ATIVADOS" : "DESATIVADOS"} por user ${ctx.user.id}`);
      // If disabling, pause all active flow sessions
      if (!input.enabled) {
        const db = await getDb();
        if (db) {
          await db.update(chatFlowSessions)
            .set({ status: "completed" })
            .where(eq(chatFlowSessions.status, "active"));
          console.log(`[Settings] Todas as sess\u00f5es de fluxo ativas foram pausadas`);
        }
      }
      return { success: true, enabled: input.enabled };
    }),
});
