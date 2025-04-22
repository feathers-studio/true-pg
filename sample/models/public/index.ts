import type * as tables from "./tables/index.ts";
import type * as views from "./views/index.ts";
import type * as materializedViews from "./materializedViews/index.ts";
import type * as enums from "./enums/index.ts";
import type * as composites from "./composites/index.ts";
import type * as functions from "./functions/index.ts";
import type * as domains from "./domains/index.ts";
import type * as ranges from "./ranges/index.ts";

export interface PublicSchema {
	tables: {
		users: tables.Users;
		products: tables.Products;
		orders: tables.Orders;
		order_items: tables.OrderItems;
	};
	views: {
		active_products: views.ActiveProducts;
	};
	materializedViews: {
		monthly_sales_summary: materializedViews.MonthlySalesSummary;
	};
	enums: {
		user_role: enums.UserRole;
		order_status: enums.OrderStatus;
	};
	composites: {
		address: composites.Address;
	};
	functions: {
		calculate_order_total: functions.CalculateOrderTotal;
	};
	domains: {
		email: domains.Email;
		positive_numeric: domains.PositiveNumeric;
	};
	ranges: {
		validity_period: ranges.ValidityPeriod;
	};
}

import * as zod_tables from "./tables/index.ts";
import * as zod_views from "./views/index.ts";
import * as zod_materializedViews from "./materializedViews/index.ts";
import * as zod_enums from "./enums/index.ts";
import * as zod_composites from "./composites/index.ts";
import * as zod_functions from "./functions/index.ts";
import * as zod_domains from "./domains/index.ts";
import * as zod_ranges from "./ranges/index.ts";

export const public_validators = {
	tables: {
		users: zod_tables.users,
		products: zod_tables.products,
		orders: zod_tables.orders,
		order_items: zod_tables.order_items,
	},
	views: {
		active_products: zod_views.active_products,
	},
	materializedViews: {
		monthly_sales_summary: zod_materializedViews.monthly_sales_summary,
	},
	enums: {
		user_role: zod_enums.user_role,
		order_status: zod_enums.order_status,
	},
	composites: {
		address: zod_composites.address,
	},
	functions: {
		calculate_order_total: zod_functions.calculate_order_total,
	},
	domains: {
		email: zod_domains.email,
		positive_numeric: zod_domains.positive_numeric,
	},
	ranges: {
		validity_period: zod_ranges.validity_period,
	},
}
