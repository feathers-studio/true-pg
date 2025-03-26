import type { CanonicalType, Schema, TableColumn } from "pg-extract";
import type { createGenerator, SchemaGenerator } from "./types";

const toPascalCase = (str: string) =>
	str
		.replace(" ", "_")
		.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
		.replace(/^([a-z])/, (_, letter) => letter.toUpperCase());

export const Kysely: createGenerator = (opts = { enumTo: "enum" }): SchemaGenerator => {
	const column = (
		generator: SchemaGenerator,
		/** @out Append used types to this array */
		types: CanonicalType[],
		/** Information about the column */
		col: TableColumn,
	) => {
		let base = generator.formatType(col.type);
		if (col.type.dimensions > 0) base += "[]".repeat(col.type.dimensions);
		if (col.isNullable) base += " | null";

		let qualified = base;
		if (col.generated === "ALWAYS") qualified = `K.GeneratedAlways<${qualified}>`;
		else if (col.generated === "BY DEFAULT") qualified = `K.Generated<${qualified}>`;
		else if (col.defaultValue) qualified = `K.Generated<${qualified}>`;

		let out = col.comment ? `/** ${col.comment} */\n\t` : "";
		out += col.name;
		// TODO: update imports for non-primitive types
		out += `: ${qualified}`;
		types.push(col.type);
		if (col.type.dimensions > 0) out += "[]".repeat(col.type.dimensions);

		return `\t${out};\n`;
	};

	const composite_attribute = (
		generator: SchemaGenerator,
		types: CanonicalType[],
		attr: CanonicalType.CompositeAttribute,
	) => {
		let out = attr.name;

		if (attr.isNullable) out += "?";
		out += `: ${generator.formatType(attr.type)}`;
		types.push(attr.type);
		if (attr.type.dimensions > 0) out += "[]".repeat(attr.type.dimensions);
		if (attr.isNullable) out += " | null";

		return out;
	};

	return {
		formatSchema(name) {
			return toPascalCase(name) + "Schema";
		},

		formatSchemaType(type) {
			return toPascalCase(type.name);
		},

		formatType(type) {
			if (type.schema === "pg_catalog") return type.canonical_name;
			return toPascalCase(type.name);
		},

		table(types, table) {
			let out = "";

			if (table.comment) out += `/** ${table.comment} */\n`;
			out += `export interface ${this.formatSchemaType(table)} {\n`;
			for (const col of table.columns) out += column(this, types, col);
			out += "}\n";

			return out;
		},

		enum(types, en) {
			let out = "";

			if (en.comment) out += `/** ${en.comment} */\n`;

			if (opts.enumTo === "union") {
				out += `export type ${this.formatSchemaType(en)} = ${en.values.map(v => `"${v}"`).join(" | ")};\n`;
			} else {
				out += `export enum ${this.formatSchemaType(en)} {\n`;
				for (const v of en.values) out += `\t"${v}" = "${v}",\n`;
				out += "}\n";
			}

			return out;
		},

		composite(types, type) {
			let out = "";

			if (type.comment) out += `/** ${type.comment} */\n`;
			out += `export interface ${this.formatSchemaType(type)} {\n`;

			const props = type.canonical.attributes.map(c => composite_attribute(this, types, c)).map(t => `\t${t};`);
			out += props.join("\n");
			out += "\n}\n";

			return out;
		},

		function(types, type) {
			let out = "";

			out += "/**\n";
			if (type.comment) out += ` * ${type.comment}\n`;
			out += ` * @volatility ${type.volatility}\n`;
			out += ` * @parallelSafety ${type.parallelSafety}\n`;
			out += ` * @isStrict ${type.isStrict}\n`;
			out += " */\n";
			out += `export interface ${this.formatSchemaType(type)} {\n\t`;

			// Get the input parameters (those that appear in function signature)
			const inputParams = type.parameters.filter(
				p => p.mode === "IN" || p.mode === "INOUT" || p.mode === "VARIADIC",
			);

			if (inputParams.length === 0) {
				out += "(): ";
			} else if (inputParams.length === 1) {
				out += "(";
				out += inputParams[0]!.name;
				out += ": ";
				out += this.formatType(inputParams[0]!.type);
				types.push(inputParams[0]!.type);
				if (inputParams[0]!.type.dimensions > 0) out += "[]".repeat(inputParams[0]!.type.dimensions);
				out += "): ";
			} else if (inputParams.length > 0) {
				out += "(\n";

				for (const param of inputParams) {
					// Handle variadic parameters differently if needed
					const isVariadic = param.mode === "VARIADIC";
					const paramName = isVariadic ? `...${param.name}` : param.name;

					out += `\t\t${paramName}`;
					if (param.hasDefault && !isVariadic) out += "?";
					// TODO: update imports for non-primitive types based on typeInfo.kind
					out += `: ${this.formatType(param.type)}`;
					types.push(param.type);
					if (param.type.dimensions > 0) out += "[]".repeat(param.type.dimensions);
					if (!isVariadic) out += ",";
					out += "\n";
				}

				out += "\t): ";
			}

			if (type.returnType.kind === "table") {
				out += "{\n";
				for (const col of type.returnType.columns) {
					out += `\t\t${col.name}: `;
					out += this.formatType(col.type);
					types.push(col.type);
					if (col.type.dimensions > 0) out += "[]".repeat(col.type.dimensions);
					out += `;\n`;
				}
				out += "\t}";
			} else {
				out += this.formatType(type.returnType.type);
				types.push(type.returnType.type);
				if (type.returnType.type.dimensions > 0) out += "[]".repeat(type.returnType.type.dimensions);
			}

			// Add array brackets based on dimensions
			if (type.returnType.kind === "regular" && type.returnType.type.dimensions > 0) {
				out += "[]".repeat(type.returnType.type.dimensions);
			}

			// Add additional array brackets if it returns a set
			if (type.returnType.isSet) {
				out += "[]";
			}

			out += ";\n}\n";

			return out;
		},

		imports(types, context) {
			if (types.length === 0) return "";

			const unique_types = types
				.filter(t => t.schema !== "pg_catalog")
				.filter((t, i, arr) => {
					return arr.findIndex(t2 => t2.canonical_name === t.canonical_name) === i;
				})
				.map(t => ({ ...t, formatted: this.formatType(t) }));

			const needs_catalog = types.some(t => t.schema === "pg_catalog");

			const imports: string[] = [];
			if (needs_catalog) imports.push(`import type { pg_catalog } from "../../pg_catalog.ts";`);

			const current_kind = unique_types //
				.filter(t => t.schema === context.schema && t.kind === context.kind);

			for (const type of current_kind) {
				const name = this.formatType(type);
				imports.push(`import type { ${name} } from "./${name}.ts";`);
			}

			const current_schema = unique_types //
				.filter(t => t.schema === context.schema && t.kind !== context.kind);

			for (const type of current_schema) {
				const kind = type.kind;
				const name = this.formatType(type);
				imports.push(`import type { ${name} } from "../${kind}s/${name}.ts";`);
			}

			const other_schemas = unique_types.filter(t => t.schema !== context.schema);

			for (const type of other_schemas) {
				const schema = this.formatSchema(type.schema);
				const kind = type.kind;
				const name = this.formatType(type);
				imports.push(`import type { ${name} } from "../${schema}/${kind}s/${name}.ts";`);
			}

			return imports.join("\n");
		},

		schemaIndex(schema) {
			// Kysely only wants tables
			const tables = schema.tables;

			let out = "";

			const seen = new Set<string>();
			const formatted = tables
				.map(each => {
					const formatted = this.formatSchemaType(each);
					// skip clashing names
					if (seen.has(formatted)) return;
					seen.add(formatted);
					return { ...each, formatted };
				})
				.filter(x => x !== undefined);

			out += formatted
				.map(t => {
					const name = t.formatted;
					return `import type { ${name} } from "./${t.kind}s/${name}.ts";`;
				})
				.filter(Boolean)
				.join("\n");

			out += "\n\n";
			out += `export interface ${this.formatSchema(schema.name)} {\n`;
			out += formatted.map(t => `\t${t.name}: ${t.formatted};`).join("\n");
			out += "\n}\n";

			return out;
		},

		fullIndex(schemas: Schema[]) {
			let out = "";

			out += schemas
				.map(s => `import type { ${this.formatSchema(s.name)} } from "./${s.name}/index.ts";`)
				.join("\n");

			out += "\n\n";
			out += `export interface Database {\n`;
			out += schemas.map(s => `\t${this.formatSchema(s.name)}: ${this.formatSchema(s.name)};\n`).join("");
			out += "}\n";

			return out;
		},
	};
};
