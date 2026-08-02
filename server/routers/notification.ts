// ── Notification Router (extraído de routers.ts no PR #10 — só move) ────────
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  listTeamNotifications, markNotificationsAsRead, getUnreadNotificationCount,
} from "../db";

export const notificationRouter = router({
  list: protectedProcedure
    .input(z.object({ unreadOnly: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return listTeamNotifications(ctx.user.id, input?.unreadOnly);
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return getUnreadNotificationCount(ctx.user.id);
  }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markNotificationsAsRead(ctx.user.id);
    return { success: true };
  }),
});
