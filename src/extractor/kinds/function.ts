import type { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";
import { canonicaliseTypes, CanonicalType as CanonicalType } from "../canonicalise.ts";

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
	type: CanonicalType;
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
	Table = "table",
	Regular = "regular",
}

type FunctionReturnType =
	| {
			kind: FunctionReturnTypeKind.Table;
			columns: { name: string; type: CanonicalType }[];
			isSet: boolean;
	  }
	| {
			kind: FunctionReturnTypeKind.Regular;
			type: CanonicalType;
			isSet: boolean;
	  };

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
			ns.nspname || '.' || t.typname AS return_type,
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
			pg_get_function_result(p.oid) as full_return_type,
			(t.typelem != 0) AS returns_array,
			COALESCE(t.typndims, 0) AS return_dimensions,
			t.typelem
		FROM pg_proc p
		LEFT JOIN pg_namespace n ON n.oid = p.pronamespace
		LEFT JOIN pg_description d ON d.objoid = p.oid
		LEFT JOIN pg_language l ON l.oid = p.prolang
		LEFT JOIN pg_type t ON t.oid = p.prorettype
		LEFT JOIN pg_namespace ns ON t.typnamespace = ns.oid
		WHERE n.nspname = $1 AND p.proname = $2
	`;

	const rows = await db.query<
		{
			name: string;
			language: string;
			definition: string;
			is_strict: boolean;
			is_security_definer: boolean;
			is_leak_proof: boolean;
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
			return_type: string;
			full_return_type: string;
			returns_array: boolean;
			returns_set: boolean;
			return_dimensions: number;
			typelem: number;
		},
		[string, string]
	>(query, [pgType.schemaName, pgType.name]);

	const functions = Promise.all(
		rows.map(async row => {
			if (row.arg_names && !row.arg_modes) row.arg_modes = row.arg_names.map(() => "i");

			const argModes = row.arg_modes?.map(mode => parameterModeMap[mode]) ?? [];
			const canonical_arg_types = row.arg_types ? await canonicaliseTypes(db, row.arg_types) : [];

			const firstOutParamIndex = row.arg_modes?.findIndex(mode => mode === "o") ?? -1;

			let returnType: FunctionReturnType;

			const tableMatch = (row.full_return_type as string).match(/TABLE\((.*)\)/i);
			if (tableMatch) {
				const columnDefs = tableMatch[1]!.split(",").map(col => {
					const [name, type] = col.trim().split(/\s+/);
					return { name, type };
				});

				const column_types = await canonicaliseTypes(
					db,
					columnDefs.map(col => col.type!),
				);

				returnType = {
					kind: FunctionReturnTypeKind.Table,
					columns: columnDefs.map((col, i) => ({
						name: col.name!,
						type: column_types[i]!,
					})),
					isSet: row.returns_set,
				};
			} else {
				returnType = {
					kind: FunctionReturnTypeKind.Regular,
					type: (await canonicaliseTypes(db, [row.return_type]))[0]!,
					isSet: row.returns_set,
				};
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
					const hasDefault =
						isInputParam && inputParamIndex >= inputParams.length - (row.default_arg_count ?? 0);

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
