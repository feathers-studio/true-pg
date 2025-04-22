#!/usr/bin/env node

import mri from "mri";
import { generate } from "./index.ts";
import { generators } from "./config.ts";

const args = process.argv.slice(2);
const opts = mri<{
	"help"?: boolean;
	"config"?: string;
	"uri"?: string;
	"out"?: string;
	"generator"?: string | string[];
	"all-generators"?: boolean;
}>(args, {
	boolean: ["help", "all-generators"],
	string: ["config", "uri", "out", "generator"],
	alias: {
		h: "help",
		c: "config",
		u: "uri",
		o: "out",
		a: "generator",
		A: "all-generators",
	},
});

import { cosmiconfig } from "cosmiconfig";

const explorer = cosmiconfig("truepg");
const result = opts.config ? await explorer.load(opts.config) : await explorer.search();

const config = result?.config ?? {};

const help = opts.help || (!config && !opts.uri);

if (help) {
	// if help is triggered unintentionally, it's a user error
	const type = opts.help ? "log" : "error";
	const log = console[type];

	log();
	log("Usage: true-pg [options]");
	log();
	log("Options:");
	log("  -h, --help                  Show help");
	log("  -u, --uri      [uri]        Database URI (Postgres only!)");
	log("  -o, --out      [path]       Path to output directory");
	log("  -g, --generator  [generator]    Output generator to use (default: 'kysely')");
	log("  -A, --all-generators          Output all generators");
	log("  -c, --config   [path]       Path to config file");
	log("                              Defaults to '.truepgrc.json' or '.config/.truepgrc.json'");
	log("Example:");
	log("  true-pg -u postgres://user:pass@localhost:5432/my-database -o models -g kysely -g zod");
	log();
	if (opts.help) process.exit(0);
	else process.exit(1);
}

if (opts["all-generators"]) opts.generator = Object.keys(generators);

if (!(opts.generator || config.generators)) console.warn('No generators specified, using default: ["kysely"]');

// allow single generator or comma-separated list of generators
if (typeof opts.generator === "string") opts.generator = opts.generator.split(",");

// CLI args take precedence over config file
config.uri = opts.uri ?? config.uri;
config.out = opts.out ?? config.out;
config.generators = opts.generator ?? config.generators ?? ["kysely"];

await generate(config);
