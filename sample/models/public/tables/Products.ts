import type { Generated } from "kysely";
import { z } from "zod";

import { type PositiveNumeric, positive_numeric } from "../domains/PositiveNumeric.ts";
import { type ValidityPeriod, validity_period } from "../ranges/ValidityPeriod.ts";

export interface Products {
	product_id: Generated<number>;
	name: string;
	description: string | null;
	price: PositiveNumeric;
	stock_quantity: Generated<number | null>;
	is_active: Generated<boolean | null>;
	validity: ValidityPeriod | null;
	created_at: Generated<Date | null>;
}

export const products = z.object({
	product_id: z.number().nullable().optional(),
	name: z.string(),
	description: z.string().nullable().optional(),
	price: positive_numeric,
	stock_quantity: z.number().nullable().optional(),
	is_active: z.boolean().nullable().optional(),
	validity: validity_period.nullable().optional(),
	created_at: z.coerce.date().nullable().optional(),
});
