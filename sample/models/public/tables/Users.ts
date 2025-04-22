import type { Generated } from "kysely";
import { z } from "zod";

import { type Email, email } from "../domains/Email.ts";
import { type UserRole, user_role } from "../enums/UserRole.ts";
import { type Address, address } from "../composites/Address.ts";

export interface Users {
	user_id: Generated<number>;
	username: string;
	email: Email;
	role: Generated<UserRole>;
	shipping_address: Address | null;
	created_at: Generated<Date | null>;
}

export const users = z.object({
	user_id: z.number().nullable().optional(),
	username: z.string(),
	email: email,
	role: user_role.nullable().optional(),
	shipping_address: address.nullable().optional(),
	created_at: z.coerce.date().nullable().optional(),
});
