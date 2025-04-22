import { z } from "zod";

export interface MonthlySalesSummary {
	sales_month: Date | null;
	total_orders: bigint | null;
	total_revenue: bigint | null;
	total_items_sold: bigint | null;
}

export const monthly_sales_summary = z.object({
	sales_month: z.coerce.date().nullable().optional(),
	total_orders: z.bigint().nullable().optional(),
	total_revenue: z.bigint().nullable().optional(),
	total_items_sold: z.bigint().nullable().optional(),
});
