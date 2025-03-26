import type {
	CanonicalType,
	CompositeTypeDetails,
	EnumDetails,
	FunctionDetails,
	TableDetails,
	PgType,
	SchemaType,
	Schema,
} from "pg-extract";

export interface TruePGOpts {
	uri: string;
	out: string;
	defaultSchema?: string;
	enumTo?: "union" | "enum";
}

export interface CreateGeneratorOpts {
	defaultSchema?: string;
	enumTo?: "union" | "enum";
}

export interface createGenerator {
	(opts?: CreateGeneratorOpts): SchemaGenerator;
}

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
	formatType(type: CanonicalType): string;

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

	schemaKindIndex(schema: Schema, kind: Exclude<keyof Schema, "name">): string;

	schemaIndex(schema: Schema): string;

	fullIndex(schemas: Schema[]): string;
}
