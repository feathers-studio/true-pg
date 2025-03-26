import { Extractor, type CanonicalType, type Schema } from "pg-extract";
import { rm, mkdir, writeFile } from "fs/promises";
import type { SchemaGenerator, TruePGOpts } from "./types.ts";
import { Kysely } from "./kysely.ts";
import { existsSync } from "fs";

export * from "./consumer.ts";

const multifile = async (generator: SchemaGenerator, schemas: Record<string, Schema>, opts: TruePGOpts) => {
	const { outDir } = opts;

	for (const schema of Object.values(schemas)) {
		console.log("Selected schema '%s':", schema.name);

		const schemaDir = `${outDir}/${schema.name}`;

		const supported = ["tables", "enums", "composites", "functions"] as const;

		for (const type of supported) {
			if (schema[type].length < 1) continue;

			await mkdir(`${schemaDir}/${type}`, { recursive: true });
			console.log(" Creating %s:", type);

			for (const [i, item] of schema[type].entries()) {
				const index = "[" + (i + 1 + "]").padEnd(3, " ");
				const filename = `${schemaDir}/${type}/${generator.formatSchemaType(item)}.ts`;

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

				await writeFile(filename, parts.join("\n\n"));
			}
		}

		const index = generator.schemaIndex(schema);
		const indexFilename = `${outDir}/${schema.name}/index.ts`;
		await writeFile(indexFilename, index);
		console.log(" Created schema index: %s", indexFilename);
	}

	const fullIndex = generator.fullIndex(Object.values(schemas));
	const fullIndexFilename = `${outDir}/index.ts`;
	await writeFile(fullIndexFilename, fullIndex);
	console.log("Created full index: %s", fullIndexFilename);
};

export async function generate(opts: TruePGOpts) {
	const extractor = new Extractor(opts.connectionString);

	const schemas = await extractor.extractSchemas();

	const generator = Kysely(opts);

	console.log("Clearing directory and generating schemas at '%s'", outDir);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	await multifile(generator, schemas, opts);
}

const connectionString = "postgres://mkrcal:mkrcal@localhost:5432/mkrcal";
const outDir = "./out";

generate({ connectionString, outDir });
