import { normalize as normalise } from "node:path";
import type { Extractor } from "./extractor/index.ts";
import { type Deunionise } from "./util.ts";
import { Kysely } from "./kysely/index.ts";
import { Zod } from "./zod/index.ts";

export type ExtractorConfig = Exclude<ConstructorParameters<typeof Extractor>[0], string | undefined>;

export interface BaseConfig {
	/** The output directory for the generated models. Default: "models" */
	out?: string;
	/** Generators to enable. Currently supported generators are "kysely" and "zod". Default: ["kysely"] */
	generators?: ("kysely" | "zod")[];
	/** The default schema to use for the generated models. These will be unprefixed in the final `Database` interface. Default: "public" */
	defaultSchema?: string;
}

export interface PgConfig extends BaseConfig {
	/** An instance of node-postgres Client or Pool, or an instance of Pglite. */
	pg: ExtractorConfig["pg"];
}

export interface UriConfig extends BaseConfig {
	/** A connection string for node-postgres Pool. */
	uri: ExtractorConfig["uri"];
}

export interface ConfigConfig extends BaseConfig {
	/** A configuration object for node-postgres Pool. */
	config: ExtractorConfig["config"];
}

export type TruePGConfig = Deunionise<PgConfig | UriConfig | ConfigConfig>;

export const generators = {
	kysely: Kysely,
	zod: Zod,
};

const availableGenerators = Object.keys(generators) as (keyof typeof generators)[];

export function config(opts: TruePGConfig) {
	const out = normalise(opts.out || "./models");
	const generators = opts.generators || ["kysely"];
	const defaultSchema = opts.defaultSchema || "public";

	for (const generator of opts.generators ?? []) {
		if (!availableGenerators.includes(generator)) {
			console.error('Requested generator "%s" not found.', generator);
			console.error("Available generators: %s", availableGenerators.join(", "));
			console.error("See documentation for more information.");
			process.exit(1);
		}
	}

	if (!("uri" in opts) && !("config" in opts) && !("pg" in opts)) {
		console.error(
			"One of these options are required in your config file: uri, config, pg. See documentation for more information.",
		);
		process.exit(1);
	}

	return {
		...opts,
		out,
		generators,
		defaultSchema,
	};
}

export type ValidatedConfig = ReturnType<typeof config>;
