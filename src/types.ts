import type {
	CanonicalType,
	CompositeTypeDetails,
	EnumDetails,
	FunctionDetails,
	TableDetails,
	PgType,
	SchemaType,
} from "pg-extract";

export interface TruePGOpts {
	connectionString: string;
	outDir: string;
	enumTo?: "union" | "enum";
}

export interface createGenerator {
	(mode: GeneratorMode, opts?: { enumTo?: "union" | "enum" }): Generator;
}

export type GeneratorMode = "absolute" | "insert" | "update";

export interface Generator {
	/**
	 * Use this function to define a name mapping for schema types.
	 * This is useful if you want to use a different name for a type in the generated code.
	 */
	getTypeName(type: SchemaType): string;
	table(
		/** @out Append used types to this array */
		types: CanonicalType[],
		/** Information about the table */
		table: TableDetails,
	): string;
	enum(
		/** @out Append used types to this array */
		types: CanonicalType[],
		/** Information about the enum */
		en: EnumDetails,
	): string;
	composite(
		/** @out Append used types to this array */
		types: CanonicalType[],
		/** Information about the composite type */
		type: CompositeTypeDetails,
	): string;
	function(
		/** @out Append used types to this array */
		types: CanonicalType[],
		/** Information about the function */
		type: FunctionDetails,
	): string;
	imports(types: CanonicalType[], context: { schema: string; kind: PgType["kind"] }): string;
	schemaIndex(types: SchemaType[]): string;
	fullIndex(schemas: string[]): string;
}
