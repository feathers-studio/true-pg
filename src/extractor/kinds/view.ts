import type { DbAdapter } from "../adapter.ts";
import type { PgType } from "../pgtype.ts";
import { Canonical, canonicalise } from "../canonicalise.ts";

export interface ViewColumn {
	name: string;
	type: Canonical;
	isNullable: boolean;
	isUpdatable: boolean;
	ordinalPosition: number;
}

export interface ViewDetails extends PgType<"view"> {
	columns: ViewColumn[];
	isUpdatable: boolean;
	checkOption: "NONE" | "LOCAL" | "CASCADED";
}

const extractView = async (db: DbAdapter, view: PgType<"view">): Promise<ViewDetails> => {
	// 1. Query for columns (information_schema.columns + pg_attribute)
	const columnQuery = await db.query<
		{
			name: string;
			definedType: string;
			isNullable: boolean;
			isUpdatable: boolean;
			ordinalPosition: number;
		},
		[name: string, schemaName: string]
	>(
		`
		SELECT
			col.column_name AS "name",
			format_type(attr.atttypid, attr.atttypmod)
			|| CASE
				WHEN attr.attndims > 1 THEN repeat('[]', attr.attndims - 1)
				ELSE ''
			END AS "definedType",
			col.is_nullable = 'YES' AS "isNullable",
			col.is_updatable = 'YES' AS "isUpdatable",
			col.ordinal_position AS "ordinalPosition"
		FROM
			information_schema.columns col
			JOIN pg_class c ON col.table_name = c.relname AND c.relkind = 'v'
			JOIN pg_namespace n ON c.relnamespace = n.oid AND col.table_schema = n.nspname
			JOIN pg_attribute attr ON c.oid = attr.attrelid AND col.column_name = attr.attname
		WHERE
			col.table_name = $1
			AND col.table_schema = $2
			AND NOT attr.attisdropped -- Exclude dropped columns
		ORDER BY col.ordinal_position;
		`,
		[view.name, view.schemaName],
	);

	// 2. Get canonical types
	const definedTypes = columnQuery.map(row => row.definedType);
	const canonicalTypes = await canonicalise(db, definedTypes);

	const columns: ViewColumn[] = columnQuery.map((row, index) => ({
		name: row.name,
		type: canonicalTypes[index]!,
		isNullable: row.isNullable,
		isUpdatable: row.isUpdatable,
		ordinalPosition: row.ordinalPosition,
	}));

	// 3. Query for view definition, comment, and other properties
	const viewInfoQuery = await db.query<
		{
			comment: string | null;
			isUpdatable: boolean;
			checkOption: "NONE" | "LOCAL" | "CASCADED";
		},
		[name: string, schemaName: string]
	>(
		`
		SELECT
			d.description AS "comment",
			v.is_updatable = 'YES' AS "isUpdatable",
			v.check_option AS "checkOption"
		FROM
			information_schema.views v
			JOIN pg_catalog.pg_class c ON v.table_name = c.relname AND c.relkind = 'v'
			JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid AND v.table_schema = n.nspname
			LEFT JOIN pg_catalog.pg_description d ON c.oid = d.objoid AND d.objsubid = 0
		WHERE
			v.table_name = $1
			AND v.table_schema = $2;
		`,
		[view.name, view.schemaName],
	);

	const viewInfo = viewInfoQuery[0];
	if (!viewInfo) {
		throw new Error(`Could not find view "${view.schemaName}"."${view.name}".`);
	}

	return {
		...view,
		columns,
		comment: viewInfo.comment ?? view.comment,
		isUpdatable: viewInfo.isUpdatable,
		checkOption: viewInfo.checkOption,
	};
};

export default extractView;
