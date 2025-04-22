import { normalize as normalise } from "node:path";
import type { Extractor } from "./extractor/index.ts";
import { type Deunionise } from "./util.ts";
import { Kysely } from "./kysely/index.ts";
import { Zod } from "./zod/index.ts";

export type ExtractorConfig = Exclude<ConstructorParameters<typeof Extractor>[0], string | undefined>;

export interface BaseConfig {
	/** The output directory for the generated models. Default: "models" */
	out?: string;
	/** Adapters to enable. Currently supported adapters are "kysely" and "zod". Default: ["kysely"] */
	adapters?: ("kysely" | "zod")[];
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

export const adapters = {
	kysely: Kysely,
	zod: Zod,
};

const availableAdapters = Object.keys(adapters) as (keyof typeof adapters)[];

export function config(opts: TruePGConfig) {
	const out = normalise(opts.out || "./models");
	const adapters = opts.adapters || ["kysely"];
	const defaultSchema = opts.defaultSchema || "public";

	for (const adapter of opts.adapters ?? []) {
		if (!availableAdapters.includes(adapter)) {
			console.error('Requested adapter "%s" not found.', adapter);
			console.error("Available adapters: %s", availableAdapters.join(", "));
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
		adapters,
		defaultSchema,
	};
}

export type ValidatedConfig = ReturnType<typeof config>;
