import { Canonical, type ExclusiveCanonProps } from "./types.ts";
import { DbAdapter } from "../adapter.ts";
import { resolveBasicInfo, type ResolvedBasicInfo } from "./resolve.ts";
import { parseRawType } from "./parse.ts";
import { getEnumDetails } from "./enum.ts";
import { getCompositeDetails } from "./composite.ts";
import { getDomainDetails } from "./domain.ts";
import { getRangeDetails } from "./range.ts";
// import { time } from "../../util.ts";

export { Canonical, type ExclusiveCanonProps };

export interface QueueMember {
	type: string;
	out: Canonical;
}

// The Final Strategy
//
// Insert placeholder objects wherever a Canonical is needed
// After extracting all tables, views, functions, etc. resolve all Canonicals
// Then map over the input types and wait for all cached promises to resolve
// Finally patch all Canonicals with resolved values

export const canonicaliseQueue = async (
	db: DbAdapter,
	queue: QueueMember[],
	resolveCache: Map<string, ResolvedBasicInfo> = new Map(),
	canonCache: Map<string, ExclusiveCanonProps> = new Map(),
	recursive = false,
): Promise<Canonical[]> => {
	if (queue.length === 0) return [];
	// const start = performance.now();

	const parsed = queue.map(q => parseRawType(q.type));
	const plain = [...new Set(parsed.filter(p => !resolveCache.has(p.plain)).map(p => p.plain))];
	const resolved = await resolveBasicInfo(db, plain);

	plain.forEach((p, i) => {
		const r = resolved[i];
		if (!r) throw new Error(`(Unreachable) Could not find resolved basic info for ${p}`);
		resolveCache.set(p, r);
	});

	const unknown = resolved.filter(r => r.kind === Canonical.Kind.Unknown);
	if (unknown.length > 0) {
		const types = unknown.map(u => u.canonical_name).join(", ");
		throw new Error(`Received kind 'unknown', could not resolve ${unknown.length} types: ${types}`);
	}

	const internalQueue: QueueMember[] = [];
	const q = (types: string): Canonical => {
		const member: QueueMember = { type: types, out: {} as Canonical };
		internalQueue.push(member);
		return member.out;
	};

	const batches = {
		enums: [] as ResolvedBasicInfo[],
		composites: [] as ResolvedBasicInfo[],
		domains: [] as ResolvedBasicInfo[],
		ranges: [] as ResolvedBasicInfo[],
	};

	let seen = new Set<string>();

	const Kind = Canonical.Kind;

	// split in one loop instead of 4 filters
	for (const r of resolved) {
		if (canonCache.has(r.canonical_name)) continue;

		// deduplicate
		if (seen.has(r.canonical_name)) continue;
		seen.add(r.canonical_name);

		if (r.kind === Kind.Enum) batches.enums.push(r);
		if (r.kind === Kind.Composite) batches.composites.push(r);
		if (r.kind === Kind.Domain) batches.domains.push(r);
		if (r.kind === Kind.Range) batches.ranges.push(r);

		// special cases because these are not further extracted
		if (r.kind === Kind.Base || r.kind === Kind.Pseudo)
			canonCache.set(r.canonical_name, { kind: r.kind, canonical_name: r.canonical_name } as const);
	}

	// @ts-expect-error allow GC
	seen = null;

	{
		// extract all in parallel
		const [enums, composites, domains, ranges] = await Promise.all([
			getEnumDetails(db, batches.enums),
			getCompositeDetails(db, q, batches.composites),
			getDomainDetails(db, q, batches.domains),
			getRangeDetails(db, q, batches.ranges),
		] as const);

		for (const e of enums) canonCache.set(e.canonical_name, e);
		for (const c of composites) canonCache.set(c.canonical_name, c);
		for (const d of domains) canonCache.set(d.canonical_name, d);
		for (const r of ranges) canonCache.set(r.canonical_name, r);
	}

	await Promise.all(
		parsed.map(async (p, index) => {
			const info = resolveCache.get(p.plain);
			if (!info) throw new Error(`(Unreachable) Could not find resolved basic info for ${p.plain}`);

			const m = queue[index]!;

			try {
				const dimensions = p.dimensions + info.internal_dimensions;

				const common = {
					kind: info.kind,
					oid: info.oid,
					typrelid: info.typrelid,
					typbasetype: info.typbasetype,
					rngsubtype: info.rngsubtype,
					canonical_name: info.canonical_name,
					schema: info.schema,
					name: info.name,
					original_type: p.original,
					modifiers: p.modifiers,
					dimensions,
				};

				const kind = info.kind;

				if (kind === Canonical.Kind.Unknown)
					throw new Error(`Could not find canonical type for "${info.schema}.${info.canonical_name}"`);

				const exclusive = canonCache.get(info.canonical_name);

				if (!exclusive) throw new Error(`(Unreachable) Could not find canonical type for ${info.canonical_name}`);

				const result = { ...common, ...exclusive } as Canonical;
				Object.assign(m.out, result);
			} catch (error) {
				throw error;
			}
		}),
	);

	if (internalQueue.length > 0) {
		await canonicaliseQueue(db, internalQueue, resolveCache, canonCache, true);
	}

	const ret = queue.map(m => m.out);
	// if (!recursive) console.log(`Canonicalise took ${time(start)}`);
	return ret;
};

export const oidsToQualifiedNames = async (db: DbAdapter, oids: number[]): Promise<string[]> => {
	if (oids.length === 0) return [];

	const query = `
		SELECT
			input.ord,
			format('%I.%I', n.nspname, t.typname) AS qualified_name
		-- Use unnest WITH ORDINALITY because SQL doesn't guarantee order of SELECT results
		FROM unnest($1::oid[]) WITH ORDINALITY AS input(oid, ord)
		JOIN pg_type t ON t.oid = input.oid
		JOIN pg_namespace n ON t.typnamespace = n.oid
		ORDER BY input.ord;
	`;

	const results = await db.query<{ ord: number; qualified_name: string }, [number[]]>(query, [oids]);
	return results.map(r => r.qualified_name);
};

export const canonicaliseFromOids = async (db: DbAdapter, oids: number[]): Promise<Canonical[]> => {
	if (oids.length === 0) return [];

	const types = await oidsToQualifiedNames(db, oids);

	const unknown = types.filter(name => name == undefined);
	if (unknown.length > 0) throw new Error(`Failed to resolve OIDs to type names: ${unknown.join(", ")}`);

	return canonicaliseQueue(
		db,
		types.map(t => ({ type: t, out: {} as Canonical })),
	);
};
