import { describe, it, expect } from "bun:test";

import { parsePostgresTableDefinition } from "./parseInlineTable.ts";

describe("parsePostgresTableDefinition", () => {
	it("should parse a table definition with a single column", () => {
		const tableDefinition = "TABLE(id integer)";
		const expectedColumns = [{ name: "id", type: "integer" }];
		expect(parsePostgresTableDefinition(tableDefinition)).toEqual(expectedColumns);
	});

	it("should parse a table definition with a fully qualified column type", () => {
		const tableDefinition = 'TABLE("Complex Type" "schema"."type")';
		const expectedColumns = [{ name: "Complex Type", type: '"schema"."type"' }];
		expect(parsePostgresTableDefinition(tableDefinition)).toEqual(expectedColumns);
	});

	it("should parse a complex table definition", () => {
		const tableDefinition =
			'TABLE("id" integer, "User Name" text, "complex field" varchar(255)[], "nested type" decimal(10,2), tags text[], "quoted\\"identifier" json)';
		const expectedColumns = [
			{ name: "id", type: "integer" },
			{ name: "User Name", type: "text" },
			{ name: "complex field", type: "varchar(255)[]" },
			{ name: "nested type", type: "decimal(10,2)" },
			{ name: "tags", type: "text[]" },
			{ name: 'quoted"identifier', type: "json" },
		];

		expect(parsePostgresTableDefinition(tableDefinition)).toEqual(expectedColumns);
	});
});
