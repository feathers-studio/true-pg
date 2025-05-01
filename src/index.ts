import { Extractor, FunctionReturnTypeKind } from "./extractor/index.ts";
import type { FunctionDetails, Schema } from "./extractor/index.ts";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { allowed_kind_names, type FolderStructure, type createGenerator } from "./types.ts";
import { ImportList } from "./imports.ts";
import { existsSync } from "node:fs";
import { join, parens } from "./util.ts";

import { join as joinpath } from "node:path";
import { type TruePGConfig, type ValidatedConfig, config, generators as builtin_generators } from "./config.ts";
export { type TruePGConfig, type ValidatedConfig, config };

const NO_COLOR = Boolean(process.env.NO_COLOR || process.env.CI);
const red = (str: string | number) => (NO_COLOR ? str : `\x1b[31m${str}\x1b[0m`);
const green = (str: string | number) => (NO_COLOR ? str : `\x1b[32m${str}\x1b[0m`);
const yellow = (str: string | number) => (NO_COLOR ? str : `\x1b[33m${str}\x1b[0m`);
const blue = (str: string | number) => (NO_COLOR ? str : `\x1b[34m${str}\x1b[0m`);
const bold = (str: string | number) => (NO_COLOR ? str : `\x1b[1m${str}\x1b[0m`);
const underline = (str: string | number) => (NO_COLOR ? str : `\x1b[4m${str}\x1b[0m`);

const formatTime = (time: number): string => {
	const mins = Math.floor(time / 60000);
	const secs = Math.floor((time % 60000) / 1000);
	const ms = Math.floor(time % 1000);
	const us = Math.floor((time * 1000) % 1000)
		.toString()
		.padStart(3, "0");

	const parts = [];
	if (mins) parts.push(mins + "m");
	if (secs) parts.push(secs + "s");
	if (!mins) parts.push(ms + (!secs && us ? "." + us : "") + "ms");

	return parts.join("");
};

const THRESHOLD1 = 800;
const THRESHOLD2 = 1500;

const time = (start: number, addParens = true) => {
	const diff = performance.now() - start;
	const diffstr = formatTime(diff);
	const str = addParens ? parens(diffstr) : diffstr;

	if (diff < THRESHOLD1) return green(str);
	if (diff < THRESHOLD2) return yellow(str);
	return red(str);
};

