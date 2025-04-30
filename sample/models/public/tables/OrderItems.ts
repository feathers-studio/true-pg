import type { Generated } from "kysely";
import { z } from "zod";

import { type PositiveNumeric, positive_numeric } from "../domains/PositiveNumeric.ts";

export interface OrderItems {
	order_item_id: Generated<number>;
	order_id: number;
	product_id: number;
	quantity: number;
	price_at_purchase: PositiveNumeric;
}

export const order_items = z.object({
	order_item_id: z.number().optional(),
	order_id: z.number(),
	product_id: z.number(),
	quantity: z.number(),
	price_at_purchase: positive_numeric,
});
