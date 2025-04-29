import type { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";
import type { Canonical } from "../canonicalise.ts";
import { parsePostgresTableDefinition } from "./util/parseInlineTable.ts";

const parameterModeMap = {
	i: "IN",
	o: "OUT",
	b: "INOUT",
	v: "VARIADIC",
	t: "TABLE",
} as const;

const removeNulls = <T>(o: T): T => {
	for (const key in o) if (o[key] === null) delete o[key];
	return o;
};

type ParameterMode = (typeof parameterModeMap)[keyof typeof parameterModeMap];

const INPUT_MODES = ["i", "b", "v"] as (keyof typeof parameterModeMap)[];

export type FunctionParameter = {
	name: string;
	type: Canonical;
	mode: ParameterMode;
	hasDefault: boolean;
	ordinalPosition: number;
};

const volatilityMap = {
	i: "IMMUTABLE",
	s: "STABLE",
	v: "VOLATILE",
} as const;

type FunctionVolatility = (typeof volatilityMap)[keyof typeof volatilityMap];

const parallelSafetyMap = {
	s: "SAFE",
	r: "RESTRICTED",
	u: "UNSAFE",
} as const;

type FunctionParallelSafety = (typeof parallelSafetyMap)[keyof typeof parallelSafetyMap];

export enum FunctionReturnTypeKind {
	Regular = "regular",
	InlineTable = "inline_table",
	ExistingTable = "table",
}

export namespace FunctionReturnType {
	export type Regular = {
		kind: FunctionReturnTypeKind.Regular;
		type: Canonical;
		isSet: boolean;
	};

	export type InlineTable = {
		kind: FunctionReturnTypeKind.InlineTable;
		columns: { name: string; type: Canonical }[];
		isSet: boolean;
	};

	export type ExistingTable = {
		kind: FunctionReturnTypeKind.ExistingTable;
		schema: string;
		name: string;
		isSet: boolean;
	};
}

export type FunctionReturnType =
	| FunctionReturnType.Regular
	| FunctionReturnType.InlineTable
	| FunctionReturnType.ExistingTable;

export interface FunctionDetails extends PgType<"function"> {
	parameters: FunctionParameter[];
	returnType: FunctionReturnType;
	language: string;
	definition: string;
	isStrict: boolean;
	isSecurityDefiner: boolean;
	isLeakProof: boolean;
	volatility: FunctionVolatility;
	parallelSafety: FunctionParallelSafety;
	estimatedCost: number;
	estimatedRows: number | null;
	comment: string | null;
}

async function extractFunction(db: DbAdapter, pgType: PgType<"function">): Promise<FunctionDetails[]> {
	const query = `
		SELECT
			p.proname as name,
			format_type(p.prorettype, null) as return_type_string,
			l.lanname AS language,
			p.prosrc AS definition,
			p.proisstrict AS is_strict,
			p.prosecdef AS is_security_definer,
			p.proleakproof AS is_leak_proof,
			p.proretset AS returns_set,
			p.provolatile AS volatility,
			p.proparallel AS parallel_safety,
			p.procost AS estimated_cost,
			CASE WHEN p.proretset THEN p.prorows ELSE NULL END AS estimated_rows,
			d.description AS comment,
			p.prorettype,
			p.proargnames as arg_names,
			array_to_json(p.proargmodes) AS arg_modes,
			array_to_json(COALESCE(p.proallargtypes::regtype[], p.proargtypes::regtype[])) AS arg_types,
			pronargs,
			p.pronargdefaults as default_arg_count,
			p.proargdefaults as arg_defaults,
			pg_get_function_arguments(p.oid) AS arg_list,
			pg_get_function_identity_arguments(p.oid) AS identity_args,
			pg_get_function_result(p.oid) as declared_return_type,
			ret_typ.typtype as return_type_kind_code,
			ret_typ_ns.nspname as return_type_schema,
			ret_typ.typname as return_type_name,
			ret_typ.typrelid as return_type_relation_oid,
			ret_rel.relkind as return_type_relation_kind
		FROM pg_proc p
		LEFT JOIN pg_namespace n ON n.oid = p.pronamespace
		LEFT JOIN pg_description d ON d.objoid = p.oid
		LEFT JOIN pg_language l ON l.oid = p.prolang
		LEFT JOIN pg_type ret_typ ON ret_typ.oid = p.prorettype
		LEFT JOIN pg_namespace ret_typ_ns ON ret_typ.typnamespace = ret_typ_ns.oid
		LEFT JOIN pg_class ret_rel ON ret_rel.oid = ret_typ.typrelid
		WHERE n.nspname = $1 AND p.proname = $2
	`;

	const rows = await db.query<
		{
			name: string;
			return_type_string: string;
			language: string;
			definition: string;
			is_strict: boolean;
			is_security_definer: boolean;
			is_leak_proof: boolean;
			returns_set: boolean;
			volatility: "i" | "s" | "v";
			parallel_safety: "s" | "r" | "u";
			estimated_cost: number;
			estimated_rows: number | null;
			comment: string | null;
			prorettype: string;
			arg_names: string[] | null;
			arg_modes: ("i" | "o" | "b" | "v" | "t")[] | null;
			arg_types: string[] | null;
			default_arg_count: number;
			arg_defaults: string | null;
			arg_list: string;
			identity_args: string;
			declared_return_type: string;
			return_type_kind_code: string | null;
			return_type_schema: string | null;
			return_type_name: string | null;
			return_type_relation_oid: string | null;
			return_type_relation_kind: "r" | "v" | "m" | "c" | string | null;
		},
		[string, string]
	>(query, [pgType.schemaName, pgType.name]);

	const functions = Promise.all(
		rows.map(async row => {
			if (row.arg_names && !row.arg_modes) row.arg_modes = row.arg_names.map(() => "i");

			const argModes = row.arg_modes?.map(mode => parameterModeMap[mode]) ?? [];
			const canonical_arg_types = row.arg_types ? await db.canonicalise(row.arg_types) : [];

			let returnType: FunctionReturnType;

			const tableMatch = row.declared_return_type.match(/^TABLE\((.*)\)$/i);

			if (tableMatch) {
				const columnDefs = parsePostgresTableDefinition(row.declared_return_type);
				const columnTypes = columnDefs.map(col => col.type);
				const canonicalColumnTypes = await db.canonicalise(columnTypes);

				returnType = {
					kind: FunctionReturnTypeKind.InlineTable,
					columns: columnDefs.map((col, i) => ({
						name: col.name,
						type: canonicalColumnTypes[i]!,
					})),
					isSet: row.returns_set,
				};
			} else {
				// "c" = composite type
				if (row.return_type_kind_code === "c") {
					if (
						// "r" = table
						row.return_type_relation_kind === "r" ||
						// "v" = view
						row.return_type_relation_kind === "v" ||
						// "m" = materialized view
						row.return_type_relation_kind === "m"
					) {
						returnType = {
							kind: FunctionReturnTypeKind.ExistingTable,
							schema: row.return_type_schema!,
							name: row.return_type_name!,
							isSet: row.returns_set,
						};
					} else if (
						// "c" = composite type
						row.return_type_relation_kind === "c"
					) {
						const canonicalReturnType = (await db.canonicalise([row.return_type_string]))[0]!;
						returnType = {
							kind: FunctionReturnTypeKind.Regular,
							type: canonicalReturnType,
							isSet: row.returns_set,
						};
					} else {
						console.warn(
							`Composite return type '${row.return_type_string}' has unexpected relkind '${row.return_type_relation_kind}' for function ${pgType.schemaName}.${row.name}`,
						);
						const canonicalReturnType = (await db.canonicalise([row.return_type_string]))[0]!;
						returnType = {
							kind: FunctionReturnTypeKind.Regular,
							type: canonicalReturnType,
							isSet: row.returns_set,
						};
					}
				} else {
					const canonicalReturnType = (await db.canonicalise([row.return_type_string]))[0]!;
					returnType = {
						kind: FunctionReturnTypeKind.Regular,
						type: canonicalReturnType,
						isSet: row.returns_set,
					};
				}
			}

			// Filter to include IN, INOUT, and VARIADIC parameters as input parameters
			const inputParams =
				row.arg_modes
					?.map((mode, index) => ({ mode, index }))
					.filter(item => INPUT_MODES.includes(item.mode))
					.map(item => item.index) ?? [];

			const parameters =
				row.arg_types?.map((_, i): FunctionParameter => {
					const name = row.arg_names?.[i] ?? `$${i + 1}`;
					const isInputParam = INPUT_MODES.includes(row.arg_modes?.[i] ?? "i");
					const inputParamIndex = inputParams.indexOf(i);
					const hasDefault = isInputParam && inputParamIndex >= inputParams.length - (row.default_arg_count ?? 0);

					return {
						name,
						type: canonical_arg_types[i]!,
						mode: argModes[i] ?? "IN",
						hasDefault,
						ordinalPosition: i + 1,
					};
				}) ?? [];

			const func: FunctionDetails = {
				name: row.name,
				schemaName: pgType.schemaName,
				kind: "function",
				comment: row.comment,
				definition: row.definition,
				estimatedCost: row.estimated_cost,
				estimatedRows: row.estimated_rows,
				language: row.language,
				isStrict: row.is_strict,
				isSecurityDefiner: row.is_security_definer,
				isLeakProof: row.is_leak_proof,
				parameters,
				volatility: volatilityMap[row.volatility],
				parallelSafety: parallelSafetyMap[row.parallel_safety],
				returnType: removeNulls(returnType),
			};

			return func;
		}),
	);

	return functions;
}

export default extractFunction;
