import Pg from "pg";
import { PGlite as Pglite } from "@electric-sql/pglite";
import { canonicalise, type Canonical } from "./canonicalise.ts";

export class DbAdapter {
	rawTypeCache: Map<string, Promise<Canonical>>;
	canonicalCache: Map<string, Promise<Canonical>>;

	constructor(private client: Pg.Client | Pg.Pool | Pglite, private external?: boolean) {
		this.canonicalCache = new Map();
		this.rawTypeCache = new Map();
	}

	clearCache() {
		this.canonicalCache.clear();
		this.rawTypeCache.clear();
	}

	async canonicalise(types: string[]) {
		return await canonicalise(this, types, this.rawTypeCache, this.canonicalCache);
	}

	async connect() {
		if (this.external) return;

		if (this.client instanceof Pg.Pool) {
			// queries will automatically checkout a client and return it to the pool
		} else if (this.client instanceof Pg.Client) {
			return this.client.connect();
		} else if (this.client instanceof Pglite) {
			// Pglite doesn't have an explicit connect method
		}

		this.clearCache();
	}

	/**
	 * Execute a read query and return just the rows
	 */
	async query<R, I extends any[] = []>(text: string, params?: I) {
		let stack;
		try {
			stack = new Error().stack;
			stack = stack?.split("\n").slice(3).join("\n");
			// @ts-expect-error The two clients can process our query types similarly
			const result = await this.client.query(text, params);
			return result.rows as R[];
		} catch (error) {
			if (error instanceof Error) {
				console.error("Query Error ===");
				console.error("Query:", text);
				console.error("Parameters:", params);
				console.error("\nStack trace:");
				console.error(stack);
				console.error("\nError details:", error.message);
				process.exit(1);
			} else throw error;
		}
	}

	/**
	 * Close the connection and clear the cache
	 */
	async close() {
		if (this.external) return;

		this.clearCache();

		if (this.client instanceof Pg.Pool) {
			this.client.end();
		} else if (this.client instanceof Pg.Client) {
			await this.client.end();
		} else if (this.client instanceof Pglite) {
			await this.client.close();
		}
	}
}
