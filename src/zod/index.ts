import {
	FunctionReturnTypeKind,
	type Canonical,
	type FunctionReturnType,
	type MaterializedViewColumn,
	type TableColumn,
	type ViewColumn,
} from "../extractor/index.ts";
import { allowed_kind_names, createGenerator, type GeneratorContext, type SchemaGenerator } from "../types.ts";
import { Import } from "../imports.ts";
import { builtins } from "./builtins.ts";
import { to_snake_case, join, quote, quoteI, type Deunionise } from "../util.ts";

// TODO: create an insert and update zod interface for each type?
export const Zod = createGenerator(opts => {
	const defaultSchema = opts?.defaultSchema ?? "public";

	const zod = (ctx: GeneratorContext, name?: string) =>
		ctx.imports.add(
			new Import({
				from: "zod",
				namedImports: name ? [name] : undefined,
				typeOnly: false,
				star: name ? undefined : "z",
			}),
		);

	const add = (ctx: GeneratorContext, type: Canonical | FunctionReturnType.ExistingTable) => {
		if (type.schema === "pg_catalog") zod(ctx, "z");
		else
			ctx.imports.add(
				Import.fromInternal({
					source: ctx.source,
					type,
					withName: generator.formatType(ctx, type),
				}),
			);
	};

	const column = (
		ctx: GeneratorContext,
		/** Information about the column */
		col: Deunionise<TableColumn | ViewColumn | MaterializedViewColumn>,
	) => {
		// don't create a property for always generated columns
		if (col.generated === "ALWAYS") return "";

		let out = col.comment ? `/** ${col.comment} */\n\t` : "";
		out += quoteI(col.name);
		let type = generator.formatType(ctx, col.type);
		add(ctx, col.type);
		if (col.type.dimensions > 0) type += ".array()".repeat(col.type.dimensions);
		if (col.isNullable || col.generated === "BY DEFAULT" || col.defaultValue) type += `.nullable().optional()`;
		out += `: ${type}`;

		return `\t${out},\n`;
	};

	const composite_attribute = (ctx: GeneratorContext, attr: Canonical.CompositeAttribute) => {
		let out = quoteI(attr.name);

		out += `: ${generator.formatType(ctx, attr.type)}`;
		add(ctx, attr.type);
		if (attr.type.dimensions > 0) out += ".array()".repeat(attr.type.dimensions);
		if (attr.isNullable) out += ".nullable().optional()";

		return out;
	};

	const generator: SchemaGenerator = {
		formatSchemaName(name) {
			return to_snake_case(name) + "_validators";
		},

		formatSchemaMemberName(type) {
			return to_snake_case(type.name);
		},

		formatType(ctx, type) {
			if (type.kind === FunctionReturnTypeKind.ExistingTable) {
				return to_snake_case(type.name);
			} else if (type.schema === "pg_catalog") {
				const name = type.canonical_name;
				const format = builtins[name];
				if (format) return format;
				opts?.warnings?.add(
					`(zod) Unknown builtin type: ${name}. Pass 'meta.zod.builtinMap' to map this type. Defaulting to "z.unknown()".`,
				);
				return "z.unknown()";
			}
			return to_snake_case(type.name);
		},

		table(ctx, table) {
			let out = "";

			if (table.comment) out += `/** ${table.comment} */\n`;
			out += `export const ${this.formatSchemaMemberName(table)} = z.object({\n`;
			zod(ctx, "z");
			for (const col of table.columns) out += column(ctx, col);
			out += "});";

			return out;
		},

		view(ctx, view) {
			let out = "";
			if (view.comment) out += `/** ${view.comment} */\n`;
			zod(ctx, "z");
			out += `export const ${this.formatSchemaMemberName(view)} = z.object({\n`;
			for (const col of view.columns) out += column(ctx, col);
			out += "});";

			return out;
		},

		materializedView(ctx, materializedView) {
			let out = "";
			if (materializedView.comment) out += `/** ${materializedView.comment} */\n`;
			zod(ctx, "z");
			out += `export const ${this.formatSchemaMemberName(materializedView)} = z.object({\n`;
			for (const col of materializedView.columns) out += column(ctx, col);
			out += "});";

			return out;
		},

		enum(ctx, en) {
			let out = "";

			if (en.comment) out += `/** ${en.comment} */\n`;

			out += `export const ${this.formatSchemaMemberName(en)} = z.union([\n`;
			out += en.values.map(v => `\tz.literal("${v}")`).join(",\n");
			out += "\n]);";

			zod(ctx, "z");

			return out;
		},

		composite(ctx, type) {
			let out = "";

			if (type.comment) out += `/** ${type.comment} */\n`;
			out += `export const ${this.formatSchemaMemberName(type)} = z.object({\n`;

			const props = type.canonical.attributes.map(c => composite_attribute(ctx, c)).map(t => `\t${t},`);
			out += props.join("\n");
			out += "\n});";

			return out;
		},

		domain(ctx, type) {
			let out = "";
			out += `export const ${this.formatSchemaMemberName(type)} = ${this.formatType(
				ctx,
				type.canonical.domain_base_type,
			)};`;
			zod(ctx, "z");
			return out;
		},

		range(ctx, type) {
			let out = "";
			out += `export const ${this.formatSchemaMemberName(type)} = z.string();`;
			zod(ctx, "z");
			return out;
		},

		function(ctx, type) {
			let out = "export const ";
			out += this.formatSchemaMemberName(type);
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
					out += "\t\t" + this.formatType(ctx, param.type);
					add(ctx, param.type);
					if (param.type.dimensions > 0) out += ".array()".repeat(param.type.dimensions);
					if (param.hasDefault) out += ".nullable().optional()";
					out += `, // ${param.name}\n`;
				}

				out += "\t])";
			}

			const variadic = type.parameters.find(p => p.mode === "VARIADIC");
			if (variadic) {
				out += ".rest(";
				out += this.formatType(ctx, variadic.type);
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
						out += this.formatType(ctx, col.type);
						add(ctx, col.type);
						if (col.type.dimensions > 0) out += ".array()".repeat(col.type.dimensions);
						out += `,\n`;
					}
					out += "\t})";
				}
			} else if (type.returnType.kind === FunctionReturnTypeKind.ExistingTable) {
				out += this.formatType(ctx, type.returnType);
				add(ctx, type.returnType);
			} else {
				out += this.formatType(ctx, type.returnType.type);
				add(ctx, type.returnType.type);
				if (type.returnType.type.dimensions > 0) out += ".array()".repeat(type.returnType.type.dimensions);
			}

			// Add additional array brackets if it returns a set
			if (type.returnType.isSet) out += ".array()";
			out += ",\n};";

			zod(ctx, "z");
			return out;
		},

		schemaKindIndex(ctx, schema, kind, main_generator) {
			const imports = schema[kind];
			if (imports.length === 0) return "";
			const generator = main_generator ?? this;

			return imports
				.map(each => {
					const name = this.formatSchemaMemberName(each);
					const file = generator.formatSchemaMemberName(each);
					return `export { ${name} } from "./${file}.ts";`;
				})
				.join("\n");
		},

		schemaIndex(ctx, schema, main_generator) {
			const actual_kinds = allowed_kind_names.filter(kind => schema[kind].length);
			// we could in theory use the imports from GeneratorContext here, but this works fine
			let out = actual_kinds.map(kind => `import * as zod_${kind} from "./${kind}/index.ts";`).join("\n");

			out += "\n\n";
			out += `export const ${this.formatSchemaName(schema.name)} = {\n`;

			for (const kind of actual_kinds) {
				const items = schema[kind];
				if (items.length === 0) continue;

				out += `\t${kind}: {\n`;

				const formatted = items
					.map(each => {
						const formatted = this.formatSchemaMemberName(each);
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

		fullIndex(ctx, schemas, main_generator) {
			const generator = main_generator ?? this;

			const parts: string[] = [];

			parts.push(
				schemas
					.map(s => `import { ${generator.formatSchemaName(s.name)} } from "./${s.name}/index.ts";`)
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
										const formatted = generator.formatSchemaMemberName(each);
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

										return `\t${qualified}: ${this.formatSchemaName(schema.name)}[${quote(
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

			parts.push(schemas.map(s => `export type { ${this.formatSchemaName(s.name)} };`).join("\n"));

			return join(parts);
		},
	};

	return generator;
});
