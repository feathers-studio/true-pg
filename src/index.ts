import { Extractor, FunctionReturnTypeKind } from "./extractor/index.ts";
import type { FunctionDetails, Schema } from "./extractor/index.ts";
import { rm, mkdir, writeFile } from "fs/promises";
import { Nodes, allowed_kind_names, type FolderStructure, type TruePGConfig, type createGenerator } from "./types.ts";
import { existsSync } from "fs";
import { join } from "./util.ts";

export { config } from "./types.ts";

import { Kysely } from "./kysely/index.ts";
import { Zod } from "./zod/index.ts";

export const adapters: Record<string, createGenerator> = {
	kysely: Kysely,
	zod: Zod,
};

const filter_function = (func: FunctionDetails, warnings: string[]) => {
	const typesToFilter = [
		"pg_catalog.trigger",
		"pg_catalog.event_trigger",
		"pg_catalog.internal",
		"pg_catalog.language_handler",
		"pg_catalog.fdw_handler",
		"pg_catalog.index_am_handler",
		"pg_catalog.tsm_handler",
	];

	const warn = (type: string) =>
		warnings.push(`Skipping function ${func.name}: cannot represent ${type} (safe to ignore)`);

	if (func.returnType.kind === FunctionReturnTypeKind.InlineTable) {
		for (const col of func.returnType.columns) {
			if (typesToFilter.includes(col.type.canonical_name)) {
				warn(col.type.canonical_name);
				return false;
			}
		}
	} else if (func.returnType.kind === FunctionReturnTypeKind.ExistingTable) {
		if (typesToFilter.includes(func.returnType.schema + "." + func.returnType.name)) {
			warn(func.returnType.schema + "." + func.returnType.name);
			return false;
		}
	} else {
		if (typesToFilter.includes(func.returnType.type.canonical_name)) {
			warn(func.returnType.type.canonical_name);
			return false;
		}
	}

	for (const param of func.parameters) {
		if (typesToFilter.includes(param.type.canonical_name)) {
			warn(param.type.canonical_name);
			return false;
		}
	}

	return func;
};

const write = (filename: string, file: string) => writeFile(filename, file + "\n");

const multifile = async (generators: createGenerator[], schemas: Record<string, Schema>, opts: TruePGConfig) => {
	const { out } = opts;

	const warnings: string[] = [];
	const gens = generators.map(g => g({ ...opts, warnings }));
	const def_gen = gens[0]!;

	const files: FolderStructure = {
		name: out,
		type: "root",
		children: Object.fromEntries(
			Object.values(schemas).map(schema => [
				schema.name,
				{
					name: schema.name,
					type: "schema",
					children: Object.fromEntries(
						allowed_kind_names.map(kind => [
							kind,
							{
								kind: kind,
								type: "kind",
								children: Object.fromEntries(
									schema[kind].map(item => [
										item.name,
										{
											name: def_gen.formatSchemaType(item),
											type: "type",
										},
									]),
								),
							},
						]),
					),
				},
			]),
		),
	};

	for (const schema of Object.values(schemas)) {
		console.log("Selected schema '%s':\n", schema.name);

		const schemaDir = `${out}/${schema.name}`;

		// skip functions that cannot be represented in JavaScript
		schema.functions = schema.functions.filter(f => filter_function(f, warnings));

		let createIndex = false;

		for (const kind of allowed_kind_names) {
			if (schema[kind].length < 1) continue;
			createIndex = true;

			await mkdir(`${schemaDir}/${kind}`, { recursive: true });
			console.log(" Creating %s:\n", kind);

			for (const [i, item] of schema[kind].entries()) {
				const index = "[" + (i + 1 + "]").padEnd(3, " ");
				const filename = `${schemaDir}/${kind}/${def_gen.formatSchemaType(item)}.ts`;

				const exists = await existsSync(filename);

				if (exists) {
					warnings.push(
						`Skipping ${item.kind} "${item.name}": formatted name clashes. Wanted to create ${filename}`,
					);
					continue;
				}

				const start = performance.now();

				let file = "";

				const imports = new Nodes.ImportList([]);

				if (item.kind === "table") file += join(gens.map(gen => gen.table(imports, item)));
				if (item.kind === "view") file += join(gens.map(gen => gen.view(imports, item)));
				// prettier-ignore
				if (item.kind === "materializedView") file += join(gens.map(gen => gen.materializedView(imports, item)));
				if (item.kind === "enum") file += join(gens.map(gen => gen.enum(imports, item)));
				if (item.kind === "composite") file += join(gens.map(gen => gen.composite(imports, item)));
				if (item.kind === "domain") file += join(gens.map(gen => gen.domain(imports, item)));
				if (item.kind === "range") file += join(gens.map(gen => gen.range(imports, item)));
				if (item.kind === "function") file += join(gens.map(gen => gen.function(imports, item)));

				const parts: string[] = [];
				parts.push(imports.stringify(filename, files));
				parts.push(file);
				file = join(parts);

				await write(filename, file);

				const end = performance.now();
				console.log("  %s %s \x1b[32m(%sms)\x1B[0m", index, filename, (end - start).toFixed(2));
			}

			const kindIndex = join(gens.map(gen => gen.schemaKindIndex(schema, kind, def_gen)));
			const kindIndexFilename = `${schemaDir}/${kind}/index.ts`;
			await write(kindIndexFilename, kindIndex);
			console.log('  ✅   Created "%s" %s index: %s\n', schema.name, kind, kindIndexFilename);
		}

		if (!createIndex) continue;

		const index = join(gens.map(gen => gen.schemaIndex(schema, def_gen)));
		const indexFilename = `${out}/${schema.name}/index.ts`;
		await write(indexFilename, index);
		console.log(" Created schema index: %s\n", indexFilename);
	}

	const fullIndex = join(gens.map(gen => gen.fullIndex(Object.values(schemas))));
	const fullIndexFilename = `${out}/index.ts`;
	await write(fullIndexFilename, fullIndex);
	console.log("Created full index: %s", fullIndexFilename);

	if (warnings.length > 0) {
		console.log("\nWarnings generated:");
		console.log(warnings.map(warning => "* " + warning).join("\n"));
	}
};

export async function generate(opts: TruePGConfig, generators?: createGenerator[]) {
	const out = opts.out || "./models";

	if (!("uri" in opts) && !("config" in opts) && !("pg" in opts)) {
		console.error(
			"One of these options are required in your config file: uri, config, pg. See documentation for more information.",
		);
		process.exit(1);
	}

	const extractor = new Extractor(opts);

	const start = performance.now();
	const schemas = await extractor.extractSchemas();
	const end = performance.now();
	console.log("Extracted schemas in \x1b[32m%sms\x1b[0m", (end - start).toFixed(2));

	console.info("Adapters enabled: %s\n", opts.adapters.join(", "));

	generators ??= opts.adapters.map(adapter => {
		const selected = adapters[adapter];
		if (!selected) throw new Error(`Requested adapter ${adapter} not found`);
		return selected;
	});
	console.log("Clearing directory and generating schemas at '%s'", out);
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await multifile(generators, schemas, { ...opts, out });

	{
		const end = performance.now();
		console.log("Completed in \x1b[32m%sms\x1b[0m", (end - start).toFixed(2));
	}
}
