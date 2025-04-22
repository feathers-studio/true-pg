import { z } from "zod";

export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";

export const order_status = z.union([
	z.literal("pending"),
	z.literal("processing"),
	z.literal("shipped"),
	z.literal("delivered"),
	z.literal("cancelled")
]);
