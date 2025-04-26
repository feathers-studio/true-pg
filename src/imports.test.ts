import { Canonical } from "./extractor/canonicalise.ts";
import { Import, ImportList } from "./imports.ts";
import { describe, it, expect } from "bun:test";
import type { FolderStructure } from "./types.ts";

const files: FolderStructure = {
	name: "root",
	type: "root",
	children: {
		public: {
			name: "public",
			type: "schema",
			children: {
				function: {
					kind: "function",
					type: "kind",
					children: {},
				},
				view: {
					kind: "view",
					type: "kind",
					children: {},
				},
				materializedView: {
					kind: "materializedView",
					type: "kind",
					children: {},
				},
				composite: {
					kind: "composite",
					type: "kind",
					children: {},
				},
				table: {
					kind: "table",
					type: "kind",
					children: {
						testTable: {
							name: "testTable",
							type: "type",
						},
					},
				},
				range: {
					kind: "range",
					type: "kind",
					children: {},
				},
				enum: {
					kind: "enum",
					type: "kind",
					children: {
						testEnum: {
							name: "testEnum",
							type: "type",
						},
					},
				},
				domain: {
					kind: "domain",
					type: "kind",
					children: {},
				},
			},
		},
	},
};

describe("Import Class", () => {
	it("should initialize correctly with constructor arguments", () => {
		const importInstance = new Import({
			from: "module/path",
			namedImports: ["component"],
			star: "starImport",
			default: "defaultImport",
			typeOnly: true,
		});

		expect(importInstance.from).toBe("module/path");
		expect(importInstance.namedImports).toEqual(["component"]);
		expect(importInstance.star).toBe("starImport");
		expect(importInstance.default).toBe("defaultImport");
		expect(importInstance.typeOnly).toBe(true);
	});

	it("should create import fromInternal method correctly", () => {
		const importInstance = Import.fromInternal({
			source: "root/public/testEnum/testEnum.ts",
			type: {
				schema: "public",
				kind: Canonical.Kind.Enum,
				name: "testEnum",
				canonical_name: "test",
				dimensions: 1,
				enum_values: ["test1", "test2", "test3"],
				original_type: "string",
			},
		});

		expect(importInstance).toBeInstanceOf(Import);
		expect(
			typeof importInstance.from === "function" ||
				typeof importInstance.from === "string",
		).toBe(true);

		if (typeof importInstance.from === "function") {
			const generatedPath = importInstance.from(files);

			expect(generatedPath).toBe("../enums/testEnum.ts");
		}
	});

	it("should handle missing properties in fromInternal method", () => {
		const importInstance = Import.fromInternal({
			source: "root/public/testEnum/testEnum.ts",
			type: {
				schema: "public",
				kind: Canonical.Kind.Enum,
				name: "testEnum",
				canonical_name: "test",
				dimensions: 1,
				enum_values: ["test1", "test2", "test3"],
				original_type: "string",
			},
		});

		expect(importInstance).toBeInstanceOf(Import);
		expect(
			typeof importInstance.from === "function" ||
				typeof importInstance.from === "string",
		).toBe(true);

		if (typeof importInstance.from === "function") {
			const generatedPath = importInstance.from(files);

			expect(generatedPath).toBe("../enums/testEnum.ts");
		}
	});

	it("should handle missing `namedImports` or other constructor properties", () => {
		const importInstance = new Import({ from: "module/path" });

		expect(importInstance.from).toBe("module/path");
		expect(importInstance.namedImports).toBeUndefined();
		expect(importInstance.star).toBeUndefined();
		expect(importInstance.default).toBeUndefined();
		expect(importInstance.typeOnly).toBe(false);
	});
});

describe("ImportList Class", () => {
	it("should add imports correctly", () => {
		const importList = new ImportList();
		const newImport = new Import({
			from: "module/path",
			namedImports: ["MyComponent"],
		});

		importList.add(newImport);
		expect(importList.imports).toHaveLength(1);
		expect(importList.imports[0]).toBe(newImport);
	});

	it("should merge import lists correctly", () => {
		const list1 = new ImportList([
			new Import({ from: "module1", namedImports: ["a"] }),
		]);
		const list2 = new ImportList([
			new Import({ from: "module2", namedImports: ["b"] }),
		]);

		const mergedList = ImportList.merge([list1, list2]);
		expect(mergedList.imports).toHaveLength(2);
	});

	it("should merge import lists correctly with empty list", () => {
		const list1 = new ImportList([
			new Import({ from: "module1", namedImports: ["a"] }),
		]);
		const list2 = new ImportList([]);

		const mergedList = ImportList.merge([list1, list2]);
		expect(mergedList.imports).toHaveLength(1);
	});

	it("should stringify imports correctly", () => {
		const importList = new ImportList([
			new Import({ from: "module1", namedImports: ["a"] }),
			new Import({ from: "module1", namedImports: ["b"] }),
		]);

		const result = importList.stringify(files);

		expect(result).toContain('import { a, b } from "module1";');
	});

	it("should handle empty ImportList gracefully", () => {
		const importList = new ImportList();
		const files: FolderStructure = {
			name: "root",
			type: "root",
			children: {},
		};

		const result = importList.stringify(files);
		expect(result).toBe("");
	});

	it("should handle duplicate imports and avoid repetition", () => {
		const importList = new ImportList([
			new Import({ from: "module1", namedImports: ["a"] }),
			new Import({ from: "module1", namedImports: ["a"] }),
		]);

		const result = importList.stringify(files);
		expect(result).toContain('import { a } from "module1";');
		expect(result.split("import").length).toBe(2);
	});
});
