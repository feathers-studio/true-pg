import { minifyQuery } from "../../util.ts";
import type { DbAdapter } from "../adapter.ts";
import type { Canonical } from "./types.ts";

const query = minifyQuery(`
WITH RECURSIVE
input(base_type_name, seq) AS (
	SELECT * FROM unnest($1::text[]) WITH ORDINALITY
),
type_resolution(seq, current_oid, level) AS (
	-- Base case: Look up the initial base type name
	SELECT i.seq, t.oid, 1, i.base_type_name
	FROM input i JOIN pg_type t ON t.oid = i.base_type_name::regtype
	UNION ALL
	-- Recursive step: Follow typelem for standard arrays (_)
	SELECT r.seq, t.typelem, r.level + 1, r.base_type_name
	FROM type_resolution r JOIN pg_type t ON r.current_oid = t.oid
	-- // TODO: do a more robust check for array types than 'left(t.typname, 1) = '_'
	WHERE t.typelem != 0 AND left(t.typname, 1) = '_'
),
final_resolution AS (
	-- Get the OID and max level (depth) for each sequence number
	SELECT DISTINCT ON (seq) seq, current_oid AS base_type_oid, level, base_type_name
	FROM type_resolution ORDER BY seq, level DESC
)
-- Combine resolution with basic type info fetching
SELECT
	fr.seq,
	fr.base_type_name as original_name,
	fr.base_type_oid AS oid,
	(fr.level - 1) AS internal_dimensions,
	n.nspname AS schema,
	t.typname AS name,
	n.nspname || '.' || t.typname AS canonical_name,
	CASE t.typtype
		WHEN 'b' THEN 'base'::text
		WHEN 'c' THEN 'composite'::text
		WHEN 'd' THEN 'domain'::text
		WHEN 'e' THEN 'enum'::text
		WHEN 'p' THEN 'pseudo'::text
		WHEN 'r' THEN 'range'::text
		ELSE 'unknown'::text
	END AS kind,
	t.typrelid, -- needed for composite details
	t.typbasetype, -- needed for domain details
	COALESCE(r.rngsubtype, 0) AS rngsubtype -- needed for range details
FROM final_resolution fr
JOIN pg_type t ON t.oid = fr.base_type_oid
JOIN pg_namespace n ON t.typnamespace = n.oid
LEFT JOIN pg_range r ON t.oid = r.rngtypid AND t.typtype = 'r'
ORDER BY fr.seq;
`);

type QueryResult = ResolvedBasicInfo;

type QueryParams = [string[]];

export interface ResolvedBasicInfo {
	original_name: string;
	oid: number;
	internal_dimensions: number;
	schema: string;
	name: string;
	canonical_name: string;
	kind: Canonical.Kind;
	typrelid: number;
	typbasetype: number;
	rngsubtype: number;
}

/**
 * Takes base type names (without modifiers/brackets), resolves them to their ultimate base type OID
 * and internal array dimensions, and fetches basic kind information
 */
export async function resolveBasicInfo(db: DbAdapter, types: string[]): Promise<ResolvedBasicInfo[]> {
	if (types.length === 0) return [];

	const results = await db.query<QueryResult, QueryParams>(query, [types]);
	return results;
}
