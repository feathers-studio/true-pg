import Pg from "pg";

import { PGlite as Pglite } from "@electric-sql/pglite";
import { DbAdapter } from "./adapter.ts";

import extractTable, { type TableDetails } from "./kinds/table.ts";
import extractView, { type ViewDetails } from "./kinds/view.ts";
import extractMaterializedView, { type MaterializedViewDetails } from "./kinds/materialized-view.ts";
import extractEnum, { type EnumDetails } from "./kinds/enum.ts";
import extractComposite, { type CompositeTypeDetails } from "./kinds/composite.ts";
import extractFunction, { type FunctionDetails } from "./kinds/function.ts";
import extractDomain, { type DomainDetails } from "./kinds/domain.ts";
import extractRange, { type RangeDetails } from "./kinds/range.ts";

import fetchTypes from "./fetchTypes.ts";

import type { Kind, PgType } from "./pgtype.ts";
export { pgTypeKinds, type PgType, type Kind } from "./pgtype.ts";

import { Canonical } from "./canonicalise/index.ts";
export { Canonical };

export type {
	TableDetails,
	ViewDetails,
	MaterializedViewDetails,
	EnumDetails,
	CompositeTypeDetails,
	FunctionDetails,
	DomainDetails,
	RangeDetails,
};
export type { TableColumn } from "./kinds/table.ts";
export type { ViewColumn } from "./kinds/view.ts";
export type { MaterializedViewColumn } from "./kinds/materialized-view.ts";
export type { FunctionParameter, FunctionReturnType } from "./kinds/function.ts";
export { FunctionReturnTypeKind } from "./kinds/function.ts";

interface DetailsMap {
	table: TableDetails;
	view: ViewDetails;
	materializedView: MaterializedViewDetails;
	enum: EnumDetails;
	composite: CompositeTypeDetails;
	function: FunctionDetails;
	domain: DomainDetails;
	range: RangeDetails;
}

/**
 * extractSchemas generates a record of all the schemas extracted, indexed by schema name.
 * The schemas are instances of this type.
 */
export type Schema = {
	name: string;
	table: TableDetails[];
	view: ViewDetails[];
	materializedView: MaterializedViewDetails[];
	enum: EnumDetails[];
	composite: CompositeTypeDetails[];
	function: FunctionDetails[];
	domain: DomainDetails[];
	range: RangeDetails[];
};

export type SchemaType =
	| TableDetails
	| ViewDetails
	| MaterializedViewDetails
	| EnumDetails
	| CompositeTypeDetails
	| FunctionDetails
	| DomainDetails
	| RangeDetails;

const emptySchema: Omit<Schema, "name"> = {
	table: [],
	view: [],
	materializedView: [],
	enum: [],
	composite: [],
	function: [],
	domain: [],
	range: [],
};

type Populator<K extends Kind> = (pg: DbAdapter, pgType: PgType<K>) => Promise<DetailsMap[K] | DetailsMap[K][]>;

const populatorMap: { [K in Kind]: Populator<K> } = {
	table: extractTable,
	view: extractView,
	materializedView: extractMaterializedView,
	enum: extractEnum,
	composite: extractComposite,
	function: extractFunction,
	domain: extractDomain,
	range: extractRange,
};

/**
 * This is the options object that can be passed to `extractSchemas`.
 * @see extractSchemas
 */
export interface ExtractSchemaOptions {
	/**
	 * Will contain an array of schema names to extract.
	 * If undefined, all non-system schemas will be extracted.
	 */
	schemas?: string[];

	/**
	 * Filter function that you can use if you want to exclude
	 * certain items from the schemas.
	 */
	typeFilter?: (pgType: PgType) => boolean;

	/**
	 * extractShemas will always attempt to parse view definitions to
	 * discover the "source" of each column, i.e. the table or view that it
	 * is derived from.
	 * If this option is set to `true`, it will attempt to follow this
	 * source and copy values like indices, isNullable, etc.
	 * so that the view data is closer to what the database reflects.
	 */
	resolveViews?: boolean;

	/**
	 * Called with the number of types to extract.
	 */
	onProgressStart?: (total: number) => void;

	/**
	 * Called once for each type that is extracted.
	 */
	onProgress?: () => void;

	/**
	 * Called when all types have been extracted.
	 */
	onProgressEnd?: () => void;
}

