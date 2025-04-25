import type { PublicSchema } from "./public/index.ts";

export interface Database {
	users: PublicSchema["tables"]["users"];
	products: PublicSchema["tables"]["products"];
	orders: PublicSchema["tables"]["orders"];
	order_items: PublicSchema["tables"]["order_items"];
	active_products: PublicSchema["views"]["active_products"];
	monthly_sales_summary: PublicSchema["materializedViews"]["monthly_sales_summary"];
}

export type { PublicSchema };

import { public_validators } from "./public/index.ts";

export const Validators = {
	/* -- public --*/

	// tables
	users: public_validators["tables"]["users"],
	products: public_validators["tables"]["products"],
	orders: public_validators["tables"]["orders"],
	order_items: public_validators["tables"]["order_items"],

	// views
	active_products: public_validators["views"]["active_products"],

	// materializedViews
	monthly_sales_summary: public_validators["materializedViews"]["monthly_sales_summary"],

	// composites
	address: public_validators["composites"]["address"],

	// enums
	user_role: public_validators["enums"]["user_role"],
	order_status: public_validators["enums"]["order_status"],

	// domains
	email: public_validators["domains"]["email"],
	positive_numeric: public_validators["domains"]["positive_numeric"],

	// ranges
	validity_period: public_validators["ranges"]["validity_period"],

	// functions
	calculate_order_total: public_validators["functions"]["calculate_order_total"],
};

export type { public_validators };
