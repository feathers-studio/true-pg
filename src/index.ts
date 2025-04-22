import { Extractor, FunctionReturnTypeKind } from "./extractor/index.ts";
import type { FunctionDetails, Schema } from "./extractor/index.ts";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { Nodes, allowed_kind_names, type FolderStructure, type createGenerator } from "./types.ts";
import { existsSync } from "node:fs";
import { join } from "./util.ts";

import { join as joinpath } from "node:path";
import { type TruePGConfig, type ValidatedConfig, config, adapters } from "./config.ts";
export { type TruePGConfig, type ValidatedConfig, config };

const time = (start: number) => {
	const end = performance.now();
	return (end - start).toFixed(2);
};

const filter_function = (func: FunctionDetails) => {
	const typesToFilter = [
		"pg_catalog.trigger",
		"pg_catalog.event_trigger",
		"pg_catalog.internal",
		"pg_catalog.language_handler",
		"pg_catalog.fdw_handler",
		"pg_catalog.index_am_handler",
		"pg_catalog.tsm_handler",
	];

	if (func.returnType.kind === FunctionReturnTypeKind.InlineTable) {
		for (const col of func.returnType.columns) {
			if (typesToFilter.includes(col.type.canonical_name)) {
				return false;
			}
		}
	} else if (func.returnType.kind === FunctionReturnTypeKind.ExistingTable) {
		if (typesToFilter.includes(func.returnType.schema + "." + func.returnType.name)) {
			return false;
		}
	} else {
		if (typesToFilter.includes(func.returnType.type.canonical_name)) {
			return false;
		}
	}

	for (const param of func.parameters) {
		if (typesToFilter.includes(param.type.canonical_name)) {
			return false;
		}
	}

	return func;
};

const write = (filename: string, file: string) => writeFile(filename, file + "\n");

const multifile = async (generators: createGenerator[], schemas: Record<string, Schema>, opts: ValidatedConfig) => {
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

		const schemaDir = joinpath(out, schema.name);

		// skip functions that cannot be represented in JavaScript
		schema.functions = schema.functions.filter(filter_function);

		{
			const skipped = schema.functions.filter(f => !filter_function(f));
			const skipped_functions = skipped.map(f => `  - ${f.name}`).join("\n");

			if (skipped.length) {
				warnings.push(
					`Skipping ${skipped.length} functions because they cannot be represented in JavaScript (safe to ignore):\n${skipped_functions}`,
				);
			}
		}

		let createIndex = false;

		for (const kind of allowed_kind_names) {
			if (schema[kind].length < 1) continue;
			createIndex = true;

			await mkdir(joinpath(schemaDir, kind), { recursive: true });
			console.log(" Creating %s:\n", kind);

			for (const [i, item] of schema[kind].entries()) {
				const index = "[" + (i + 1 + "]").padEnd(3, " ");
				const filename = joinpath(schemaDir, kind, def_gen.formatSchemaType(item) + ".ts");

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

				console.log("  %s %s \x1b[32m(%sms)\x1B[0m", index, filename, time(start));
			}

			{
				const start = performance.now();
				const kindIndex = join(gens.map(gen => gen.schemaKindIndex(schema, kind, def_gen)));
				const kindIndexFilename = joinpath(schemaDir, kind, "index.ts");
				await write(kindIndexFilename, kindIndex);
				const end = performance.now();
				console.log(
					"  ✅   Created %s index: %s \x1b[32m(%sms)\x1B[0m\n",
					kind,
					kindIndexFilename,
					(end - start).toFixed(2),
				);
			}
		}

		if (!createIndex) continue;

		{
			const start = performance.now();
			const index = join(gens.map(gen => gen.schemaIndex(schema, def_gen)));
			const indexFilename = joinpath(schemaDir, "index.ts");
			await write(indexFilename, index);
			console.log(" Created schema index: %s \x1b[32m(%sms)\x1B[0m\n", indexFilename, time(start));
		}
	}

	{
		const start = performance.now();
		const fullIndex = join(gens.map(gen => gen.fullIndex(Object.values(schemas))));
		const fullIndexFilename = joinpath(out, "index.ts");
		await write(fullIndexFilename, fullIndex);
		console.log("Created full index: %s \x1b[32m(%sms)\x1B[0m", fullIndexFilename, time(start));
	}

	if (warnings.length > 0) {
		console.log("\nWarnings generated:");
		console.log(warnings.map(warning => "* " + warning).join("\n"));
	}
};

export async function generate(opts: TruePGConfig, generators?: createGenerator[]) {
	const validated = config(opts);
	const out = validated.out;

	const extractor = new Extractor(opts);

	const start = performance.now();
	const schemas = await extractor.extractSchemas();
	const end = performance.now();
	console.log("Extracted schemas \x1b[32m(%sms)\x1b[0m\n", (end - start).toFixed(2));

	console.info("Adapters enabled: %s\n", validated.adapters.join(", "));

	generators = validated.adapters.map(adapter => adapters[adapter]).concat(generators ?? []);

	console.log("Clearing directory and generating schemas at '%s'\n", out);
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await multifile(generators, schemas, validated);

	console.log("Completed in \x1b[32m%sms\x1b[0m", time(start));
}
