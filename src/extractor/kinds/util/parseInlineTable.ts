interface TableColumn {
	name: string;
	type: string;
}

/**
 * Parse a Postgres RETURNS TABLE() definition string to extract column name and type pairs
 */
export function parsePostgresTableDefinition(tableDefinition: string): TableColumn[] {
	// Check if we have a table definition
	if (!tableDefinition || !tableDefinition.toLowerCase().trim().startsWith("table(")) {
		throw new Error('Invalid table definition format. Expected string starting with "TABLE("');
	}

	// Extract the content inside the TABLE() parentheses
	const tableContentMatch = tableDefinition.match(/TABLE\s*\(\s*(.*?)\s*\)$/is);
	if (!tableContentMatch || !tableContentMatch[1]) {
		return [];
	}

	const columnsDefinition = tableContentMatch[1];

	const columns: TableColumn[] = [];

	let currentPos = 0;
	let columnStart = 0;
	let parenLevel = 0;
	let inQuotes = false;
	let quoteChar: string | null = null;
	let escaping = false;

	const len = columnsDefinition.length;
	while (currentPos <= columnsDefinition.length) {
		// add a virtual comma to the end
		const char = currentPos === len ? "," : columnsDefinition[currentPos];

		if (escaping) {
			escaping = false;
			currentPos++;
			continue;
		}

		if (inQuotes) {
			if (char === "\\") {
				escaping = true;
				currentPos++;
				continue;
			}

			if (char === quoteChar) {
				inQuotes = false;
			}

			currentPos++;
			continue;
		}

		if (char === '"' || char === "'") {
			inQuotes = true;
			quoteChar = char;
			currentPos++;
			continue;
		}

		// Track parentheses nesting level
		if (char === "(") {
			parenLevel++;
		} else if (char === ")") {
			parenLevel--;
		}

		// At column boundary (comma outside of any parentheses or quotes)
		// or at the end of the string (when we add the virtual comma)
		if (char === "," && parenLevel === 0 && !inQuotes && currentPos >= columnStart) {
			const columnDef = columnsDefinition.substring(columnStart, currentPos).trim();
			if (columnDef) {
				try {
					columns.push(parseColumnDefinition(columnDef));
				} catch (error) {
					console.warn(`Skipping malformed column definition: ${columnDef}`, error);
				}
			}
			columnStart = currentPos + 1;
		}

		currentPos++;
	}

	return columns;
}

const unquote = (str: string) => {
	if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
		return str
			.substring(1, str.length - 1)
			.replace(/\\"/g, '"')
			.replace(/\\'/g, "'");
	}
	return str;
};

/**
 * Parse a single column definition like "id integer" or "\"User Name\" text"
 */
function parseColumnDefinition(columnDef: string): TableColumn {
	let pos = 0;
	let inQuotes = false;
	let quoteChar: string | null = null;
	let escaping = false;
	let nameEndPos = -1;

	while (pos < columnDef.length) {
		const char = columnDef[pos]!;

		if (escaping) {
			escaping = false;
			pos++;
			continue;
		}

		if (inQuotes) {
			if (char === "\\") {
				escaping = true;
			} else if (char === quoteChar) {
				inQuotes = false;
			}
			pos++;
			continue;
		}

		if (char === '"' || char === "'") {
			inQuotes = true;
			quoteChar = char;
			pos++;
			continue;
		}

		// Found whitespace outside quotes - this is where the name ends
		if (/\s/.test(char) && !inQuotes) {
			nameEndPos = pos;
			break;
		}

		pos++;
	}

	if (nameEndPos === -1) {
		throw new Error(`Could not parse column definition: ${columnDef}`);
	}

	// Extract the column name, removing quotes if present
	let name = columnDef.substring(0, nameEndPos).trim();

	name = unquote(name);

	// Everything after the column name is the type
	const type = columnDef.substring(nameEndPos).trim();

	return { name, type };
}

// Example usage with complex types
// const tableDefinition = 'TABLE("id" integer, "User Name" text, "complex field" varchar(255)[], "nested type" decimal(10,2), tags text[], "quoted""identifier" json)';
// const columns = parsePostgresTableDefinition(tableDefinition);
// console.log(columns);
