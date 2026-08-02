// ── Seller Router (extraído de routers.ts no PR #10 — só move, não muda) ────
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  listSellers, listActiveSellers, getSellerById, createSeller, updateSeller, deleteSeller,
  getNextSellerInQueue, createSellerAssignment, listSellerAssignments, updateSellerAssignment,
  getStoreLocationByVehicleId, getDistinctStoreLocations,
} from "../db";

export const sellerRouter = router({
  list: protectedProcedure
    .input(z.object({ storeLocation: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return listSellers(input?.storeLocation);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const seller = await getSellerById(input.id);
      if (!seller) throw new Error("Seller not found");
      return seller;
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      phone: z.string().min(1),
      photoUrl: z.string().optional(),
      storeLocation: z.string().min(1),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const id = await createSeller({
        name: input.name,
        phone: input.phone,
        photoUrl: input.photoUrl || null,
        storeLocation: input.storeLocation,
        sortOrder: input.sortOrder,
        isActive: true,
        totalAssignments: 0,
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      phone: z.string().min(1).optional(),
      photoUrl: z.string().nullable().optional(),
      storeLocation: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateSeller(id, data as any);
      return { success: true };
    }),

  // Upload seller photo to S3
  uploadPhoto: adminProcedure
    .input(z.object({
      sellerId: z.number(),
      photoBase64: z.string(), // base64 encoded image
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ input }) => {
      const { storagePut } = await import("../storage");
      const buffer = Buffer.from(input.photoBase64, "base64");
      const ext = input.mimeType.includes("png") ? "png" : "jpg";
      const randomSuffix = Math.random().toString(36).substring(2, 10);
      const fileKey = `sellers/${input.sellerId}-photo-${randomSuffix}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);
      await updateSeller(input.sellerId, { photoUrl: url });
      return { url };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteSeller(input.id);
      return { success: true };
    }),

  // Get distinct store locations from vehicles
  storeLocations: protectedProcedure.query(async () => {
    return getDistinctStoreLocations();
  }),

  // Assign next seller from queue for a store
  assignNext: protectedProcedure
    .input(z.object({
      storeLocation: z.string().min(1),
      conversationId: z.number(),
      vehicleId: z.number().optional(),
      customerPhone: z.string().optional(),
      customerName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const seller = await getNextSellerInQueue(input.storeLocation);
      if (!seller) {
        throw new Error(`Nenhum vendedor ativo na loja: ${input.storeLocation}`);
      }

      // Create assignment record
      const assignmentId = await createSellerAssignment({
        sellerId: seller.id,
        conversationId: input.conversationId,
        storeLocation: input.storeLocation,
        vehicleId: input.vehicleId || null,
        customerPhone: input.customerPhone || null,
        customerName: input.customerName || null,
        status: "pending",
      });

      return { seller, assignmentId };
    }),

  // Get store location by vehicle ID
  getStoreByVehicle: protectedProcedure
    .input(z.object({ vehicleId: z.number() }))
    .query(async ({ input }) => {
      const store = await getStoreLocationByVehicleId(input.vehicleId);
      return { storeLocation: store };
    }),

  // List assignments (history)
  assignments: protectedProcedure
    .input(z.object({
      storeLocation: z.string().optional(),
      sellerId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return listSellerAssignments(input?.storeLocation, input?.sellerId);
    }),

  // Update assignment status
  updateAssignment: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "contacted", "completed", "expired"]),
    }))
    .mutation(async ({ input }) => {
      const data: any = { status: input.status };
      if (input.status === "contacted") data.contactedAt = new Date();
      if (input.status === "completed") data.completedAt = new Date();
      await updateSellerAssignment(input.id, data);
      return { success: true };
    }),
});

