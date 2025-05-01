export namespace Canonical {
	export enum Kind {
		Base = "base",
		Composite = "composite",
		Domain = "domain",
		Enum = "enum",
		Range = "range",
		Pseudo = "pseudo",
		Unknown = "unknown",
	}

	export interface Abstract {
		original_type: string;
		canonical_name: string;
		schema: string;
		name: string;
		kind: Kind;
		dimensions: number;
		modifiers?: string | null;
	}

	export interface Base extends Abstract {
		kind: Kind.Base;
	}

	export interface Enum extends Abstract {
		kind: Kind.Enum;
		enum_values: string[];
	}

	// Enhanced attribute with additional metadata
	export interface CompositeAttribute {
		name: string;
		index: number;
		type: Canonical;
		comment: string | null;
		defaultValue: any;
		isNullable: boolean;
		/**
		 * Whether the attribute is an identity attribute.
		 */
		isIdentity: boolean;
		/**
		 * Behavior of the generated attribute. "ALWAYS" if always generated,
		 * "NEVER" if never generated, "BY DEFAULT" if generated when a value
		 * is not provided.
		 */
		generated: "ALWAYS" | "NEVER" | "BY DEFAULT";
	}

	export interface Composite extends Abstract {
		kind: Kind.Composite;
		attributes: CompositeAttribute[];
	}

	export interface Domain extends Abstract {
		kind: Kind.Domain;
		domain_base_type: Canonical;
	}

	export interface Range extends Abstract {
		kind: Kind.Range;
		range_subtype: Canonical;
	}

	export interface Pseudo extends Abstract {
		kind: Kind.Pseudo;
	}
}

export type Canonical =
	| Canonical.Base
	| Canonical.Enum
	| Canonical.Composite
	| Canonical.Domain
	| Canonical.Range
	| Canonical.Pseudo;

type Exclusive<T> = Omit<T, Exclude<keyof Canonical.Abstract, "kind" | "canonical_name">>;

export type ExclusiveBase = Exclusive<Canonical.Base>;
export type ExclusiveEnum = Exclusive<Canonical.Enum>;
export type ExclusiveComposite = Exclusive<Canonical.Composite>;
export type ExclusiveDomain = Exclusive<Canonical.Domain>;
export type ExclusiveRange = Exclusive<Canonical.Range>;
export type ExclusivePseudo = Exclusive<Canonical.Pseudo>;

export type ExclusiveCanonProps =
	| ExclusiveBase
	| ExclusiveEnum
	| ExclusiveComposite
	| ExclusiveDomain
	| ExclusiveRange
	| ExclusivePseudo;
