import { Canonical, type ExclusiveDomain } from "./types.ts";
import type { DbAdapter } from "../adapter.ts";
import { minifyQuery } from "../../util.ts";

const query = minifyQuery(`
	WITH RECURSIVE
	-- 1. Unnest input OIDs and sequences
	input_data AS (
		SELECT oid, seq
		FROM unnest($1::oid[]) WITH ORDINALITY AS u(oid, seq)
	),
	-- 2. Recursively find the base type for each input OID
	domain_chain(input_seq, current_oid, base_oid, level) AS (
		-- Base case: Start with the input OIDs from unnested data
		SELECT
			i.seq,
			i.oid,
			t.typbasetype,
			1
		FROM input_data i
		JOIN pg_type t ON t.oid = i.oid
		WHERE t.typtype = 'd' -- Ensure it's actually a domain

		UNION ALL

		-- Recursive step: Follow the domain chain for each sequence
		SELECT
			dc.input_seq,
			dc.base_oid, -- The current OID becomes the base OID from the previous step
			t.typbasetype,
			dc.level + 1
		FROM domain_chain dc
		JOIN pg_type t ON dc.base_oid = t.oid
		WHERE t.typtype = 'd' -- Continue only if the next type is also a domain
	),
	-- 3. Determine the final base OID for each sequence
	final_base AS (
		SELECT DISTINCT ON (i.seq)
			i.seq,
			-- Use the ultimate base_oid from the chain if it exists for this seq,
			-- otherwise fallback to the original input OID for this seq
			COALESCE(
				(SELECT dc.base_oid FROM domain_chain dc WHERE dc.input_seq = i.seq ORDER BY dc.level DESC LIMIT 1),
				i.oid
			) AS oid
		FROM input_data i
	)
	-- 4. Fetch the formatted name for the final OID for each sequence
	SELECT
		fb.seq,
		format('%I.%I', n.nspname, t.typname) AS name
	FROM final_base fb
	JOIN pg_type t ON t.oid = fb.oid
	JOIN pg_namespace n ON t.typnamespace = n.oid
	ORDER BY fb.seq;
`);

// name can be null if OID invalid?
type QueryResult = { name: string | null };
type QueryParams = [number[]];

export type { ExclusiveDomain };

/**
 * Fetches the canonical name of the ultimate base type for a given domain OID
 * in a single query. If the OID is not a domain, it returns the name of the
 * type corresponding to the original OID.
 */
export async function getDomainDetails(
	db: DbAdapter,
	enqueue: (types: string) => Canonical,
	entries: { oid: number; canonical_name: string }[],
): Promise<ExclusiveDomain[]> {
	if (entries.length === 0) return [];

	const results = await db.query<QueryResult, QueryParams>(query, [entries.map(i => i.oid)]);

	// Basic check for result length mismatch
	if (results.length !== entries.length) {
		throw new Error("Mismatch between input domain count and domain detail results count.");
	}

	return results.map((result, index) => {
		const { canonical_name, oid } = entries[index]!;
		const name = result.name;

		if (!name) {
			throw new Error(`Could not resolve base type for domain ${canonical_name} (OID: ${oid}).`);
		}

		const canonicalBaseType = enqueue(name);
		return { kind: Canonical.Kind.Domain, canonical_name, domain_base_type: canonicalBaseType };
	});
}