const supported_kinds = [
	"table",
	"view",
	"materializedView",
	"enum",
	"composite",
	"function",
	"domain",
	"range",
] as const;

export class Extractor {
	db: DbAdapter;

	/**
	 * @param connectionConfig - Connection string or configuration object for Postgres connection
	 */
	constructor(opts: { pg?: Pg.Client | Pg.Pool | Pglite; uri?: string; config?: Pg.ConnectionConfig }) {
		let pg;
		if (opts.pg) pg = opts.pg;
		else if (opts.uri) pg = new Pg.Pool({ connectionString: opts.uri });
		else if (opts.config) pg = new Pg.Pool(opts.config);
		else {
			console.error(
				"One of these options are required in your config file: pg, uri, config. See documentation for more information.",
			);
			process.exit(1);
		}

		this.db = new DbAdapter(pg, opts.pg ? true : false);
	}

	async getBuiltinTypes(): Promise<
		{
			name: string;
			format: string;
			kind: string;
		}[]
	> {
		await this.db.connect();
		const db = this.db;

		const query = `
			SELECT
				t.typname AS name,
				t.typlen AS internal_size,
				pg_catalog.format_type(t.oid, NULL) AS format,
				CASE t.typtype
					WHEN 'b' THEN 'base'
					WHEN 'c' THEN 'composite'
					WHEN 'd' THEN 'domain'
					WHEN 'e' THEN 'enum'
					WHEN 'p' THEN 'pseudo'
					WHEN 'r' THEN 'range'
					ELSE 'unknown'
				END AS kind
			FROM pg_catalog.pg_type t
			WHERE t.typnamespace = 'pg_catalog'::regnamespace
			ORDER BY name;
		`;

		const result = await db.query<{
			name: string;
			internal_size: number;
			format: string;
			kind: Canonical.Kind;
		}>(query);

		await db.close();

		return result;
	}

	/**
	 * Perform the extraction
	 * @param options - Optional options
	 * @returns A record of all the schemas extracted, indexed by schema name.
	 */
	async extractSchemas(options?: ExtractSchemaOptions): Promise<{
		schemas: Record<string, Schema>;
		queryCount: number;
	}> {
		await this.db.connect();
		const db = this.db;

		const q = await db.query<{ nspname: string }>(`
			SELECT nspname FROM pg_catalog.pg_namespace
			WHERE nspname != 'information_schema'
			AND nspname NOT LIKE 'pg_%'
		`);

		const allSchemaNames = q.map(r => r.nspname);

		const schemaNames = options?.schemas ?? allSchemaNames;
		if (options?.schemas) {
			const missingSchemas = schemaNames.filter(schemaName => !allSchemaNames.includes(schemaName));

			if (missingSchemas.length > 0) {
				throw new Error(`No schemas found for ${missingSchemas.join(", ")}`);
			}
		}

		const pgTypes = await fetchTypes(db, schemaNames);

		const filtered = options?.typeFilter ? pgTypes.filter(element => options.typeFilter!(element)) : pgTypes;

		const typesToExtract = filtered.filter(x => supported_kinds.includes(x.kind));

		const skipped = filtered.filter(x => !supported_kinds.includes(x.kind)).map(x => `${x} (${x.kind})`);

		if (skipped.length) {
			console.warn("Skipping types of unsupported kinds:", skipped.join(", "));
			console.warn("This is a bug! Proceeding as if nothing happened.");
		}

		options?.onProgressStart?.(typesToExtract.length);

		const populated = (
			await Promise.all(
				typesToExtract.map(async pgType => {
					const result = await (populatorMap[pgType.kind] as Populator<typeof pgType.kind>)(db, pgType);
					options?.onProgress?.();
					return result;
				}),
			)
		).flat();

		const schemas: Record<string, Schema> = {};
		for (const p of populated) {
			if (!(p.schemaName in schemas)) {
				schemas[p.schemaName] = {
					name: p.schemaName,
					...emptySchema,
				};
			}
			(schemas[p.schemaName]![p.kind] as DetailsMap[typeof p.kind][]) = [...schemas[p.schemaName]![p.kind], p];
		}

		// resolve all canonical types and patch the results into their placeholders
		await db.resolve();

		const queryCount = db.queryCount;

		options?.onProgressEnd?.();

		await db.close();

		return { schemas, queryCount };
	}
}
