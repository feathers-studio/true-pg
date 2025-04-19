import { DbAdapter } from "./adapter.ts";

/**
 * In order to ignore the items (types, views, etc.) that belong to extensions,
 * we use these queries to figure out what the OID's of those are. We can then
 * ignore them in fetchClasses.
 * @returns the oids of the Postgres extension classes and types
 */
export default async function fetchExtensionItemIds(db: DbAdapter): Promise<{
	extClassOids: number[];
	extTypeOids: number[];
	extProcOids: number[];
}> {
	// Query for class OIDs
	const classQuery = `
		SELECT c.oid
		FROM pg_extension AS e
		JOIN pg_depend AS d ON d.refobjid = e.oid
		JOIN pg_class AS c ON c.oid = d.objid
		JOIN pg_namespace AS ns ON ns.oid = e.extnamespace
		WHERE d.deptype = 'e'
	`;
	const classResult = await db.query<{ oid: number }>(classQuery);
	const extClassOids = classResult.map(({ oid }) => oid);

	// Query for type OIDs
	const typeQuery = `
		SELECT t.oid
		FROM pg_extension AS e
		JOIN pg_depend AS d ON d.refobjid = e.oid
		JOIN pg_type AS t ON t.oid = d.objid
		JOIN pg_namespace AS ns ON ns.oid = e.extnamespace
		WHERE d.deptype = 'e'
	`;
	const typeResult = await db.query<{ oid: number }>(typeQuery);
	const extTypeOids = typeResult.map(({ oid }) => oid);

	// Query for procedure OIDs
	const procQuery = `
		SELECT p.oid
		FROM pg_extension AS e
		JOIN pg_depend AS d ON d.refobjid = e.oid
		JOIN pg_proc AS p ON p.oid = d.objid
		JOIN pg_namespace AS ns ON ns.oid = e.extnamespace
		WHERE d.deptype = 'e'
	`;
	const procResult = await db.query<{ oid: number }>(procQuery);
	const extProcOids = procResult.map(({ oid }) => oid);

	return { extClassOids, extTypeOids, extProcOids };
}