const filter_overloaded_functions = (functions: FunctionDetails[]) => {
	const counts = functions.reduce((acc, func) => {
		acc[func.name] = (acc[func.name] ?? 0) + 1;
		return acc;
	}, {} as Record<string, number>);

	return [
		functions.filter(func => counts[func.name] === 1),
		Object.entries(counts)
			.filter(([_, count]) => count > 1)
			.map(([name]) => name),
	] as const;
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

const filter_unsupported_functions = (functions: FunctionDetails[]) => {
	const filtered = functions.filter(filter_function);
	const unsupported = filtered.filter(func => !filtered.includes(func));
	return [filtered, unsupported] as const;
};

const multifile = async (generators: createGenerator[], schemas: Record<string, Schema>, opts: ValidatedConfig) => {
	const { out, defaultSchema } = opts;

	let count = 0;
	const write = async (filename: string, file: string) => {
		await writeFile(filename, file + "\n");
		count++;
	};

	const warnings: Set<string> = new Set();
	const gens = generators.map(g => g({ defaultSchema, warnings }));
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
											name: def_gen.formatSchemaMemberName(item),
											type: "type",
										},
									]),
								),
							},
						]),
					) as FolderStructure["children"][string]["children"],
				},
			]),
		),
	};

	for (const schema of Object.values(schemas)) {
		console.log("Selected schema '%s':\n", schema.name);

		const schemaDir = joinpath(out, schema.name);

		const [unique_functions, overloaded_functions] = filter_overloaded_functions(schema.function);
		const [supported_functions, unsupported_functions] = filter_unsupported_functions(unique_functions);
		schema.function = supported_functions;

		{
			const skipped = unsupported_functions.map(f => `  - ${f.name}`);

			if (skipped.length) {
				warnings.add(
					`Skipping ${skipped.length} functions not representable in JavaScript (safe to ignore):\n` +
						skipped.join("\n"),
				);
			}
		}

		{
			const skipped = overloaded_functions.map(f => `  - ${f}`);

			if (skipped.length) {
				warnings.add(`Skipping ${skipped.length} overloaded functions (not supported):\n` + skipped.join("\n"));
			}
		}

		let createIndex = false;

		for (const kind of allowed_kind_names) {
			if (schema[kind].length < 1) continue;
			createIndex = true;

			const kindDir = joinpath(schemaDir, kind + "s");

			await mkdir(kindDir, { recursive: true });
			console.log(" Creating %s:\n", kind + "s");

			for (const [i, item] of schema[kind].entries()) {
				const index = "[" + (i + 1 + "]").padEnd(3, " ");
				const filename = joinpath(kindDir, def_gen.formatSchemaMemberName(item) + ".ts");

				const exists = await existsSync(filename);

				if (exists) {
					warnings.add(`Skipping ${item.kind} "${item.name}": formatted name clashes. Wanted to create ${filename}`);
					continue;
				}

				const start = performance.now();

				let file = "";

				const imports = new ImportList();

				file += join(
					gens.map(gen =>
						gen[item.kind](
							{ source: filename, imports },
							// @ts-expect-error TypeScript cannot fathom the fact that item is related to item.kind
							item,
						),
					),
				);

				file = join([imports.stringify(files), file]);

				await write(filename, file);

				console.log("  %s %s %s", index, filename, time(start));
			}

			{
				const start = performance.now();
				const imports = new ImportList();
				const fileName = joinpath(kindDir, "index.ts");
				const kindIndex = join(
					gens.map(gen => gen.schemaKindIndex({ source: fileName, imports }, schema, kind, def_gen)),
				);
				const file = join([imports.stringify(files), kindIndex]);
				await write(fileName, file);

				console.log("  ✅   Created %s index: %s %s\n", kind, fileName, time(start));
			}
		}

		if (!createIndex) continue;

		{
			const start = performance.now();
			const imports = new ImportList();
			const fileName = joinpath(schemaDir, "index.ts");
			const index = join(gens.map(gen => gen.schemaIndex({ source: fileName, imports }, schema, def_gen)));
			const file = join([imports.stringify(files), index]);
			await write(fileName, file);

			console.log(" Created schema index: %s %s\n", fileName, time(start));
		}
	}

	{
		const start = performance.now();
		const imports = new ImportList();
		const fileName = joinpath(out, "index.ts");
		const fullIndex = join(gens.map(gen => gen.fullIndex({ source: fileName, imports }, Object.values(schemas))));
		const file = join([imports.stringify(files), fullIndex]);
		await write(fileName, file);

		console.log("Created full index: %s %s", fileName, time(start));
	}

	if (warnings.size > 0) {
		console.log("\nWarnings generated:");
		for (const warning of warnings) {
			console.log("* " + warning);
		}
	}

	return count;
};

export async function generate(opts: TruePGConfig, generators?: createGenerator[]) {
	const validated = config(opts);
	const out = validated.out;

	const extractor = new Extractor(opts);

	const start = performance.now();
	const { schemas, queryCount } = await extractor.extractSchemas();
	console.log("Extracted schemas %s (made %s queries)\n", time(start), queryCount);

	console.info("Generators enabled: %s\n", validated.generators.join(", "));

	generators = validated.generators.map(generator => builtin_generators[generator]).concat(generators ?? []);

	console.log("Clearing directory and generating schemas at '%s'\n", out);
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	const count = await multifile(generators, schemas, validated);

	console.log("Completed in %s, %s generated.", time(start, false), bold(underline(blue(count + " files"))));
	console.log();
}
