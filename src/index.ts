import { Extractor, type CanonicalType, type FunctionDetails, type Schema } from "pg-extract";
import { rm, mkdir, writeFile } from "fs/promises";
import type { SchemaGenerator, TruePGOpts } from "./types.ts";
import { Kysely } from "./kysely/index.ts";
import { existsSync } from "fs";

export * from "./consumer.ts";

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

	if (func.returnType.kind === "table") {
		for (const col of func.returnType.columns) {
			if (typesToFilter.includes(col.type.canonical_name)) {
				console.warn("Skipping function %s: %s", func.name, col.type.canonical_name);
				return null;
			}
		}
	} else {
		if (typesToFilter.includes(func.returnType.type.canonical_name)) {
			console.warn("Skipping function %s: %s", func.name, func.returnType.type.canonical_name);
			return null;
		}
	}

	for (const param of func.parameters) {
		if (typesToFilter.includes(param.type.canonical_name)) {
			console.warn("Skipping function %s: %s", func.name, param.type.canonical_name);
			return null;
		}
	}

	return func;
};

const multifile = async (generator: SchemaGenerator, schemas: Record<string, Schema>, opts: TruePGOpts) => {
	const { out } = opts;

	for (const schema of Object.values(schemas)) {
		console.log("Selected schema '%s':", schema.name);

		const schemaDir = `${out}/${schema.name}`;

		const supported = ["tables", "enums", "composites", "functions"] as const;

		schema.functions = schema.functions.map(filter_function).filter(x => x !== null);

		for (const kind of supported) {
			if (schema[kind].length < 1) continue;

			await mkdir(`${schemaDir}/${kind}`, { recursive: true });
			console.log(" Creating %s:", kind);

			for (const [i, item] of schema[kind].entries()) {
				const index = "[" + (i + 1 + "]").padEnd(3, " ");
				const filename = `${schemaDir}/${kind}/${generator.formatSchemaType(item)}.ts`;

				const exists = await existsSync(filename);

				if (exists) {
					console.warn('  %s ⚠️ Skipping %s "%s":', index, item.kind, item.name);
					console.warn("     formatted name clashes. Wanted to create %s", filename);
					continue;
				}

				console.log("  %s %s", index, filename);

				const types: CanonicalType[] = [];

				let file = "";

				if (item.kind === "table") file += generator.table(types, item);
				if (item.kind === "composite") file += generator.composite(types, item);
				if (item.kind === "enum") file += generator.enum(types, item);
				if (item.kind === "function") file += generator.function(types, item);

				const imports = generator.imports(types, { schema: schema.name, kind: item.kind });

				const parts: string[] = [];
				if (item.kind === "table") parts.push(`import * as K from "kysely";`);
				parts.push(imports);
				parts.push(file);

				await writeFile(filename, parts.filter(Boolean).join("\n\n"));
			}

			const kindIndex = generator.schemaKindIndex(schema, kind);
			const kindIndexFilename = `${schemaDir}/${kind}/index.ts`;
			await writeFile(kindIndexFilename, kindIndex);
			console.log(" Created kind index: %s", kindIndexFilename);
		}

		const index = generator.schemaIndex(schema);
		const indexFilename = `${out}/${schema.name}/index.ts`;
		await writeFile(indexFilename, index);
		console.log(" Created schema index: %s", indexFilename);
	}

	const fullIndex = generator.fullIndex(Object.values(schemas));
	const fullIndexFilename = `${out}/index.ts`;
	await writeFile(fullIndexFilename, fullIndex);
	console.log("Created full index: %s", fullIndexFilename);
};

export async function generate(opts: TruePGOpts) {
	const out = opts.out || "./models";
	const extractor = new Extractor(opts.uri);
	const schemas = await extractor.extractSchemas();
	const generator = Kysely(opts);
	console.log("Clearing directory and generating schemas at '%s'", out);
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await multifile(generator, schemas, { ...opts, out });
}
