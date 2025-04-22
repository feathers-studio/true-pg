import type { Generated } from "kysely";
import { z } from "zod";

import { type OrderStatus, order_status } from "../enums/OrderStatus.ts";
import { type Address, address } from "../composites/Address.ts";
import { type PositiveNumeric, positive_numeric } from "../domains/PositiveNumeric.ts";

export interface Orders {
	order_id: Generated<number>;
	user_id: number;
	order_date: Generated<Date | null>;
	status: Generated<OrderStatus>;
	shipping_address: Address | null;
	unknown_column: unknown | null;
	total_amount: PositiveNumeric | null;
}

export const orders = z.object({
	order_id: z.number().nullable().optional(),
	user_id: z.number(),
	order_date: z.coerce.date().nullable().optional(),
	status: order_status.nullable().optional(),
	shipping_address: address.nullable().optional(),
	unknown_column: z.unknown().nullable().optional(),
	total_amount: positive_numeric.nullable().optional(),
});
