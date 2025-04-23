// @ts-check

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { config } from "../src/index.ts";

const pg = new PGlite("memory://");

const read = async path => readFile(await import.meta.resolve(path).slice("file://".length), "utf-8");

// since this is in-memory, we need to load the schema and seed
await pg.exec(await read("./database.sql"));
await pg.exec(await read("./seed.sql"));

export default config({
	pg,
	generators: ["kysely", "zod"],
	out: "models/",
});
