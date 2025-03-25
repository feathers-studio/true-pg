import {
	Extractor,
	type CompositeTypeAttribute,
	type CompositeTypeDetails,
	type EnumDetails,
	type FunctionDetails,
	type TableColumn,
	type TableDetails,
} from "pg-extract";
import { rm, mkdir, writeFile } from "fs/promises";

export interface TruePGOpts {
	connectionString: string;
	outDir: string;
}

export interface Generator {
	table(table: TableDetails): string;
	enum(en: EnumDetails): string;
	composite_type(type: CompositeTypeDetails): string;
	function(type: FunctionDetails): string;
}

export interface createGenerator {
	(): Generator;
}

export const TruePG: createGenerator = () => {
	const generator = {
		column(col: TableColumn) {
			let out = col.name;

			if (col.isNullable) out += "?";
			// TODO: update imports for non-primitive types
			out += `: ${col.type.fullName}`;
			if (col.dimensions) out += "[]".repeat(col.dimensions);
			if (col.isNullable) out += " | null";

			return out;
		},

		table(table: TableDetails) {
			let out = `export interface ${table.name} {\n`;
			for (const col of table.columns) out += `\t${this.column(col)};\n`;
			out += "}\n";

			return out;
		},

		enum(en: EnumDetails) {
			let out = `export interface ${en.name} {\n`;
			for (const v of en.values) out += `\t${v};\n`;
			out += "}\n";
			return out;
		},

		composite_attribute(attr: CompositeTypeAttribute) {
			let out = attr.name;

			if (attr.isNullable) out += "?";
			out += `: ${attr.type.fullName}`;
			if (attr.isArray) out += "[]";
			if (attr.isNullable) out += " | null";

			return out;
		},

		composite_type(type: CompositeTypeDetails) {
			let out = `export interface ${type.name} {\n`;

			const props = type.attributes.map(c => this.composite_attribute(c)).map(t => `\t${t};`);
			out += props.join("\n");
			out += "\n}\n";

			return out;
		},

		function(type: FunctionDetails) {
			let out = "";

			if (type.comment) {
				out += "/**\n";
				out += ` * ${type.comment}\n`;
				out += " */\n";
			}
			out += "export interface ";
			out += type.name;
			out += " {\n\t";

			// Get the input parameters (those that appear in function signature)
			const inputParams = type.parameters.filter(
				p => p.mode === "IN" || p.mode === "INOUT" || p.mode === "VARIADIC",
			);

			if (inputParams.length === 0) {
				out += "(): ";
			} else if (inputParams.length === 1) {
				out += "(";
				out += inputParams[0]!.name;
				out += ": ";
				out += inputParams[0]!.type.canonical_name;
				if (inputParams[0]!.type.dimensions > 0) out += "[]".repeat(inputParams[0]!.type.dimensions);
				out += "): ";
			} else if (inputParams.length > 0) {
				out += "(\n";

				for (const param of inputParams) {
					// Handle variadic parameters differently if needed
					const isVariadic = param.mode === "VARIADIC";
					const paramName = isVariadic ? `...${param.name}` : param.name;

					out += `\t\t${paramName}`;
					if (param.hasDefault && !isVariadic) out += "?";
					// TODO: update imports for non-primitive types based on typeInfo.kind
					out += `: ${param.type.canonical_name}`;
					if (param.type.dimensions > 0) out += "[]".repeat(param.type.dimensions);
					if (!isVariadic) out += ",";
					out += "\n";
				}

				out += "\t): ";
			}

			if (type.returnType.kind === "table") {
				out += "{\n";
				for (const col of type.returnType.columns) {
					out += `\t\t${col.name}: `;
					out += col.type.canonical_name;
					if (col.type.dimensions > 0) out += "[]".repeat(col.type.dimensions);
					out += `;\n`;
				}
				out += "\t}";
			} else {
				out += type.returnType.type.canonical_name;
				if (type.returnType.type.dimensions > 0) out += "[]".repeat(type.returnType.type.dimensions);
			}

			// Add array brackets based on dimensions
			if (type.returnType.kind === "regular" && type.returnType.type.dimensions > 0) {
				out += "[]".repeat(type.returnType.type.dimensions);
			}

			// Add additional array brackets if it returns a set
			if (type.returnType.isSet) {
				out += "[]";
			}

			out += ";\n}\n";

			return out;
		},

		// Add a helper method to explain volatility
		explainVolatility(volatility: FunctionDetails["volatility"]): string {
			switch (volatility) {
				case "IMMUTABLE":
					return "Function cannot modify the database and always returns the same result given the same arguments";
				case "STABLE":
					return "Function cannot modify the database and returns the same result given the same arguments within a single table scan";
				case "VOLATILE":
					return "Function can modify the database and may return different results on successive calls with the same arguments";
				default:
					return "";
			}
		},
	};

	return generator;
};

export async function generate(opts: TruePGOpts) {
	const { connectionString, outDir } = opts;

	const extractor = new Extractor(connectionString);

	const schemas = await extractor.extractSchemas();

	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	const generator = TruePG();

	for (const schema of Object.values(schemas)) {
		const schemaDir = `${outDir}/${schema.name}`;

		await mkdir(`${schemaDir}/tables`, { recursive: true });

		for (const table of schema.tables) {
			await writeFile(`${schemaDir}/tables/${table.name}.ts`, generator.table(table));
		}

		await mkdir(`${schemaDir}/enums`, { recursive: true });

		for (const en of schema.enums) {
			await writeFile(`${schemaDir}/enums/${en.name}.ts`, generator.enum(en));
		}

		await mkdir(`${schemaDir}/composite_types`, { recursive: true });

		for (const type of schema.compositeTypes) {
			await writeFile(`${schemaDir}/composite_types/${type.name}.ts`, generator.composite_type(type));
		}

		await mkdir(`${schemaDir}/functions`, { recursive: true });

		for (const func of schema.functions) {
			await writeFile(`${schemaDir}/functions/${func.name}.ts`, generator.function(func));
		}
	}
}

const connectionString = "postgres://mkrcal:mkrcal@localhost:5432/mkrcal";
const outDir = "./out";

generate({ connectionString, outDir });
