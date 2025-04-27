import { dirname, relative } from "node:path/posix";

import type { Canonical } from "./extractor/index.ts";
import type { FunctionReturnType } from "./extractor/index.ts";
import type { allowed_kind_names, FolderStructure } from "./types.ts";

import { eq } from "./util.ts";

export interface ImportIdentifier {
	name: string;
	alias?: string;
	typeOnly?: boolean;
}

type Supported<T> = {
	[key in allowed_kind_names]: T extends { kind: key } ? T : never;
}[allowed_kind_names];

export class Import {
	from: string | ((files: FolderStructure) => string);
	namedImports?: (string | ImportIdentifier)[];
	star?: string;
	default?: string;
	typeOnly?: boolean;

	constructor(args: {
		from: string | ((files: FolderStructure) => string);
		namedImports?: (string | ImportIdentifier)[];
		star?: string;
		default?: string;
		typeOnly?: boolean;
	}) {
		this.from = args.from;
		this.namedImports = args.namedImports;
		this.star = args.star;
		this.default = args.default;
		this.typeOnly = args.typeOnly ?? false;
	}

	static fromInternal(opts: {
		source: string;
		type: Supported<Canonical | FunctionReturnType.ExistingTable>;
		withName?: string;
		typeOnly?: boolean;
	}) {
		const t = opts.type;

		return new Import({
			from: files => {
				const schema = files.children[t.schema]!;
				const kind = schema.children[t.kind]!;
				const type = kind.children[t.name]!;
				const path = `${files.name}/${schema.name}/${kind.kind}s/${type.name}.ts`;
				return relative(dirname(opts.source), path);
			},
			namedImports: [opts.withName ?? t.name],
			typeOnly: opts.typeOnly,
		});
	}
}

export class ImportList {
	constructor(public imports: Import[] = []) {}

	static merge(lists: ImportList[]) {
		return new ImportList(lists.flatMap(l => l.imports));
	}

	add(item: Import) {
		this.imports.push(item);
	}

	stringify(files: FolderStructure) {
		const modulegroups: Record<string, Import[]> = {};
		for (const item of this.imports) {
			const from = typeof item.from === "function" ? item.from(files) : item.from;
			const group = modulegroups[from];
			if (group) group.push(item);
			else modulegroups[from] = [item];
		}

		const imports: string[] = [];

		const modules = Object.keys(modulegroups).sort((a, b) => {
			const dotA = a.startsWith(".");
			const dotB = b.startsWith(".");
			// we could do localeCompare instead of 0, but 0 maintains order of fields for imports
			return dotA === dotB ? 0 : dotA ? 1 : -1;
		});

		let broke = false;

		for (const from of modules) {
			if (!broke && from.startsWith(".")) {
				imports.push("");
				broke = true;
			}

			const items = modulegroups[from]!;

			// unique named imports from this module
			const namedImports = items
				.flatMap(
					s =>
						s.namedImports?.map(i => (typeof i === "string" ? { name: i, typeOnly: s.typeOnly } : i)) ?? [],
				)
				.filter((imp, index, arr) => {
					if (arr.findIndex(i => eq(i, imp)) !== index) return false;
					return true;
				});

			const allTypeOnly = namedImports.every(i => i.typeOnly);

			const namedImportPart = namedImports
				.map(i => (!allTypeOnly && i.typeOnly ? "type " : "") + i.name)
				.join(", ");

			const namedImportLine = namedImportPart
				? `import ${allTypeOnly ? "type " : ""}{ ${namedImportPart} } from "${from}";`
				: undefined;

			// all star imports from this module
			const stars = items.filter(i => i.star).filter((i, index, arr) => arr.findIndex(j => eq(j, i)) === index);

			const starImportLines = stars.map(i => `import ${i.typeOnly ? "type " : ""}* as ${i.star} from "${from}";`);

			// all default imports from this module
			const defaults = items
				.filter(i => i.default)
				.filter((i, index, arr) => arr.findIndex(j => eq(j, i)) === index);

			const defaultImportLines = defaults.map(
				i => `import ${i.typeOnly ? "type " : ""}${i.default} from "${from}";`,
			);

			const sideEffectImports = items.find(i => !i.default && !i.star && !i.namedImports?.length);
			const sideEffectImportLine = sideEffectImports ? `import "${sideEffectImports.from}";` : undefined;

			if (sideEffectImportLine) imports.push(sideEffectImportLine);
			if (namedImportLine) imports.push(namedImportLine);
			if (starImportLines.length) imports.push(...starImportLines);
			if (defaultImportLines.length) imports.push(...defaultImportLines);
		}

		return imports.join("\n");
	}
}
