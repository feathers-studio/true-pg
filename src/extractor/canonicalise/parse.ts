export interface ParsedType {
	/** Name after removing modifiers and brackets, e.g. "varchar" in "varchar(50)" */
	plain: string;
	/** Modifiers, e.g. "50" in "varchar(50)" */
	modifiers: string | null;
	/** Number of dimensions from explicit brackets, e.g. 1 in "int[]" */
	dimensions: number;
	/** Original type name, e.g. "varchar(50)" */
	original: string;
}

/**
 * Parses a PostgreSQL type name string to extract its base name,
 * modifiers, and dimensions from explicit '[]' brackets.
 *
 * Examples:
 *
 * - `parseTypeName("varchar(50)")`
 *
 *		`⤷ { plain: "varchar", modifiers: "50", dimensions: 0, original: "varchar(50)" }`
 *
 * - `parseTypeName("int[]")`
 *
 *		`⤷ { plain: "int", modifiers: null, dimensions: 1, original: "int[]" }`
 *
 * - `parseTypeName("public.my_table[][]")`
 *
 *		`⤷ { plain: "public.my_table", modifiers: null, dimensions: 2, original: "public.my_table[][]" }`
 *
 * - `parseTypeName("numeric(10, 2)[]")`
 *
 *		`⤷ { plain: "numeric", modifiers: "10, 2", dimensions: 1, original: "numeric(10, 2)[]" }`
 *
 * - `parseTypeName("geometry(Point, 4326)")`
 *
 *		`⤷ { plain: "geometry", modifiers: "Point, 4326", dimensions: 0, original: "geometry(Point, 4326)" }`
 *
 * - `parseTypeName("_text")`
 *
 *		`⤷ { plain: "_text", modifiers: null, dimensions: 0, original: "_text" }`
 *
 *		Internal arrays aren't handled here
 */
export function parseRawType(type: string): ParsedType {
	let base = type;
	let modifiers: string | null = null;
	let dimensions = 0;

	// 1. Extract modifiers (content within the last parentheses)
	const modifierMatch = base.match(/\(([^)]*)\)$/);
	if (modifierMatch) {
		modifiers = modifierMatch[1]!;
		base = base.substring(0, modifierMatch.index).trim();
	}

	// 2. Count and remove explicit array brackets '[]'
	// Repeatedly remove '[]' from the end and count dimensions
	while (base.endsWith("[]")) {
		dimensions++;
		base = base.slice(0, -2);
	}

	return { original: type, plain: base, modifiers, dimensions };
}
