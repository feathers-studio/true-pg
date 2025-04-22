import {
	Canonical,
	FunctionReturnTypeKind,
	type FunctionReturnType,
	type MaterializedViewColumn,
	type Schema,
	type TableColumn,
	type ViewColumn,
} from "../extractor/index.ts";
import { allowed_kind_names, createGenerator, type SchemaGenerator } from "../types.ts";
import { Import, ImportList } from "../imports.ts";
import { builtins } from "./builtins.ts";
import { toPascalCase, join, quote, quoteI, type Deunionise } from "../util.ts";

export const Kysely = createGenerator(opts => {
	const defaultSchema = opts?.defaultSchema ?? "public";

	const ky = (imports: ImportList, name: string) =>
		imports.add(
			new Import({
				from: "kysely",
				namedImports: [name],
				typeOnly: true,
			}),
		);

	const add = (imports: ImportList, type: Canonical | FunctionReturnType.ExistingTable) => {
		if (type.schema === "pg_catalog") return;
		imports.add(
			Import.fromInternal({
				type,
				withName: generator.formatType(type),
				typeOnly: true,
			}),
		);
	};

	const column = (
		/** "this" */
		generator: SchemaGenerator,
		/** @out Append used types to this array */
		imports: ImportList,
		/** Information about the column */
		col: Deunionise<TableColumn | ViewColumn | MaterializedViewColumn>,
	) => {
		let base = generator.formatType(col.type);
		if (col.type.dimensions > 0) base += "[]".repeat(col.type.dimensions);
		if (col.isNullable) base += " | null";

		let qualified = base;
		if (col.generated === "ALWAYS") {
			qualified = `GeneratedAlways<${qualified}>`;
			ky(imports, "GeneratedAlways");
		} else if (col.generated === "BY DEFAULT") {
			qualified = `Generated<${qualified}>`;
			ky(imports, "Generated");
		} else if (col.defaultValue) {
			qualified = `Generated<${qualified}>`;
			ky(imports, "Generated");
		}

		let out = col.comment ? `/** ${col.comment} */\n\t` : "";
		out += quoteI(col.name);
		// TODO: update imports for non-primitive types
		out += `: ${qualified}`;
		add(imports, col.type);

		return `\t${out};\n`;
	};

	const composite_attribute = (
		generator: SchemaGenerator,
		imports: ImportList,
		attr: Canonical.CompositeAttribute,
	) => {
		let out = quoteI(attr.name);

		if (attr.isNullable) out += "?";
		out += `: ${generator.formatType(attr.type)}`;
		add(imports, attr.type);
		if (attr.type.dimensions > 0) out += "[]".repeat(attr.type.dimensions);
		if (attr.isNullable) out += " | null";

		return out;
	};

	const generator: SchemaGenerator = {
		formatSchema(name) {
			return toPascalCase(name) + "Schema";
		},

		formatSchemaType(type) {
			return toPascalCase(type.name);
		},

		formatType(type) {
			if (type.kind === FunctionReturnTypeKind.ExistingTable) {
				return toPascalCase(type.name);
			} else if (type.schema === "pg_catalog") {
				const name = type.canonical_name;
				const format = builtins[name];
				if (format) return format;
				opts?.warnings?.add(
					`(kysely) Unknown builtin type: ${name}. Pass 'kysely.builtinMap' to map this type. Defaulting to "unknown".`,
				);
				return "unknown";
			}
			return toPascalCase(type.name);
		},

		table(imports, table) {
			let out = "";

			if (table.comment) out += `/** ${table.comment} */\n`;
			out += `export interface ${this.formatSchemaType(table)} {\n`;
			for (const col of table.columns) out += column(this, imports, col);
			out += "}";

			return out;
		},

		view(imports, view) {
			let out = "";
			if (view.comment) out += `/** ${view.comment} */\n`;
			out += `export interface ${this.formatSchemaType(view)} {\n`;
			for (const col of view.columns) out += column(this, imports, col);
			out += "}";

			return out;
		},

		materializedView(imports, materializedView) {
			let out = "";
			if (materializedView.comment) out += `/** ${materializedView.comment} */\n`;
			out += `export interface ${this.formatSchemaType(materializedView)} {\n`;
			for (const col of materializedView.columns) out += column(this, imports, col);
			out += "}";

			return out;
		},

		enum(imports, en) {
			let out = "";
			if (en.comment) out += `/** ${en.comment} */\n`;
			out += `export type ${this.formatSchemaType(en)} = ${en.values.map(v => `"${v}"`).join(" | ")};`;
			return out;
		},

		composite(imports, type) {
			let out = "";

			if (type.comment) out += `/** ${type.comment} */\n`;
			out += `export interface ${this.formatSchemaType(type)} {\n`;

			const props = type.canonical.attributes.map(c => composite_attribute(this, imports, c)).map(t => `\t${t};`);
			out += props.join("\n");
			out += "\n}";

			return out;
		},

		domain(imports, type) {
			let out = "";
			out += `export type ${this.formatSchemaType(type)} = ${this.formatType(type.canonical.domain_base_type)};`;
			return out;
		},

		range(imports, type) {
			let out = "";
			// force this to be string because range has to be passed as a string to Kysely
			out += `export type ${this.formatSchemaType(type)} = string;`;
			return out;
		},

		function(imports, type) {
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
				add(imports, inputParams[0]!.type);
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
					out += `: ${this.formatType(param.type)}`;
					add(imports, param.type);
					if (param.type.dimensions > 0) out += "[]".repeat(param.type.dimensions);
					if (!isVariadic) out += ",";
					out += "\n";
				}

				out += "\t): ";
			}

			if (type.returnType.kind === FunctionReturnTypeKind.InlineTable) {
				if (type.returnType.columns.length === 0) out += "void/* RETURNS TABLE with no columns */";
				else {
					out += "{\n";
					for (const col of type.returnType.columns) {
						out += `\t\t"${col.name}": `;
						out += this.formatType(col.type);
						add(imports, col.type);
						if (col.type.dimensions > 0) out += "[]".repeat(col.type.dimensions);
						out += `;\n`;
					}
					out += "\t}";
				}
			} else if (type.returnType.kind === FunctionReturnTypeKind.ExistingTable) {
				out += this.formatType(type.returnType);
				add(imports, type.returnType);
			} else {
				out += this.formatType(type.returnType.type);
				add(imports, type.returnType.type);
				if (type.returnType.type.dimensions > 0) out += "[]".repeat(type.returnType.type.dimensions);
			}

			// Add additional array brackets if it returns a set
			if (type.returnType.isSet) {
				out += "[]";
			}

			out += ";\n}";

			return out;
		},

		schemaKindIndex(schema, kind, main_generator) {
			const generator = main_generator ?? this;
			const imports = schema[kind];
			if (imports.length === 0) return "";

			return imports
				.map(each => {
					const name = this.formatSchemaType(each);
					const file = generator.formatSchemaType(each);
					return `export type { ${name} } from "./${file}.ts";`;
				})
				.join("\n");
		},

		schemaIndex(schema) {
			const actual_kinds = allowed_kind_names.filter(kind => schema[kind].length);
			let out = actual_kinds.map(kind => `import type * as ${kind} from "./${kind}/index.ts";`).join("\n");

			out += "\n\n";
			out += `export interface ${this.formatSchema(schema.name)} {\n`;

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
						return `\t\t${name}: ${t.kind}s.${t.formatted};`;
					})
					.join("\n");
				out += "\n\t};\n";
			}

			out += "}";

			return out;
		},

		fullIndex(schemas: Schema[]) {
			const parts: string[] = [];

			parts.push(
				schemas
					.map(s => `import type { ${this.formatSchema(s.name)} } from "./${s.name}/index.ts";`)
					.join("\n"),
			);

			{
				let iface = `export interface Database {\n`;
				iface += schemas
					.map(schema => {
						// only tables, views, and materialized views are queryable
						const tables = [...schema.tables, ...schema.views, ...schema.materializedViews];

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
								const isDefault = defaultSchema === schema.name;

								let qualified = "";
								if (!isDefault) qualified = schema.name + "." + t.name;
								else qualified = t.name;
								qualified = quoteI(qualified);

								return `\t${qualified}: ${this.formatSchema(schema.name)}[${quote(
									t.kind + "s",
								)}][${quote(t.name)}];`;
							})
							.join("\n");

						return out;
					})
					.join("\n");

				iface += "\n}";
				parts.push(iface);
			}

			parts.push(schemas.map(s => `export type { ${this.formatSchema(s.name)} };`).join("\n"));

			return join(parts);
		},
	};

	return generator;
});
