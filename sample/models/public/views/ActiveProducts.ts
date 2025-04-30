import { z } from "zod";

import { type PositiveNumeric, positive_numeric } from "../domains/PositiveNumeric.ts";

export interface ActiveProducts {
	product_id: number | null;
	name: string | null;
	description: string | null;
	price: PositiveNumeric | null;
	stock_quantity: number | null;
}

export const active_products = z.object({
	product_id: z.number().optional(),
	name: z.string().optional(),
	description: z.string().optional(),
	price: positive_numeric.optional(),
	stock_quantity: z.number().optional(),
});
