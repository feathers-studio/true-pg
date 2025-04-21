export const join = (parts: Iterable<string>, joiner = "\n\n") => Array.from(parts).filter(Boolean).join(joiner);

export type UnionKeys<T> = T extends unknown ? keyof T : never;

type AddOptionalKeys<K extends PropertyKey> = { [P in K]?: never };

export type Deunionise<B extends object | undefined, T = B> = Simplify<
	T extends object ? T & AddOptionalKeys<Exclude<UnionKeys<B>, keyof T>> : T
>;

export type Simplify<T> = {
	[KeyType in keyof T]: T[KeyType];
} & {};
