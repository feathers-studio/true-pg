import type { DbAdapter } from "../adapter.ts";

import type { PgType } from "../pgtype.ts";
import type { Canonical } from "../canonicalise/index.ts";

/**
 * Composite type in a schema with details.
 */
export interface CompositeTypeDetails extends PgType<"composite"> {
	/**
	 * Canonical representation of the composite type
	 * with full attribute details.
	 */
	canonical: Canonical.Composite;
}

const extractComposite = async (db: DbAdapter, composite: PgType<"composite">): Promise<CompositeTypeDetails> => {
	// Form the fully qualified type name
	const fullTypeName = `"${composite.schemaName}"."${composite.name}"`;

	// Get canonical type information with all the metadata
	const canonical = db.enqueue(fullTypeName);

	// Return the composite type with its canonical representation
	return {
		...composite,
		canonical: canonical as Canonical.Composite,
	};
};

export default extractComposite;
