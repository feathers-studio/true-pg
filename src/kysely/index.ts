import {
	Canonical,
	FunctionReturnTypeKind,
	type FunctionReturnType,
	type MaterializedViewColumn,
	type TableColumn,
	type ViewColumn,
} from "../extractor/index.ts";
import { allowed_kind_names, createGenerator, type GeneratorContext, type SchemaGenerator } from "../types.ts";
import { Import } from "../imports.ts";
import { builtins } from "./builtins.ts";
import { toPascalCase, join, quote, quoteI, type Deunionise } from "../util.ts";

export const Kysely = createGenerator(opts => {
	const defaultSchema = opts?.defaultSchema ?? "public";

	const ky = (ctx: GeneratorContext, name: string) => {
		ctx.imports.add(
			new Import({
				from: "kysely",
				namedImports: [name],
				typeOnly: true,
			}),
		);
	};

	const column = (
		/** "this" */
		generator: SchemaGenerator,
		ctx: GeneratorContext,
		/** Information about the column */
		col: Deunionise<TableColumn | ViewColumn | MaterializedViewColumn>,
	) => {
		let base = generator.formatType(ctx, col.type, { nullable: col.isNullable });

		let qualified = base;
		if (col.generated === "ALWAYS") {
			qualified = `GeneratedAlways<${qualified}>`;
			ky(ctx, "GeneratedAlways");
		} else if (col.generated === "BY DEFAULT") {
			qualified = `Generated<${qualified}>`;
			ky(ctx, "Generated");
		} else if (col.defaultValue) {
			qualified = `Generated<${qualified}>`;
			ky(ctx, "Generated");
		}

		let out = col.comment ? `/** ${col.comment} */\n\t` : "";
		out += quoteI(col.name);
		// TODO: update imports for non-primitive types
		out += `: ${qualified}`;

		return `\t${out};\n`;
	};

	const composite_attribute = (
		ctx: GeneratorContext,
		generator: SchemaGenerator,
		attr: Canonical.CompositeAttribute,
	) => {
		let out = quoteI(attr.name);

		if (attr.isNullable) out += "?";
		out += ": ";
		out += generator.formatType(ctx, attr.type, { nullable: attr.isNullable });

		return out;
	};

	const generator: SchemaGenerator = {
		formatSchemaName(name) {
			return toPascalCase(name) + "Schema";
		},

		formatSchemaMemberName(type) {
			return toPascalCase(type.name);
		},

		formatType(ctx, type, attr) {
			let base;

			if (type.kind === FunctionReturnTypeKind.ExistingTable) {
				base = toPascalCase(type.name);
			} else if (type.schema === "pg_catalog") {
				const name = type.canonical_name;
				const format = builtins[name];
				if (format) base = format;
				else {
					opts?.warnings?.add(
						`(kysely) Unknown builtin type: ${name}. Pass 'kysely.builtinMap' to map this type. Defaulting to "unknown".`,
					);
					base = "unknown";
				}
			} else base = toPascalCase(type.name);

			if (type.schema !== "pg_catalog") {
				// before adding modifiers, add the import
				ctx.imports.add(
					Import.fromInternal({
						source: ctx.source,
						type,
						withName: base,
						typeOnly: true,
					}),
				);
			}

			if ("dimensions" in type) base += "[]".repeat(type.dimensions);
			if (attr?.nullable) base += " | null";

			return base;
		},

		table(ctx, table) {
			let out = "";

			if (table.comment) out += `/** ${table.comment} */\n`;
			out += `export interface ${this.formatSchemaMemberName(table)} {\n`;
			for (const col of table.columns) out += column(this, ctx, col);
			out += "}";

			return out;
		},

		view(ctx, view) {
			let out = "";
			if (view.comment) out += `/** ${view.comment} */\n`;
			out += `export interface ${this.formatSchemaMemberName(view)} {\n`;
			for (const col of view.columns) out += column(this, ctx, col);
			out += "}";

			return out;
		},

		materializedView(ctx, materializedView) {
			let out = "";
			if (materializedView.comment) out += `/** ${materializedView.comment} */\n`;
			out += `export interface ${this.formatSchemaMemberName(materializedView)} {\n`;
			for (const col of materializedView.columns) out += column(this, ctx, col);
			out += "}";

			return out;
		},

		enum(ctx, en) {
			let out = "";
			if (en.comment) out += `/** ${en.comment} */\n`;
			out += `export type ${this.formatSchemaMemberName(en)} = ${en.values.map(v => `"${v}"`).join(" | ")};`;
			return out;
		},

		composite(ctx, type) {
			let out = "";

			if (type.comment) out += `/** ${type.comment} */\n`;
			out += `export interface ${this.formatSchemaMemberName(type)} {\n`;

			const props = type.canonical.attributes.map(c => composite_attribute(ctx, this, c)).map(t => `\t${t};`);
			out += props.join("\n");
			out += "\n}";

			return out;
		},

		domain(ctx, type) {
			let out = "";
			out += `export type ${this.formatSchemaMemberName(type)} = ${this.formatType(
				ctx,
				type.canonical.domain_base_type,
			)};`;
			return out;
		},

		range(ctx, type) {
			let out = "";
			// force this to be string because range has to be passed as a string to Kysely
			out += `export type ${this.formatSchemaMemberName(type)} = string;`;
			return out;
		},

		function(ctx, type) {
			let out = "";

			out += "/**\n";
			if (type.comment) out += ` * ${type.comment}\n`;
			out += ` * @volatility ${type.volatility}\n`;
			out += ` * @parallelSafety ${type.parallelSafety}\n`;
			out += ` * @isStrict ${type.isStrict}\n`;
			out += " */\n";
			out += `export interface ${this.formatSchemaMemberName(type)} {\n\t`;

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
				out += this.formatType(ctx, inputParams[0]!.type);
				out += "): ";
			} else if (inputParams.length > 0) {
				out += "(\n";

				for (const param of inputParams) {
					// Handle variadic parameters differently if needed
					const isVariadic = param.mode === "VARIADIC";
					const paramName = isVariadic ? `...${param.name}` : param.name;

					out += `\t\t${paramName}`;
					if (param.hasDefault && !isVariadic) out += "?";
					out += `: ${this.formatType(ctx, param.type)}`;
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
						out += this.formatType(ctx, col.type);
						out += `;\n`;
					}
					out += "\t}";
				}
			} else if (type.returnType.kind === FunctionReturnTypeKind.ExistingTable) {
				out += this.formatType(ctx, type.returnType);
			} else {
				out += this.formatType(ctx, type.returnType.type);
			}

			// Add additional array brackets if it returns a set
			if (type.returnType.isSet) {
				out += "[]";
			}

			out += ";\n}";

			return out;
		},

		schemaKindIndex(ctx, schema, kind, main_generator) {
			const generator = main_generator ?? this;
			const imports = schema[kind];
			if (imports.length === 0) return "";

			return imports
				.map(each => {
					const name = generator.formatSchemaMemberName(each);
					const file = generator.formatSchemaMemberName(each);
					return `export type { ${name} } from "./${file}.ts";`;
				})
				.join("\n");
		},

		schemaIndex(ctx, schema) {
			const actual_kinds = allowed_kind_names.filter(kind => schema[kind].length);
			// we could in theory use the imports from GeneratorContext here, but this works fine
			let out = actual_kinds.map(kind => `import type * as ${kind} from "./${kind}/index.ts";`).join("\n");

			out += "\n\n";
			out += `export interface ${this.formatSchemaName(schema.name)} {\n`;

			for (const kind of actual_kinds) {
				const items = schema[kind];
				if (items.length === 0) continue;

				out += `\t${kind}: {\n`;

				const formatted = items
					.map(each => {
						const formatted = generator.formatSchemaMemberName(each);
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

		fullIndex(ctx, schemas) {
			const parts: string[] = [];

			parts.push(
				schemas
					.map(s => `import type { ${generator.formatSchemaName(s.name)} } from "./${s.name}/index.ts";`)
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
								const formatted = generator.formatSchemaMemberName(each);
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

								return `\t${qualified}: ${generator.formatSchemaName(schema.name)}[${quote(
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

			parts.push(schemas.map(s => `export type { ${generator.formatSchemaName(s.name)} };`).join("\n"));

			return join(parts);
		},
	};

	return generator;
});
