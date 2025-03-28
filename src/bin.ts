import mri from "mri";
import { existsSync } from "fs";
import { generate, adapters } from "./index.ts";

const args = process.argv.slice(2);
const opts = mri<{
	"help"?: boolean;
	"config"?: string;
	"uri"?: string;
	"out"?: string;
	"adapters"?: string | string[];
	"all-adapters"?: boolean;
}>(args, {
	boolean: ["help", "all-adapters"],
	string: ["config", "uri", "out", "adapters"],
	alias: {
		h: "help",
		c: "config",
		u: "uri",
		o: "out",
		a: "adapters",
		A: "all-adapters",
	},
});

const help = opts.help || (!opts.config && !opts.uri);

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
	log("  -a, --adapters [adapters]   Output adapters to use (default: 'kysely')");
	log("  -A, --all-adapters          Output all adapters");
	log("  -c, --config   [path]       Path to config file (JSON)");
	log("                              Defaults to '.truepgrc.json' or '.config/.truepgrc.json'");
	log("Example:");
	log("  true-pg -u postgres://user:pass@localhost:5432/my-database -o models -a kysely -a zod");
	log();
	if (opts.help) process.exit(0);
	else process.exit(1);
}

let configfile = opts.config;
if (!configfile) {
	const candidates = [".truepgrc.json", ".config/.truepgrc.json"];
	for (const candidate of candidates) {
		if (await existsSync(candidate)) {
			configfile = candidate;
			break;
		}
	}
}

const config = configfile ? await Bun.file(configfile).json() : {};

if (opts["all-adapters"]) {
	opts.adapters = Object.keys(adapters);
	console.log("Enabling all built-in adapters:", opts.adapters);
}

if (!(opts.adapters || config.adapters)) console.warn('No adapters specified, using default: ["kysely"]');

opts.out ??= "models";
// allow single adapter or comma-separated list of adapters
if (typeof opts.adapters === "string") opts.adapters = opts.adapters.split(",");
opts.adapters ??= ["kysely"];

// CLI args take precedence over config file
config.uri = opts.uri ?? config.uri;
config.out = opts.out ?? config.out;
config.adapters = opts.adapters ?? config.adapters;

await generate(config);
