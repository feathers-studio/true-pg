import type { CanonicalType, Schema, TableColumn } from "pg-extract";
import { createGenerator, type SchemaGenerator } from "../types.ts";
import { builtins } from "./builtins.ts";

const isIdentifierInvalid = (str: string) => {
	const invalid = str.match(/[^a-zA-Z0-9_]/);
	return invalid !== null;
};

const to_snake_case = (str: string) =>
	str
		.replace(/^[^a-zA-Z]+/, "") // remove leading non-alphabetic characters
		.replace(/[^a-zA-Z0-9]+/g, "_") // replace non-alphanumeric characters with underscores
		.replace(/([A-Z])/g, "_$1") // insert underscores before uppercase letters
		.toLowerCase();

export const Zod = createGenerator(opts => {
	const defaultSchema = opts?.defaultSchema ?? "public";

	const column = (
		generator: SchemaGenerator,
		/** @out Append used types to this array */
		types: CanonicalType[],
		/** Information about the column */
		col: TableColumn,
	) => {
		// don't create a property for always generated columns
		if (col.generated === "ALWAYS") return "";

		let out = col.comment ? `/** ${col.comment} */\n\t` : "";
		out += col.name;
		let type = generator.formatType(col.type);
		if (col.type.dimensions > 0) type += ".array()".repeat(col.type.dimensions);
		if (col.isNullable || col.generated === "BY DEFAULT" || col.defaultValue) type += `.nullable()`;
		// TODO: update imports for non-primitive types
		out += `: ${type}`;
		types.push(col.type);

		return `\t${out},\n`;
	};

	const composite_attribute = (
		generator: SchemaGenerator,
		types: CanonicalType[],
		attr: CanonicalType.CompositeAttribute,
	) => {
		let out = attr.name;

		out += `: ${generator.formatType(attr.type)}`;
		types.push(attr.type);
		if (attr.type.dimensions > 0) out += ".array()".repeat(attr.type.dimensions);
		if (attr.isNullable) out += ".nullable()";

		return out;
	};

	return {
		formatSchema(name) {
			return to_snake_case(name) + "Schema";
		},

		formatSchemaType(type) {
			return to_snake_case(type.name);
		},

		formatType(type) {
			if (type.schema === "pg_catalog") {
				const name = type.canonical_name;
				const format = builtins[name];
				if (format) return format;
				opts?.warnings?.push(
					`Unknown builtin type: ${name}! Pass customBuiltinMap to map this type. Defaulting to "z.unknown()".`,
				);
				return "z.unknown()";
			}
			return to_snake_case(type.name);
		},

		table(types, table) {
			let out = "";

			if (table.comment) out += `/** ${table.comment} */\n`;
			out += `export const ${this.formatSchemaType(table)} = z.object({\n`;
			for (const col of table.columns) out += column(this, types, col);
			out += "});";

			return out;
		},

		enum(types, en) {
			let out = "";

			if (en.comment) out += `/** ${en.comment} */\n`;

			out += `export const ${this.formatSchemaType(en)} = z.union([`;
			out += en.values.map(v => `z.literal("${v}")`).join(", ");
			out += "]);";

			return out;
		},

		composite(types, type) {
			let out = "";

			if (type.comment) out += `/** ${type.comment} */\n`;
			out += `export const ${this.formatSchemaType(type)} = z.object({\n`;

			const props = type.canonical.attributes.map(c => composite_attribute(this, types, c)).map(t => `\t${t},`);
			out += props.join("\n");
			out += "\n});";

			return out;
		},

		function(types, type) {
			let out = "export const ";
			out += this.formatSchemaType(type);
			out += " = {\n";

			out += `\tparameters: z.tuple([`;

			// Get the input parameters (those that appear in function signature)
			const inputParams = type.parameters.filter(
				p => p.mode === "IN" || p.mode === "INOUT" || p.mode === "VARIADIC",
			);

			if (inputParams.length === 0) {
			} else {
				out += "\n";

				for (const param of inputParams) {
					// Handle variadic parameters differently if needed
					if (param.mode === "VARIADIC") break;

					// TODO: update imports for non-primitive types based on typeInfo.kind
					out += "\t\t" + this.formatType(param.type);
					types.push(param.type);
					if (param.type.dimensions > 0) out += ".array()".repeat(param.type.dimensions);
					if (param.hasDefault) out += ".nullable()";
					out += `, // ${param.name}\n`;
				}
			}

			out += "\t]),\n";

			const variadic = type.parameters.find(p => p.mode === "VARIADIC");
			if (variadic) {
				out += "\tvariadic: ";
				out += this.formatType(variadic.type);
				out += ",\n";
			} else out += "\tvariadic: undefined,\n";

			out += "\treturnType: ";

			if (type.returnType.kind === "table") {
				out += "\t{\n";
				for (const col of type.returnType.columns) {
					out += `\t\t${col.name}: `;
					out += this.formatType(col.type);
					types.push(col.type);
					if (col.type.dimensions > 0) out += ".array()".repeat(col.type.dimensions);
					out += `,\n`;
				}
				out += "\t}";
			} else {
				out += this.formatType(type.returnType.type);
				types.push(type.returnType.type);
				if (type.returnType.type.dimensions > 0) out += ".array()".repeat(type.returnType.type.dimensions);
			}

			// Add additional array brackets if it returns a set
			if (type.returnType.isSet) out += ".array()";
			out += ",\n};";

			return out;
		},

		// TODO: fix filenames, will follow default adapter
		imports(types, context) {
			if (types.length === 0) return [];

			const unique_types = types
				.filter(t => t.schema !== "pg_catalog")
				.filter((t, i, arr) => {
					return arr.findIndex(t2 => t2.canonical_name === t.canonical_name) === i;
				})
				.map(t => ({ ...t, formatted: this.formatType(t) }));

			const imports: string[] = [];

			const current_kind = unique_types //
				.filter(t => t.schema === context.schema && t.kind === context.kind);

			for (const type of current_kind) {
				const name = this.formatType(type);
				imports.push(`import { ${name} } from "./${name}.ts";`);
			}

			const current_schema = unique_types //
				.filter(t => t.schema === context.schema && t.kind !== context.kind);

			for (const type of current_schema) {
				const kind = type.kind;
				const name = this.formatType(type);
				imports.push(`import { ${name} } from "../${kind}s/${name}.ts";`);
			}

			const other_schemas = unique_types.filter(t => t.schema !== context.schema);

			for (const type of other_schemas) {
				const schema = this.formatSchema(type.schema);
				const kind = type.kind;
				const name = this.formatType(type);
				imports.push(`import { ${name} } from "../${schema}/${kind}s/${name}.ts";`);
			}

			return imports.filter(Boolean);
		},

		// TODO: fix filenames, will follow default adapter
		schemaKindIndex(schema, kind) {
			const imports = schema[kind];
			if (imports.length === 0) return "";

			return imports
				.map(each => {
					const name = this.formatSchemaType(each);
					return `export { ${name} } from "./${name}.ts";`;
				})
				.join("\n");
		},

		// TODO: fix filenames, will follow default adapter
		schemaIndex(schema) {
			const supported_kinds = ["tables", "enums", "composites", "functions"] as const;

			let out = supported_kinds.map(kind => `import * as ${kind} from "./${kind}/index.ts";`).join("\n");

			out += "\n\n";
			out += `export const ${this.formatSchema(schema.name)} = {\n`;

			for (const kind of supported_kinds) {
				const items = schema[kind];
				if (items.length === 0) continue;

				out += `\t${kind}: {\n`;

				const formatted = items
					.map(each => {
						const formatted = this.formatSchemaType(each);
						return { ...each, formatted };
					})
					.filter(x => x !== undefined);

				out += formatted
					.map(t => {
						let name = t.name;
						if (isIdentifierInvalid(name)) name = `"${name}"`;
						return `\t\t${name}: ${t.kind}s.${t.formatted};`;
					})
					.join("\n");
				out += "\n\t};\n";
			}

			out += "}";

			return out;
		},

		// TODO: fix filenames, will follow default adapter
		fullIndex(schemas: Schema[]) {
			let out = "";

			out += schemas.map(s => `import { ${this.formatSchema(s.name)} } from "./${s.name}/index.ts";`).join("\n");

			out += "\n\n";
			out += `export const Zod = {\n`;
			out += schemas
				.map(schema => {
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

					if (out.length) out += "\n\n";
					out += formatted
						.map(t => {
							const prefix = defaultSchema === schema.name ? "" : schema.name + ".";
							let qualified = prefix + t.name;
							if (isIdentifierInvalid(qualified)) qualified = `"${qualified}"`;
							return `\t${qualified}: ${this.formatSchema(schema.name)}["${t.kind}s"]["${t.name}"];`;
						})
						.join("\n");

					return out;
				})
				.join("");

			out += "\n}\n\n";

			out += schemas.map(s => `export type { ${this.formatSchema(s.name)} };`).join("\n");

			return out;
		},
	};
});
