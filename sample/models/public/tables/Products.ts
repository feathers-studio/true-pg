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
	unknown_column: unknown | null;
	created_at: Generated<Date | null>;
}

export const products = z.object({
	product_id: z.number().optional(),
	name: z.string(),
	description: z.string().optional(),
	price: positive_numeric,
	stock_quantity: z.number().optional(),
	is_active: z.boolean().optional(),
	validity: validity_period.optional(),
	unknown_column: z.unknown().optional(),
	created_at: z.coerce.date().optional(),
});
