import { z } from "zod";

export interface Address {
	street?: string | null;
	city?: string | null;
	postal_code?: string | null;
	country?: string | null;
}

export const address = z.object({
	street: z.string().optional(),
	city: z.string().optional(),
	postal_code: z.string().optional(),
	country: z.string().optional(),
});
