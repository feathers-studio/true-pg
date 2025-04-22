import { describe, it, expect } from "bun:test";

import { toPascalCase, to_snake_case } from "./util.ts";

describe("toPascalCase", () => {
	it("should convert a string to PascalCase", () => {
		expect(toPascalCase("hello-world")).toBe("HelloWorld");
	});

	it("should skip leading invalid characters", () => {
		expect(toPascalCase("123hello-world")).toBe("HelloWorld");
	});

	it("should skip leading spaces", () => {
		expect(toPascalCase(" hello-world")).toBe("HelloWorld");
	});

	it("should keep leading underscores", () => {
		expect(toPascalCase("__hello-world")).toBe("__HelloWorld");
	});

	it("should keep trailing underscores", () => {
		expect(toPascalCase("hello_world___")).toBe("HelloWorld___");
	});

	it("should keep leading and trailing underscores", () => {
		expect(toPascalCase("__hello_world__")).toBe("__HelloWorld__");
	});

	it("should convert spaces to uppercase", () => {
		expect(toPascalCase("hello world")).toBe("HelloWorld");
	});

	it("should convert hyphens to uppercase", () => {
		expect(toPascalCase("hello-world")).toBe("HelloWorld");
	});

	it("should convert camelCase to PascalCase", () => {
		expect(toPascalCase("helloWorld")).toBe("HelloWorld");
	});

	it("should convert snake_case to PascalCase", () => {
		expect(toPascalCase("hello_world")).toBe("HelloWorld");
	});

	it("should skip invalid characters", () => {
		expect(toPascalCase("hello?world!")).toBe("HelloWorld");
	});

	it("should generate valid identifier", () => {
		expect(toPascalCase("   _ hello ? world !")).toBe("_HelloWorld");
	});
});

describe("to_snake_case", () => {
	it("should convert a string to snake_case", () => {
		expect(to_snake_case("hello-world")).toBe("hello_world");
	});

	it("should skip leading invalid characters", () => {
		expect(to_snake_case("123hello-world")).toBe("hello_world");
	});

	it("should skip leading spaces", () => {
		expect(to_snake_case(" hello-world")).toBe("hello_world");
	});

	it("should keep leading underscores", () => {
		expect(to_snake_case("__hello-world")).toBe("__hello_world");
	});

	it("should keep trailing underscores", () => {
		expect(to_snake_case("hello_world___")).toBe("hello_world___");
	});

	it("should keep leading and trailing underscores", () => {
		expect(to_snake_case("__hello_world__")).toBe("__hello_world__");
	});

	it("should convert spaces to underscores", () => {
		expect(to_snake_case("hello world")).toBe("hello_world");
	});

	it("should convert camelCase to snake_case", () => {
		expect(to_snake_case("helloWorld")).toBe("hello_world");
	});

	it("should convert PascalCase to snake_case", () => {
		expect(to_snake_case("HelloWorld")).toBe("hello_world");
	});

	it("should skip invalid characters", () => {
		expect(to_snake_case("hello?world!")).toBe("hello_world");
	});

	it("should generate valid identifier", () => {
		expect(to_snake_case("   _ hello ? world !")).toBe("_hello_world");
	});

	it("should convert uppercase characters to underscores", () => {
		expect(to_snake_case("HELLO_WORLD")).toBe("hello_world");
	});
});
