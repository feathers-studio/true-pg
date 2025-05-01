import type { DbAdapter } from "../adapter.ts";
import type { PgType } from "../pgtype.ts";
import type { Canonical } from "../canonicalise/index.ts";

// Note: isUpdatable is generally false for mat views and not typically stored directly
export interface MaterializedViewColumn {
	name: string;
	type: Canonical;
	isNullable: boolean;
	ordinalPosition: number;
	comment: string | null;
}

export interface MaterializedViewDetails extends PgType<"materializedView"> {
	columns: MaterializedViewColumn[];
	definition: string;
	isPopulated: boolean;
	// Could add indexes later, as mat views can have them
	// indices: MaterializedViewIndex[];
}

const extractMaterializedView = async (
	db: DbAdapter,
	mview: PgType<"materializedView">,
): Promise<MaterializedViewDetails> => {
	// Query for columns (using pg_attribute for potentially more accurate nullability)
	const columnQuery = await db.query<
		{
			name: string;
			definedType: string;
			isNullable: boolean;
			ordinalPosition: number;
			comment: string | null;
		},
		[name: string, schemaName: string]
	>(
		`
		SELECT
			attr.attname AS "name",
			format_type(attr.atttypid, attr.atttypmod)
			|| CASE
				WHEN attr.attndims > 1 THEN repeat('[]', attr.attndims - 1)
				ELSE ''
			END AS "definedType",
			NOT attr.attnotnull AS "isNullable", -- Use pg_attribute.attnotnull
			attr.attnum AS "ordinalPosition", -- Use pg_attribute.attnum
			col_description(c.oid, attr.attnum) AS "comment"
		FROM
			pg_catalog.pg_class c
			JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
			JOIN pg_catalog.pg_attribute attr ON c.oid = attr.attrelid
		WHERE
			c.relname = $1      -- Materialized view name
			AND n.nspname = $2    -- Schema name
			AND c.relkind = 'm'   -- Materialized view
			AND attr.attnum > 0   -- Exclude system columns
			AND NOT attr.attisdropped
		ORDER BY attr.attnum;
		`,
		[mview.name, mview.schemaName],
	);

	const columns: MaterializedViewColumn[] = columnQuery.map(row => ({
		name: row.name,
		type: db.enqueue(row.definedType),
		isNullable: row.isNullable,
		ordinalPosition: row.ordinalPosition,
		comment: row.comment,
	}));

	// Query for materialized view definition, comment, and properties
	const mviewInfoQuery = await db.query<
		{
			definition: string;
			comment: string | null;
			isPopulated: boolean;
		},
		[name: string, schemaName: string]
	>(
		`
		SELECT
			m.definition,
			d.description AS "comment",
			m.ispopulated AS "isPopulated"
		FROM
			pg_catalog.pg_matviews m
			JOIN pg_catalog.pg_class c ON m.matviewname = c.relname AND c.relkind = 'm'
			JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid AND m.schemaname = n.nspname
			LEFT JOIN pg_catalog.pg_description d ON c.oid = d.objoid AND d.objsubid = 0
		WHERE
			m.matviewname = $1
			AND m.schemaname = $2;
		`,
		[mview.name, mview.schemaName],
	);

	const mviewInfo = mviewInfoQuery[0];
	if (!mviewInfo) {
		throw new Error(`Could not find materialized view "${mview.schemaName}"."${mview.name}".`);
	}

	return {
		...mview,
		columns,
		comment: mviewInfo.comment ?? mview.comment,
		definition: mviewInfo.definition,
		isPopulated: mviewInfo.isPopulated,
	};
};

export default extractMaterializedView;
