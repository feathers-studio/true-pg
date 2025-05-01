import { Canonical, type ExclusiveCanonProps } from "./types.ts";
import { DbAdapter } from "../adapter.ts";
import { Deferred, unreachable, type MaybePromise } from "../../util.ts";
import { resolveBasicInfo, type ResolvedBasicInfo } from "./resolve.ts";
import { parseRawType } from "./parse.ts";
import type { ParsedType } from "./parse.ts";
import { getEnumDetails } from "./enum.ts";
import { getCompositeDetails } from "./composite.ts";
import { getDomainDetails } from "./domain.ts";
import { getRangeDetails } from "./range.ts";

export { Canonical, type ExclusiveCanonProps };

export interface QueueMember {
	type: string;
	out: Canonical;
}

// The final boss strategy
//
// Insert placeholder objects wherever a Canonical is needed
// After extracting all tables, views, functions, etc. resolve all Canonicals
// Then map over the input types and wait for all cached promises to resolve
// Finally patch all Canonicals with resolved values

export const canonicaliseQueue = async (db: DbAdapter, queue: QueueMember[]): Promise<Canonical[]> => {
	if (queue.length === 0) return [];

	const parsed = queue.map(q => parseRawType(q.type));
	const plain = parsed.map(p => p.plain);
	const resolved = await resolveBasicInfo(db, plain);

	const unknown = resolved.filter(r => r.kind === Canonical.Kind.Unknown);
	if (unknown.length > 0) {
		throw new Error(
			"Received kind 'unknown', could not resolve types: " + unknown.map(u => u.canonical_name).join(", "),
		);
	}

	const internalQueue: QueueMember[] = [];
	const q = (types: string): Canonical => {
		const member: QueueMember = { type: types, out: {} as Canonical };
		internalQueue.push(member);
		return member.out;
	};

	const batches = {
		bases: [] as ResolvedBasicInfo[],
		enums: [] as ResolvedBasicInfo[],
		composites: [] as ResolvedBasicInfo[],
		domains: [] as ResolvedBasicInfo[],
		ranges: [] as ResolvedBasicInfo[],
		pseudos: [] as ResolvedBasicInfo[],
	};

	// split in one loop instead of 4 filters
	for (const r of resolved) {
		if (r.kind === Canonical.Kind.Base) batches.bases.push(r);
		if (r.kind === Canonical.Kind.Enum) batches.enums.push(r);
		if (r.kind === Canonical.Kind.Composite) batches.composites.push(r);
		if (r.kind === Canonical.Kind.Domain) batches.domains.push(r);
		if (r.kind === Canonical.Kind.Range) batches.ranges.push(r);
		if (r.kind === Canonical.Kind.Pseudo) batches.pseudos.push(r);
	}

	const canonicalMap = new Map<string, ExclusiveCanonProps>();

	{
		const Kind = Canonical.Kind;

		const bases = batches.bases.map(b => ({ kind: Kind.Base, canonical_name: b.canonical_name } as const));
		const [enums, composites, domains, ranges] = await Promise.all([
			getEnumDetails(db, batches.enums),
			getCompositeDetails(db, q, batches.composites),
			getDomainDetails(db, q, batches.domains),
			getRangeDetails(db, q, batches.ranges),
		] as const);
		const pseudo = batches.pseudos.map(p => ({ kind: Kind.Pseudo, canonical_name: p.canonical_name } as const));

		for (const b of bases) canonicalMap.set(b.canonical_name, b);
		for (const e of enums) canonicalMap.set(e.canonical_name, e);
		for (const c of composites) canonicalMap.set(c.canonical_name, c);
		for (const d of domains) canonicalMap.set(d.canonical_name, d);
		for (const r of ranges) canonicalMap.set(r.canonical_name, r);
		for (const p of pseudo) canonicalMap.set(p.canonical_name, p);
	}

	await Promise.all(
		resolved.map(async (info, index) => {
			const p = parsed[index]!;
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

				if (kind === Canonical.Kind.Unknown) {
					throw new Error(`Unknown type: ${info.canonical_name}`);
				}

				const exclusive = canonicalMap.get(info.canonical_name);

				if (!exclusive) {
					throw new Error(`(Unreachable) Could not find canonical type for ${info.canonical_name}`);
				}

				const result = { ...common, ...exclusive } as Canonical;
				Object.assign(m.out, result);
			} catch (error) {
				throw error;
			}
		}),
	);

	if (internalQueue.length > 0) {
		await canonicaliseQueue(db, internalQueue);
	}

	return queue.map(m => m.out);
};
