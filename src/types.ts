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

export interface GeneratorContext {
	/** The source file path */
	source: string;
	/** Append types to import */
	imports: ImportList;
}

export interface FormatTypeAttributes {
	nullable?: boolean;
	generated?: boolean;
	identity?: boolean;
}

export interface SchemaGenerator {
	/**
	 * Use this function to define a name mapping for schema names.
	 * This is useful if you want to use a different name for a schema in the generated code.
	 * Example: "public" -> "PublicSchema"
	 */
	formatSchemaName(name: string): string;

	/**
	 * Use this function to define a name mapping for schema members.
	 * This is useful if you want to use a different name for a member in the generated code.
	 * Example: "users" -> "UsersTable"
	 */
	formatSchemaMemberName(type: SchemaType): string;

	/**
	 * Use this function to define a name mapping for type names.
	 * This is useful if you want to use a different name for a type in the generated code.
	 * Example: "users" -> "UsersTable"
	 */
	formatType(
		ctx: GeneratorContext,
		type: Canonical | FunctionReturnType.ExistingTable,
		attr?: FormatTypeAttributes,
	): string;

	table(
		ctx: GeneratorContext,
		/** Information about the table */
		table: TableDetails,
	): string;

	view(
		ctx: GeneratorContext,
		/** Information about the view */
		view: ViewDetails,
	): string;

	materializedView(
		ctx: GeneratorContext,
		/** Information about the materialized view */
		materializedView: MaterializedViewDetails,
	): string;

	enum(
		ctx: GeneratorContext,
		/** Information about the enum */
		en: EnumDetails,
	): string;

	composite(
		ctx: GeneratorContext,
		/** Information about the composite type */
		type: CompositeTypeDetails,
	): string;

	domain(
		ctx: GeneratorContext,
		/** Information about the domain */
		type: DomainDetails,
	): string;

	range(
		ctx: GeneratorContext,
		/** Information about the range */
		type: RangeDetails,
	): string;

	function(
		ctx: GeneratorContext,
		/** Information about the function */
		type: FunctionDetails,
	): string;

	/** create the file `$out/$schema.name/$kind/index.ts` */
	schemaKindIndex(
		ctx: GeneratorContext,
		schema: Schema,
		kind: Exclude<keyof Schema, "name">,
		main_generator?: SchemaGenerator,
	): string;

	/** create the file `$out/$schema.name/index.ts` */
	schemaIndex(ctx: GeneratorContext, schema: Schema, main_generator?: SchemaGenerator): string;

	/** create the file `$out/index.ts` */
	fullIndex(ctx: GeneratorContext, schemas: Schema[], main_generator?: SchemaGenerator): string;
}
