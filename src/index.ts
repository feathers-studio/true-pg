import { Extractor, type CanonicalType, type FunctionDetails, type Schema } from "pg-extract";
import { rm, mkdir, writeFile } from "fs/promises";
import { type TruePGOpts, type createGenerator } from "./types.ts";
import { Kysely } from "./kysely/index.ts";
import { Zod } from "./zod/index.ts";
import { existsSync } from "fs";

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

const join = (parts: Iterable<string>, joiner = "\n\n") => Array.from(parts).filter(Boolean).join(joiner);

const write = (filename: string, file: string) => writeFile(filename, file + "\n");

const multifile = async (generators: createGenerator[], schemas: Record<string, Schema>, opts: TruePGOpts) => {
	const { out } = opts;

	const warnings: string[] = [];
	const gens = generators.map(g => g({ ...opts, warnings }));
	const def_gen = gens[0]!;

	const start = performance.now();

	for (const schema of Object.values(schemas)) {
		console.log("Selected schema '%s':\n", schema.name);

		const schemaDir = `${out}/${schema.name}`;

		const supported = ["tables", "enums", "composites", "functions"] as const;

		// skip functions that cannot be represented in JavaScript
		schema.functions = schema.functions.filter(f => filter_function(f, warnings));

		for (const kind of supported) {
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
				const types: CanonicalType[] = [];

				let file = "";

				if (item.kind === "table") file += join(gens.map(gen => gen.table(types, item)));
				if (item.kind === "composite") file += join(gens.map(gen => gen.composite(types, item)));
				if (item.kind === "enum") file += join(gens.map(gen => gen.enum(types, item)));
				if (item.kind === "function") file += join(gens.map(gen => gen.function(types, item)));

				const imports = join(
					// only include unique imports
					new Set(gens.flatMap(gen => gen.imports(types, { schema: schema.name, kind: item.kind }))),
					"\n",
				);

				const parts: string[] = [];
				if (item.kind === "table") parts.push(`import * as K from "kysely";`);
				parts.push(imports);
				parts.push(file);
				file = join(parts);

				await write(filename, file);

				const end = performance.now();
				console.log("  %s %s \x1b[32m(%sms)\x1B[0m", index, filename, (end - start).toFixed(2));
			}

			const kindIndex = join(gens.map(gen => gen.schemaKindIndex(schema, kind)));
			const kindIndexFilename = `${schemaDir}/${kind}/index.ts`;
			await write(kindIndexFilename, kindIndex);
			console.log('  ✅   Created "%s" %s index: %s\n', schema.name, kind, kindIndexFilename);
		}

		const index = join(gens.map(gen => gen.schemaIndex(schema)));
		const indexFilename = `${out}/${schema.name}/index.ts`;
		await write(indexFilename, index);
		console.log(" Created schema index: %s\n", indexFilename);
	}

	const fullIndex = def_gen.fullIndex(Object.values(schemas));
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
