import { z } from "zod";

export interface Address {
	street?: string | null;
	city?: string | null;
	postal_code?: string | null;
	country?: string | null;
}

export const address = z.object({
	street: z.string().nullable().optional(),
	city: z.string().nullable().optional(),
	postal_code: z.string().nullable().optional(),
	country: z.string().nullable().optional(),
});
