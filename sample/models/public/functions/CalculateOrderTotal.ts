import { z } from "zod";

/**
 * @volatility STABLE
 * @parallelSafety UNSAFE
 * @isStrict false
 */
export interface CalculateOrderTotal {
	(p_order_id: number): bigint;
}

export const calculate_order_total = {
	parameters: z.tuple([
		z.number(), // p_order_id
	]),
	returnType: z.bigint(),
};
