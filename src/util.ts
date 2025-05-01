export const unreachable = (value: never): never => {
	throw new Error(`Fatal: Reached unreachable code: ${value}`);
};

export const eq = <T>(a: T, b: T): boolean => {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;

	for (const key in a) if (!eq(a[key], b[key])) return false;
	return true;
};

export const toPascalCase = (str: string) => {
	let result = "";

	let index = 0;
	let space = false;
	let leading = true;
	const len = str.length;
	while (index < len) {
		const char = str[index]!;

		// keep trailing underscores
		if (index === len - 1 && char === "_") {
			// iterate backwards until a non-underscore character is found
			let index = len - 1;
			while (index >= 0 && str[index]! === "_") {
				result += "_";
				index--;
			}

			break;
		}

		if (leading) {
			if (char === "_") {
				result += char;
			} else if (/[a-zA-Z]/.test(char)) {
				result += char.toUpperCase();
				leading = false;
			} else {
				// skip leading non-alphabetic characters
			}
		} else if (/[a-zA-Z0-9]/.test(char)) {
			// valid characters
			if (space) result += char.toUpperCase();
			else result += char;
			space = false;
		} else {
			// invalid characters, space, underscore, or hyphen
			// treat as space
			space = true;
		}

		index++;
	}

	return result;
};

export const to_snake_case = (str: string) => {
	let result = "";

	let index = 0;
	let space = false;
	let leading = true;
	let upper = false;
	const len = str.length;
	while (index < len) {
		const char = str[index]!;

		// keep trailing underscores
		if (index === len - 1 && char === "_") {
			// iterate backwards until a non-underscore character is found
			let index = len - 1;
			while (index >= 0 && str[index]! === "_") {
				result += "_";
				index--;
			}

			break;
		}

		if (leading) {
			if (char === "_") {
				result += char;
			} else if (/[A-Z]/.test(char)) {
				result += char.toLowerCase();
				leading = false;
				upper = true;
			} else if (/[a-z]/.test(char)) {
				result += char.toLowerCase();
				leading = false;
			} else {
				// skip leading non-alphabetic characters
			}
		} else if (/[A-Z]/.test(char)) {
			if (!upper) result += "_";
			if (space) result += "_";
			// uppercase characters
			result += char.toLowerCase();
			space = false;
			upper = true;
		} else if (/[a-z0-9]/.test(char)) {
			// valid characters
			if (space) result += "_";
			result += char;
			space = false;
			upper = false;
		} else {
			// invalid characters, space, underscore, or hyphen
			// treat as space
			space = true;
		}

		index++;
	}

	return result;
};

export const join = (parts: Iterable<string>, joiner = "\n\n") => Array.from(parts).filter(Boolean).join(joiner);

export type UnionKeys<T> = T extends unknown ? keyof T : never;

type AddOptionalKeys<K extends PropertyKey> = { [P in K]?: never };

export type Deunionise<B extends object | undefined, T = B> = Simplify<
	T extends object ? T & AddOptionalKeys<Exclude<UnionKeys<B>, keyof T>> : T
>;

export type Simplify<T> = {
	[KeyType in keyof T]: T[KeyType];
} & {};

const isIdentifierInvalid = (str: string) => {
	const invalid = str.match(/[^a-zA-Z0-9_]/);
	return invalid !== null;
};

export const parens = (str: string, type = "()"): string => `${type[0]!}${str}${type[1]!}`;

export const quote = (str: string, using = '"') => `${using}${str.replaceAll(using, "\\" + using)}${using}`;

export const quoteI = (str: string, using = '"') => (isIdentifierInvalid(str) ? quote(str, using) : str);

export const removeNulls = <T>(o: T): T => {
	for (const key in o) if (o[key] == null) delete o[key];
	return o;
};

export const pos = (num: number) => (num < 0 ? undefined : num);

export const minifyQuery = (query: string) => {
	return query
		.split("\n")
		.map(line => line.slice(0, pos(line.indexOf("--"))))
		.join("\n")
		.replaceAll(/\s+/g, " ")
		.trim();
};
