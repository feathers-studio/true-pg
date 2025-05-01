import { Canonical, type ExclusiveEnum } from "./types.ts";
import type { DbAdapter } from "../adapter.ts";
import { minifyQuery } from "../../util.ts";

const query = minifyQuery(`
SELECT
	input.seq,
	json_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
FROM unnest($1::oid[]) WITH ORDINALITY AS input(oid, seq)
JOIN pg_enum e ON e.enumtypid = input.oid
GROUP BY input.seq, e.enumtypid
ORDER BY input.seq;
`);

type QueryResult = {
	// this does get returned, but we don't need it and hence it's dangerous to expose
	// seq: number;
	values: string[];
};

type QueryParams = [number[]];

export type { ExclusiveEnum };

/** Fetches enum values for given enum type OIDs */
export async function getEnumDetails(
	db: DbAdapter,
	entries: { oid: number; canonical_name: string }[],
): Promise<ExclusiveEnum[]> {
	if (entries.length === 0) return [];

	const results = await db.query<QueryResult, QueryParams>(query, [entries.map(o => o.oid)]);
	return results.map((r, i) => ({
		kind: Canonical.Kind.Enum,
		canonical_name: entries[i]!.canonical_name,
		enum_values: r.values,
	}));
}
