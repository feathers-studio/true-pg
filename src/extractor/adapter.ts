import { Client as PgClient, Pool as PgPool } from "pg";
import { PGlite as Pglite } from "@electric-sql/pglite";

export class DbAdapter {
	constructor(private client: PgClient | PgPool | Pglite, private external?: boolean) {}

	async connect() {
		if (this.external) return;

		if (this.client instanceof PgPool) {
			// queries will automatically checkout a client and return it to the pool
		} else if (this.client instanceof PgClient) {
			return this.client.connect();
		} else if (this.client instanceof Pglite) {
			// Pglite doesn't have an explicit connect method
		}
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
	 * Close the connection if needed
	 */
	async close() {
		if (this.external) return;

		if (this.client instanceof PgPool) {
			this.client.end();
		} else if (this.client instanceof PgClient) {
			await this.client.end();
		} else if (this.client instanceof Pglite) {
			await this.client.close();
		}
	}
}
