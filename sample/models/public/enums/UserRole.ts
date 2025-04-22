import { z } from "zod";

export type UserRole = "admin" | "customer";

export const user_role = z.union([
	z.literal("admin"),
	z.literal("customer")
]);
