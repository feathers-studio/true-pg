import { Kysely } from "kysely";
import { KyselyPGlite } from "kysely-pglite";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "./models/index.ts";

/*
	Note!
	We're using PGlite to showcase how to use the `Database` type,
	but you could just as well use Kysely's builtin PostgresDialect
	to connect to a local/remote PostgresSQL database ✨
*/

const pg = new PGlite();
const { dialect } = new KyselyPGlite(pg);

const read = async (path: string) => readFile(await import.meta.resolve(path).slice("file://".length), "utf-8");

// since this is in-memory, we need to load the schema and seed
await pg.exec(await read("./database.sql"));
await pg.exec(await read("./seed.sql"));

const db = new Kysely<Database>({ dialect });

/**
 * Typed as we'd expect:
 * @type {{
 *   user_id: number;
 *   username: string;
 *   email: string;
 *   role: UserRole;
 *   shipping_address: Address | null;
 *   unknown_column: unknown;
 *   created_at: Date | null;
 * } | undefined}
 */
const results = await db.selectFrom("users").selectAll().executeTakeFirst();

console.log(results);
