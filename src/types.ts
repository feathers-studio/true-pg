import {
	Canonical,
	type TableDetails,
	type ViewDetails,
	type MaterializedViewDetails,
	type EnumDetails,
	type CompositeTypeDetails,
	type DomainDetails,
	type RangeDetails,
	type FunctionDetails,
	type SchemaType,
	type Schema,
	type FunctionReturnType,
} from "./extractor/index.ts";

import type { ImportList } from "./imports.ts";

// To be updated when we add support for other kinds
export const allowed_kind_names = [
	"tables",
	"views",
	"materializedViews",
	"enums",
	"composites",
	"functions",
	"domains",
	"ranges",
] as const;

export type allowed_kind_names = (typeof allowed_kind_names)[number];

export interface FolderStructure {
	name: string;
	type: "root";
	children: {
		[realname: string]: {
			name: string;
			type: "schema";
			children: {
				[kind: string]: {
					kind: allowed_kind_names;
					type: "kind";
					children: {
						[realname: string]: {
							name: string;
							type: "type";
						};
					};
				};
			};
		};
	};
}

export interface CreateGeneratorOpts {
	defaultSchema?: string;
	warnings: Set<string>;
}

export interface createGenerator {
	(opts?: CreateGeneratorOpts): SchemaGenerator;
}

/* convenience function to create a generator with type inference */
export const createGenerator = (generatorCreator: createGenerator): createGenerator => generatorCreator;

export interface SchemaGenerator {
	/**
	 * Use this function to define a name mapping for schema names.
	 * This is useful if you want to use a different name for a schema in the generated code.
	 * Example: "public" -> "PublicSchema"
	 */
	formatSchema(name: string): string;

	/**
	 * Use this function to define a name mapping for schema types.
	 * This is useful if you want to use a different name for a type in the generated code.
	 * Example: "users" -> "UsersTable"
	 */
	formatSchemaType(type: SchemaType): string;

	/**
	 * Use this function to define a name mapping for type names.
	 * This is useful if you want to use a different name for a type in the generated code.
	 * Example: "users" -> "UsersTable"
	 */
	formatType(type: Canonical | FunctionReturnType.ExistingTable): string;

	table(
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the table */
		table: TableDetails,
	): string;

	view(
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the view */
		view: ViewDetails,
	): string;

	materializedView(
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the materialized view */
		materializedView: MaterializedViewDetails,
	): string;

	enum(
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the enum */
		en: EnumDetails,
	): string;

	composite(
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the composite type */
		type: CompositeTypeDetails,
	): string;

	domain(
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the domain */
		type: DomainDetails,
	): string;

	range(
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the range */
		type: RangeDetails,
	): string;

	function(
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the function */
		type: FunctionDetails,
	): string;

	/** create the file `$out/$schema.name/$kind/index.ts` */
	schemaKindIndex(schema: Schema, kind: Exclude<keyof Schema, "name">, main_generator?: SchemaGenerator): string;

	/** create the file `$out/$schema.name/index.ts` */
	schemaIndex(schema: Schema, main_generator?: SchemaGenerator): string;

	/** create the file `$out/index.ts` */
	fullIndex(schemas: Schema[], main_generator?: SchemaGenerator): string;
}
