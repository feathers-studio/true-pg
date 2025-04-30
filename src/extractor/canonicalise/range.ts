import type { DbAdapter } from "../adapter.ts";
import type { ExclusiveRange } from "./types.ts";
import { minifyQuery } from "../../util.ts";
import { Canonical } from "./types.ts";

const query = minifyQuery(`
	-- Fetch the formatted name for each input OID, ordered by sequence
	SELECT
		u.seq,
		format('%I.%I', n.nspname, t.typname) AS name
	FROM unnest($1::oid[]) WITH ORDINALITY AS u(oid, seq)
	JOIN pg_type t ON t.oid = u.oid
	JOIN pg_namespace n ON t.typnamespace = n.oid
	ORDER BY u.seq;
`);

type QueryResult = { name: string | null };
type QueryParams = [number[]];

export type { ExclusiveRange };

/**
 * Fetches the canonical name of the subtype for given range OIDs, ordered by sequence.
 */
export async function getRangeDetails(
	db: DbAdapter,
	canonicalise: (types: string[]) => Promise<Canonical[]>,
	input: { oid: number; canonical_name: string }[],
): Promise<ExclusiveRange[]> {
	if (input.length === 0) return [];

	const oids = input.map(i => i.oid);

	const results = await db.query<QueryResult, QueryParams>(query, [oids]);

	if (results.length !== input.length) {
		throw new Error("Mismatch between input range count and range detail results count.");
	}

	return Promise.all(
		results.map(async (result, index) => {
			const { canonical_name } = input[index]!;
			const subtypeName = result.name;

			if (!subtypeName) {
				throw new Error(`Range ${canonical_name} (Subtype OID: ${oids[index]}) lacks a resolved subtype name.`);
			}

			const canonicalSubtypes = (await canonicalise([subtypeName]))[0];

			if (!canonicalSubtypes) {
				throw new Error(
					`Failed to canonicalise subtype "${subtypeName}" for Range ${canonical_name} (Subtype OID: ${oids[index]}).`,
				);
			}

			return { kind: Canonical.Kind.Range, range_subtype: canonicalSubtypes };
		}),
	);
}
