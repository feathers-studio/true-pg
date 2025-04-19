import { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";

/** Enum type in a schema. */
export interface EnumDetails extends PgType<"enum"> {
	/** Array of enum values in order. */
	values: string[];
}

const extractEnum = async (db: DbAdapter, pgEnum: PgType<"enum">): Promise<EnumDetails> => {
	const results = await db.query<{ values: string[] }, [name: string, schemaName: string]>(
		`
		SELECT
			json_agg(pg_enum.enumlabel ORDER BY pg_enum.enumsortorder) as "values"
		FROM
			pg_type
			JOIN pg_namespace ON pg_type.typnamespace = pg_namespace.oid
			JOIN pg_enum ON pg_type.oid = pg_enum.enumtypid
		WHERE
			pg_type.typtype = 'e'
			AND pg_namespace.nspname = $2
			AND typname = $1
		`,
		[pgEnum.name, pgEnum.schemaName],
	);

	return {
		...pgEnum,
		...results[0]!,
	};
};

export default extractEnum;
