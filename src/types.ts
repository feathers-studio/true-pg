import type {
	CanonicalType,
	CompositeTypeDetails,
	EnumDetails,
	FunctionDetails,
	TableDetails,
	SchemaType,
	Schema,
	Extractor,
} from "pg-extract";

// import type { ClientConfig, Pool, PoolConfig } from "pg";

import { dirname, relative } from "node:path";
import { join } from "./util.ts";

// To be updated when we add support for other kinds
export const allowed_kind_names = ["tables", "enums", "composites", "functions"] as const;
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

export namespace Nodes {
	export class ExternalImport {
		// what to import
		name: string;
		// use `type` syntax?
		typeOnly: boolean;
		// use `* as` syntax?
		star: boolean;

		// this is an external import
		external: true;
		// what module to import from
		module: string;

		constructor(args: { name: string; module: string; typeOnly: boolean; star: boolean }) {
			this.name = args.name;
			this.typeOnly = args.typeOnly;
			this.star = args.star;
			this.external = true;
			this.module = args.module;
		}
	}

	export class InternalImport {
		// what to import
		name: string;
		// underlying type that is being imported
		canonical_type: CanonicalType;
		// use `type` syntax?
		typeOnly: boolean;
		// use `* as` syntax?
		star: boolean;

		// this is an internal import
		external: false;

		constructor(args: { name: string; canonical_type: CanonicalType; typeOnly: boolean; star: boolean }) {
			this.name = args.name;
			this.canonical_type = args.canonical_type;
			this.star = args.star;
			this.typeOnly = args.typeOnly;
			this.external = false;
		}
	}

	export class ImportList {
		constructor(public imports: (ExternalImport | InternalImport)[]) {}

		static merge(lists: ImportList[]) {
			return new ImportList(lists.flatMap(l => l.imports));
		}

		add(item: ExternalImport | InternalImport) {
			this.imports.push(item);
		}

		stringify(context_file: string, files: FolderStructure) {
			const externals = this.imports.filter(i => i.external);
			const internals = this.imports.filter(i => !i.external);

			const modulegroups: Record<string, ExternalImport[]> = {};
			for (const item of externals) {
				const group = modulegroups[item.module];
				if (group) group.push(item);
				else modulegroups[item.module] = [item];
			}

			const out = [];

			// TODO: normalise external and internal imports and handle the stringification of the imports in a single place

			{
				// EXTERNAL IMPORTS

				const imports = [];
				for (const module in modulegroups) {
					const items = modulegroups[module]!;
					const star = items.find(i => i.star);
					const unique = items.filter((i, index, arr) => {
						if (i.star) return false;
						if (arr.findIndex(i2 => i2.name === i.name) !== index) return false;
						return true;
					});

					const bits = [];
					const typeOnlys = unique.filter(i => i.typeOnly);
					const values = unique.filter(i => !i.typeOnly);

					// if no values to import, use `import type { ... }` instead of `import { type ... }`
					const typeInline = values.length !== 0;

					let import_line = `import `;
					for (const type of typeOnlys) bits.push(typeInline ? "type " : "" + type.name);
					for (const type of values) bits.push(type.name);
					if (bits.length) import_line += (typeInline ? "" : "type ") + "{ " + bits.join(", ") + " }";
					if (bits.length && star) import_line += `, `;
					if (star) import_line += `* as ${star.name}`;
					if (bits.length || star) import_line += ` from `;
					import_line += `"${module}";`;
					imports.push(import_line);
				}
				out.push(join(imports, "\n"));
			}

			{
				// INTERNAL IMPORTS

				const imports = [];
				const unique_types = internals
					.filter(({ name: name1, canonical_type: int }, index, arr) => {
						return (
							arr.findIndex(({ name: name2, canonical_type: int2 }) => {
								return (
									// adapter-assigned name
									name2 === name1 &&
									// canonical type details
									int2.name === int.name &&
									int2.schema === int.schema &&
									int2.kind === int.kind
								);
							}) === index
						);
					})
					.map(imp => {
						const t = imp.canonical_type;
						const schema = files.children[t.schema]!;
						const kind = schema.children[`${t.kind}s`]!;
						const type = kind.children[t.name]!;
						const located_file = `${files.name}/${schema.name}/${kind.kind}/${type.name}.ts`;
						return { ...imp, located_file };
					});

				const group_by_file: Record<string, (InternalImport & { located_file: string })[]> = {};
				for (const type of unique_types) {
					const file = group_by_file[type.located_file] || [];
					file.push(type);
					group_by_file[type.located_file] = file;
				}

				for (const group in group_by_file) {
					let relative_path = relative(dirname(context_file), group);
					if (/^[^\.+\/]/.test(relative_path)) relative_path = "./" + relative_path;
					const items = group_by_file[group]!;
					const typeOnlys = items.filter(i => i.typeOnly);
					const values = items.filter(i => !i.typeOnly);
					const star = values.find(i => i.star);
					let import_line = "import ";
					const bits = [];

					// if no values to import, use `import type { ... }` instead of `import { type ... }`
					const typeInline = values.length !== 0;

					for (const type of typeOnlys) bits.push((typeInline ? "type " : "") + type.name);
					for (const type of values) bits.push(type.name);
					if (bits.length) import_line += (typeInline ? "" : "type ") + "{ " + bits.join(", ") + " }";
					if (star) import_line += `* as ${star.name}`;
					import_line += ` from "${relative_path}";`;
					imports.push(import_line);
				}

				out.push(join(imports, "\n"));
			}

			return join(out);
		}
	}

	export interface Export {
		// what to export
		name: string;
		// what kind of thing to export
		kind: SchemaType["kind"];
		// what schema to export from
		schema: string;
		// use `* as` syntax?
		star: boolean;
	}
}

export type ExtractorConfig = Exclude<ConstructorParameters<typeof Extractor>[0], string | undefined>;

export interface TruePGOpts {
	pg?: ExtractorConfig["pg"];
	uri?: ExtractorConfig["uri"];
	config?: ExtractorConfig["config"];
	out: string;
	adapters: string[];
	defaultSchema?: string;
}

export function config(opts: TruePGOpts) {
	return opts;
}

export interface CreateGeneratorOpts {
	defaultSchema?: string;
	warnings: string[];
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
	formatType(type: CanonicalType): string;

	table(
		/** @out Append used types to this array */
		imports: Nodes.ImportList,
		/** Information about the table */
		table: TableDetails,
	): string;

	enum(
		/** @out Append used types to this array */
		imports: Nodes.ImportList,
		/** Information about the enum */
		en: EnumDetails,
	): string;

	composite(
		/** @out Append used types to this array */
		imports: Nodes.ImportList,
		/** Information about the composite type */
		type: CompositeTypeDetails,
	): string;

	function(
		/** @out Append used types to this array */
		imports: Nodes.ImportList,
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
