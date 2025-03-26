import { Extractor, type CanonicalType, type SchemaType } from "pg-extract";
import { rm, mkdir, writeFile } from "fs/promises";
import type { TruePGOpts } from "./types.ts";
import { TypeScript } from "./typescript.ts";

export * from "./consumer.ts";

export async function generate(opts: TruePGOpts) {
	const { connectionString, outDir } = opts;

	const extractor = new Extractor(connectionString);

	const schemas = await extractor.extractSchemas();

	console.log("Clearing directory and generating schemas at '%s'", outDir);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	const generator = TypeScript("absolute", opts);

	for (const schema of Object.values(schemas)) {
		console.log("Selected schema '%s':", schema.name);

		const schemaDir = `${outDir}/${schema.name}`;
		const schemaTypes: SchemaType[] = [];

		const supported = ["tables", "enums", "composites", "functions"] as const;

		for (const type of supported) {
			if (schema[type].length < 1) continue;

			await mkdir(`${schemaDir}/${type}`, { recursive: true });
			console.log("  Creating %s:", type);

			for (const [index, item] of schema[type].entries()) {
				schemaTypes.push(item);

				const filename = `${schemaDir}/${type}/${item.name}.ts`;
				console.log(`    ✅ [${(String(index + 1) + "]").padEnd(3, " ")} ${filename}`);

				const types: CanonicalType[] = [];

				let file = "";

				if (item.kind === "table") file += generator.table(types, item);
				if (item.kind === "composite") file += generator.composite(types, item);
				if (item.kind === "enum") file += generator.enum(types, item);
				if (item.kind === "function") file += generator.function(types, item);

				const imports = generator.imports(types, { schema: schema.name, kind: item.kind });
				await writeFile(filename, [imports, file].join("\n"));
			}
		}

		const index = generator.schemaIndex(schemaTypes);
		await writeFile(`${outDir}/${schema.name}/index.ts`, index);
	}

	const fullIndex = generator.fullIndex(Object.keys(schemas));
	await writeFile(`${outDir}/index.ts`, fullIndex);
}

const connectionString = "postgres://mkrcal:mkrcal@localhost:5432/mkrcal";
const outDir = "./out";

generate({ connectionString, outDir });
