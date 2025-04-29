import type { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";
import type { Canonical } from "../canonicalise.ts";

/**
 * Domain type in a schema with details.
 */
export interface DomainDetails extends PgType<"domain"> {
	/**
	 * Canonical representation of the domain type
	 * with full attribute details.
	 */
	canonical: Canonical.Domain;
}

const extractDomain = async (db: DbAdapter, domain: PgType<"domain">): Promise<DomainDetails> => {
	// Form the fully qualified type name
	const fullTypeName = `"${domain.schemaName}"."${domain.name}"`;

	// Get canonical type information with all the metadata
	const [canonical] = await db.canonicalise([fullTypeName]);

	// Return the composite type with its canonical representation
	return {
		...domain,
		canonical: canonical as Canonical.Domain,
	};
};

export default extractDomain;
