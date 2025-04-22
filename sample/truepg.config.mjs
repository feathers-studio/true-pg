// @ts-check

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { config } from "../src/index.ts";

const pg = new PGlite("memory://");

const schema_defs = readFileSync("database.sql", "utf-8");
const seed = readFileSync("seed.sql", "utf-8");

await pg.exec(schema_defs);
await pg.exec(seed);

export default config({
	pg,
	adapters: ["kysely", "zod"],
	out: "models/",
});
