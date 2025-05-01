import type Pg from "pg";
import type { PGlite as Pglite } from "@electric-sql/pglite";

import { canonicaliseQueue } from "./canonicalise/index.ts";
import type { Canonical, QueueMember } from "./canonicalise/index.ts";
import type { MaybePromise } from "../util.ts";

const isPgPool = (client: Pg.Client | Pg.Pool | Pglite): client is Pg.Pool =>
	"totalCount" in client && typeof client.totalCount === "number";

const isPgClient = (client: Pg.Client | Pg.Pool | Pglite): client is Pg.Client =>
	"getTypeParser" in client && typeof client.getTypeParser === "function";

const isPglite = (client: Pg.Client | Pg.Pool | Pglite): client is Pglite =>
	"dumpDataDir" in client && typeof client.dumpDataDir === "function";

export class DbAdapter {
	queryCount = 0;
	#resolveQueue: QueueMember[] = [];

	constructor(private client: MaybePromise<Pg.Client | Pg.Pool | Pglite>, private external?: boolean) {}

	resetQueryCount() {
		this.queryCount = 0;
	}

	resetQueue() {
		this.#resolveQueue = [];
	}

	reset() {
		this.resetQueryCount();
		this.resetQueue();
	}

	/**
	 * Eagerly returns a placeholder for a type.
	 *
	 * After queueing all types, call {@link resolve} to resolve them.
	 * Calling {@link resolve} patches the results into their placeholders.
	 *
	 * Example:
	 *
	 * ```ts
	 * const db = new DbAdapter(client);
	 *
	 * // all placeholders are empty objects
	 * const placeholder1 = db.enqueue("my_type");
	 * const placeholder2 = db.enqueue("my_other_type");
	 * const placeholder3 = db.enqueue("my_third_type");
	 * console.log(placeholder1); // {}
	 * console.log(placeholder2); // {}
	 * console.log(placeholder3); // {}
	 *
	 * // all placeholders are now populated with the canonical type
	 * await db.resolve(); // this also clears the internal queue
	 * console.log(placeholder1); // { ... }
	 * console.log(placeholder2); // { ... }
	 * console.log(placeholder3); // { ... }
	 * ```
	 */
	enqueue(type: string) {
		const member: QueueMember = { type, out: {} as Canonical };
		this.#resolveQueue.push(member);
		return member.out;
	}

	/**
	 * Resolves all enqueued types.
	 *
	 * Call this method to resolve and patch all types enqueued using {@link enqueue}.
	 *
	 * @see {@link enqueue}
	 */
	async resolve() {
		const results = await canonicaliseQueue(this, this.#resolveQueue);
		for (let i = 0; i < this.#resolveQueue.length; i++) {
			this.#resolveQueue[i]!.out = results[i]!;
		}

		this.resetQueue();
		return results;
	}

	async connect() {
		this.reset();
		if (this.external) return;

		const client = await this.client;

		if (isPgPool(client)) {
			// queries will automatically checkout a client and return it to the pool
		} else if (isPgClient(client)) {
			return client.connect();
		} else if (isPglite(client)) {
			// Pglite doesn't have an explicit connect method
		}
	}

	/**
	 * Execute a read query and return just the rows
	 */
	async query<R, I extends any[] = []>(text: string, params?: I) {
		this.queryCount++;

		const client = await this.client;

		if (!process.env.DEBUG) {
			// @ts-expect-error The two clients can process our query types similarly
			const result = await client.query(text, params);
			return result.rows as R[];
		}

		let stack;
		try {
			stack = new Error().stack;
			stack = stack?.split("\n").slice(3).join("\n");
			// @ts-expect-error The two clients can process our query types similarly
			const result = await client.query(text, params);
			return result.rows as R[];
		} catch (error) {
			if (error instanceof Error) {
				console.error("Query Error ===");
				console.error("Query:", text);
				console.error("Parameters:", params);
				console.error("\nStack trace:");
				console.error(stack ?? error.stack);
				console.error("\nError details:", error.message);
				process.exit(1);
			} else throw error;
		}
	}

	/**
	 * Close the connection and clear the cache
	 */
	async close() {
		this.reset();
		if (this.external) return;

		const client = await this.client;

		if (isPgPool(client)) {
			await client.end();
		} else if (isPgClient(client)) {
			await client.end();
		} else if (isPglite(client)) {
			await client.close();
		}
	}
}
