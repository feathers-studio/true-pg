import {
	FunctionReturnTypeKind,
	type Canonical,
	type FunctionReturnType,
	type MaterializedViewColumn,
	type Schema,
	type TableColumn,
	type ViewColumn,
} from "../extractor/index.ts";
import { allowed_kind_names, createGenerator, Nodes, type SchemaGenerator } from "../types.ts";
import { builtins } from "./builtins.ts";
import { join, quote, quoteI, type Deunionise } from "../util.ts";

const to_snake_case = (str: string) =>
	str
		.replace(/^[^a-zA-Z]+/, "") // remove leading non-alphabetic characters
		.replace(/[^a-zA-Z0-9]+/g, "_") // replace non-alphanumeric characters with underscores
		.replace(/([A-Z])/g, "_$1") // insert underscores before uppercase letters
		.toLowerCase();

// TODO: create an insert and update zod interface for each type
export const Zod = createGenerator(opts => {
	const defaultSchema = opts?.defaultSchema ?? "public";

	const zod = (imports: Nodes.ImportList, name?: string) =>
		imports.add(
			new Nodes.ExternalImport({
				name: name ?? "z",
				module: "zod",
				typeOnly: false,
				star: !name,
			}),
		);

	const add = (imports: Nodes.ImportList, type: Canonical | FunctionReturnType.ExistingTable) => {
		if (type.schema === "pg_catalog") zod(imports, "z");
		else
			imports.add(
				new Nodes.InternalImport({
					name: generator.formatType(type),
					canonical_type: type,
					typeOnly: false,
					star: false,
				}),
			);
	};

	const column = (
		imports: Nodes.ImportList,
		/** Information about the column */
		col: Deunionise<TableColumn | ViewColumn | MaterializedViewColumn>,
	) => {
		// don't create a property for always generated columns
		if (col.generated === "ALWAYS") return "";

		let out = col.comment ? `/** ${col.comment} */\n\t` : "";
		out += quoteI(col.name);
		let type = generator.formatType(col.type);
		add(imports, col.type);
		if (col.type.dimensions > 0) type += ".array()".repeat(col.type.dimensions);
		if (col.isNullable || col.generated === "BY DEFAULT" || col.defaultValue) type += `.nullable().optional()`;
		out += `: ${type}`;

		return `\t${out},\n`;
	};

	const composite_attribute = (imports: Nodes.ImportList, attr: Canonical.CompositeAttribute) => {
		let out = quoteI(attr.name);

		out += `: ${generator.formatType(attr.type)}`;
		add(imports, attr.type);
		if (attr.type.dimensions > 0) out += ".array()".repeat(attr.type.dimensions);
		if (attr.isNullable) out += ".nullable().optional()";

		return out;
	};

	const generator: SchemaGenerator = {
		formatSchema(name) {
			return to_snake_case(name) + "_validators";
		},

		formatSchemaType(type) {
			return to_snake_case(type.name);
		},

		formatType(type) {
			if (type.kind === FunctionReturnTypeKind.ExistingTable) {
				return to_snake_case(type.name);
			} else if (type.schema === "pg_catalog") {
				const name = type.canonical_name;
				const format = builtins[name];
				if (format) return format;
				opts?.warnings?.push(
					`(zod) Unknown builtin type: ${name}. Pass customBuiltinMap to map this type. Defaulting to "z.unknown()".`,
				);
				return "z.unknown()";
			}
			return to_snake_case(type.name);
		},

		table(imports, table) {
			let out = "";

			if (table.comment) out += `/** ${table.comment} */\n`;
			out += `export const ${this.formatSchemaType(table)} = z.object({\n`;
			zod(imports, "z");
			for (const col of table.columns) out += column(imports, col);
			out += "});";

			return out;
		},

		view(imports, view) {
			let out = "";
			if (view.comment) out += `/** ${view.comment} */\n`;
			zod(imports, "z");
			out += `export const ${this.formatSchemaType(view)} = z.object({\n`;
			for (const col of view.columns) out += column(imports, col);
			out += "});";

			return out;
		},

		materializedView(imports, materializedView) {
			let out = "";
			if (materializedView.comment) out += `/** ${materializedView.comment} */\n`;
			zod(imports, "z");
			out += `export const ${this.formatSchemaType(materializedView)} = z.object({\n`;
			for (const col of materializedView.columns) out += column(imports, col);
			out += "});";

			return out;
		},

		enum(imports, en) {
			let out = "";

			if (en.comment) out += `/** ${en.comment} */\n`;

			out += `export const ${this.formatSchemaType(en)} = z.union([\n`;
			out += en.values.map(v => `\tz.literal("${v}")`).join(",\n");
			out += "\n]);";

			zod(imports, "z");

			return out;
		},

		composite(imports, type) {
			let out = "";

			if (type.comment) out += `/** ${type.comment} */\n`;
			out += `export const ${this.formatSchemaType(type)} = z.object({\n`;

			const props = type.canonical.attributes.map(c => composite_attribute(imports, c)).map(t => `\t${t},`);
			out += props.join("\n");
			out += "\n});";

			return out;
		},

		domain(imports, type) {
			let out = "";
			out += `export const ${this.formatSchemaType(type)} = ${this.formatType(type.canonical.domain_base_type)};`;
			zod(imports, "z");
			return out;
		},

		range(imports, type) {
			let out = "";
			out += `export const ${this.formatSchemaType(type)} = z.string();`;
			zod(imports, "z");
			return out;
		},

		function(imports, type) {
			let out = "export const ";
			out += this.formatSchemaType(type);
			out += " = {\n";

			out += `\tparameters: z.tuple([`;

			// Get the input parameters (those that appear in function signature)
			const inputParams = type.parameters.filter(p => p.mode === "IN" || p.mode === "INOUT");

			if (inputParams.length === 0) {
				out += "])";
			} else {
				out += "\n";

				for (const param of inputParams) {
					// TODO: update imports for non-primitive types based on typeInfo.kind
					out += "\t\t" + this.formatType(param.type);
					add(imports, param.type);
					if (param.type.dimensions > 0) out += ".array()".repeat(param.type.dimensions);
					if (param.hasDefault) out += ".nullable().optional()";
					out += `, // ${param.name}\n`;
				}

				out += "\t])";
			}

			const variadic = type.parameters.find(p => p.mode === "VARIADIC");
			if (variadic) {
				out += ".rest(";
				out += this.formatType(variadic.type);
				// reduce by 1 because it's already a rest parameter
				if (variadic.type.dimensions > 1) out += ".array()".repeat(variadic.type.dimensions - 1);
				out += ")" + ", // " + variadic.name + "\n";
			} else out += ",\n";

			out += "\treturnType: ";

			if (type.returnType.kind === FunctionReturnTypeKind.InlineTable) {
				if (type.returnType.columns.length === 0) out += "z.void()/* RETURNS TABLE with no columns */";
				else {
					out += "z.object({\n";
					for (const col of type.returnType.columns) {
						out += `\t\t"${col.name}": `;
						out += this.formatType(col.type);
						add(imports, col.type);
						if (col.type.dimensions > 0) out += ".array()".repeat(col.type.dimensions);
						out += `,\n`;
					}
					out += "\t})";
				}
			} else if (type.returnType.kind === FunctionReturnTypeKind.ExistingTable) {
				out += this.formatType(type.returnType);
				add(imports, type.returnType);
			} else {
				out += this.formatType(type.returnType.type);
				add(imports, type.returnType.type);
				if (type.returnType.type.dimensions > 0) out += ".array()".repeat(type.returnType.type.dimensions);
			}

			// Add additional array brackets if it returns a set
			if (type.returnType.isSet) out += ".array()";
			out += ",\n};";

			zod(imports, "z");
			return out;
		},

		schemaKindIndex(schema, kind, main_generator) {
			const imports = schema[kind];
			if (imports.length === 0) return "";
			const generator = main_generator ?? this;

			return imports
				.map(each => {
					const name = this.formatSchemaType(each);
					const file = generator.formatSchemaType(each);
					return `export { ${name} } from "./${file}.ts";`;
				})
				.join("\n");
		},

		schemaIndex(schema, main_generator) {
			const actual_kinds = allowed_kind_names.filter(kind => schema[kind].length);
			let out = actual_kinds.map(kind => `import * as zod_${kind} from "./${kind}/index.ts";`).join("\n");

			out += "\n\n";
			out += `export const ${this.formatSchema(schema.name)} = {\n`;

			for (const kind of actual_kinds) {
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
						let name = quoteI(t.name);
						return `\t\t${name}: zod_${t.kind}s.${t.formatted},`;
					})
					.join("\n");
				out += "\n\t},\n";
			}

			out += "}";

			return out;
		},

		fullIndex(schemas: Schema[], main_generator) {
			const generator = main_generator ?? this;

			const parts: string[] = [];

			parts.push(
				schemas
					.map(s => `import { ${generator.formatSchema(s.name)} } from "./${s.name}/index.ts";`)
					.join("\n"),
			);

			{
				let validator = `export const Validators = {\n`;
				validator += join(
					schemas.map(schema => {
						const schema_validators = join(
							allowed_kind_names.map(kind => {
								const current = schema[kind];

								const seen = new Set<string>();
								const formatted = current
									.map(each => {
										const formatted = generator.formatSchemaType(each);
										// skip clashing names
										if (seen.has(formatted)) return;
										seen.add(formatted);
										return { ...each, formatted };
									})
									.filter(x => x !== undefined);

								if (!formatted.length) return "";

								let out = "";
								out += "\t// " + kind + "\n";
								out += join(
									formatted.map(t => {
										const isDefault = defaultSchema === schema.name;

										let qualified = "";
										if (!isDefault) qualified = schema.name + "." + t.name;
										else qualified = t.name;
										qualified = quoteI(qualified);

										return `\t${qualified}: ${this.formatSchema(schema.name)}[${quote(
											t.kind + "s",
										)}][${quote(t.name)}],`;
									}),
									"\n",
								);
								return out;
							}),
						);
						return `\t/* -- ${schema.name} --*/\n\n` + schema_validators || "\t-- no validators\n\n";
					}),
				);

				validator += "\n};";
				parts.push(validator);
			}

			parts.push(schemas.map(s => `export type { ${this.formatSchema(s.name)} };`).join("\n"));

			return join(parts);
		},
	};

	return generator;
});
