import mri from "mri";
import { existsSync } from "fs";

const args = process.argv.slice(2);
const opts = mri<{
	help?: boolean;
	config?: string;
	uri?: string;
	out?: string;
}>(args, {
	boolean: ["help"],
	string: ["config", "uri", "out"],
	alias: {
		h: "help",
		c: "config",
		u: "uri",
		o: "out",
	},
});

const help = opts.help || (!opts.config && !opts.uri);

if (help) {
	// if help is triggered unintentionally, it's a user error
	const type = opts.help ? "log" : "error";

	console[type]("Usage: true-pg [options]");
	console[type]("Options:");
	console[type]("  -h, --help             Show help");
	console[type]("  -c, --config  [path]   Path to config file (JSON)");
	console[type]("  -u, --uri     [uri ]   Database URI (Postgres only!)");
	console[type]("  -o, --out     [path]   Path to output directory");

	if (opts.help) process.exit(0);
	else process.exit(1);
}

const out = opts.out || "models";

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
// CLI args take precedence over config file
if (opts.uri) config.uri = opts.uri;
if (opts.out) config.out = opts.out;

import { generate } from "./index.ts";
await generate(config);
