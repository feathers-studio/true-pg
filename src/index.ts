import { Extractor, type FunctionDetails, type Schema } from "pg-extract";
import { rm, mkdir, writeFile } from "fs/promises";
import { Nodes, allowed_kind_names, type FolderStructure, type TruePGOpts, type createGenerator } from "./types.ts";
import { existsSync } from "fs";
import { join } from "./util.ts";

import { Kysely } from "./kysely/index.ts";
import { Zod } from "./zod/index.ts";

export const adapters: Record<string, createGenerator> = {
	kysely: Kysely,
	zod: Zod,
};

export * from "./consumer.ts";

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

	if (func.returnType.kind === "table") {
		for (const col of func.returnType.columns) {
			if (typesToFilter.includes(col.type.canonical_name)) {
				warn(col.type.canonical_name);
				return false;
			}
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

const multifile = async (generators: createGenerator[], schemas: Record<string, Schema>, opts: TruePGOpts) => {
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

	const start = performance.now();

	for (const schema of Object.values(schemas)) {
		console.log("Selected schema '%s':\n", schema.name);

		const schemaDir = `${out}/${schema.name}`;

		// skip functions that cannot be represented in JavaScript
		schema.functions = schema.functions.filter(f => filter_function(f, warnings));

		for (const kind of allowed_kind_names) {
			if (schema[kind].length < 1) continue;

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
				if (item.kind === "composite") file += join(gens.map(gen => gen.composite(imports, item)));
				if (item.kind === "enum") file += join(gens.map(gen => gen.enum(imports, item)));
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

		const index = join(gens.map(gen => gen.schemaIndex(schema, def_gen)));
		const indexFilename = `${out}/${schema.name}/index.ts`;
		await write(indexFilename, index);
		console.log(" Created schema index: %s\n", indexFilename);
	}

	const fullIndex = join(gens.map(gen => gen.fullIndex(Object.values(schemas))));
	const fullIndexFilename = `${out}/index.ts`;
	await write(fullIndexFilename, fullIndex);
	console.log("Created full index: %s", fullIndexFilename);
	const end = performance.now();
	console.log("Completed in \x1b[32m%sms\x1b[0m", (end - start).toFixed(2));

	if (warnings.length > 0) {
		console.log("\nWarnings generated:");
		console.log(warnings.map(warning => "* " + warning).join("\n"));
	}
};

export async function generate(opts: TruePGOpts, generators?: createGenerator[]) {
	const out = opts.out || "./models";
	const extractor = new Extractor(opts.uri);
	const schemas = await extractor.extractSchemas();
	generators ??= opts.adapters.map(adapter => {
		const selected = adapters[adapter];
		if (!selected) throw new Error(`Requested adapter ${adapter} not found`);
		return selected;
	});
	console.log("Clearing directory and generating schemas at '%s'", out);
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await multifile(generators, schemas, { ...opts, out });
}
