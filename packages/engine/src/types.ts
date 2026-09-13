/**
 * Domain types for the character definition and the derived sheet.
 *
 * The central rule: a CharacterDefinition holds *inputs only*. Nothing the
 * rules compute is ever stored. A derived sheet is produced from a definition
 * by `derive()` and never written back, which is what makes a stale number
 * after a level-up structurally impossible rather than a bug to hunt.
 */

/** The six ability scores. */
export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export const ABILITY_NAMES: Readonly<Record<Ability, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

export type AbilityScores = Readonly<Record<Ability, number>>;

/** The 18 skills, and the ability each is governed by. */
export type SkillId =
  | 'acrobatics'
  | 'animal-handling'
  | 'arcana'
  | 'athletics'
  | 'deception'
  | 'history'
  | 'insight'
  | 'intimidation'
  | 'investigation'
  | 'medicine'
  | 'nature'
  | 'perception'
  | 'performance'
  | 'persuasion'
  | 'religion'
  | 'sleight-of-hand'
  | 'stealth'
  | 'survival';

export type DamageType =
  | 'acid' | 'bludgeoning' | 'cold' | 'fire' | 'force' | 'lightning'
  | 'necrotic' | 'piercing' | 'poison' | 'psychic' | 'radiant'
  | 'slashing' | 'thunder';

export const DAMAGE_TYPES: readonly DamageType[] = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
  'necrotic', 'piercing', 'poison', 'psychic', 'radiant',
  'slashing', 'thunder',
];

// ---------------------------------------------------------------------------
// Character definition — inputs only
// ---------------------------------------------------------------------------

/** A reference to a content pack the character was built against. */
export interface PackRef {
  readonly id: string;
  readonly version: string;
}

/**
 * One level taken, in the order it was taken.
 *
 * The ordered list is load-bearing: total character level is its length, class
 * level is the count of that class, and multiclass entry order falls out of
 * position — which decides whether a class grants its full level-1
 * proficiencies or the reduced multiclass set.
 */
export interface LevelEntry {
  readonly class: string;
  /**
   * Hit points for this level. Ignored at character level 1, which always
   * takes the maximum of the hit die.
   */
  readonly hp: HitPointRoll;
  /**
   * Choices made at this level: ASI-or-feat, and every "choose N from a list"
   * — a subclass, a skill list, expertise, a fighting style. See `LevelChoice`
   * and `choice.offer`.
   */
  readonly choices: readonly LevelChoice[];
}

export type HitPointRoll =
  | { readonly mode: 'average' }
  | { readonly mode: 'rolled'; readonly value: number };

/**
 * A choice made at a level. A discriminated union rather than a loose
 * kind/value pair, so an ASI cannot be silently mistyped into a no-op.
 *
 * `select` is every "choose N from a list" — subclass selection, a class's
 * skill list, expertise, a fighting style. Which pools are available, and how
 * many picks each allows, is computed from the character's own features rather
 * than stored here, so a pick can never be entitled to something the character
 * has not reached the level for.
 */
export type LevelChoice =
  | { readonly kind: 'asi'; readonly increases: readonly AbilityIncrease[] }
  | { readonly kind: 'feat'; readonly feat: string }
  | { readonly kind: 'select'; readonly pool: string; readonly picks: readonly string[] }
  | { readonly kind: 'other'; readonly id: string; readonly value: string };

export interface InventoryItem {
  readonly item: string;
  readonly quantity: number;
  readonly equipped: boolean;
  readonly attuned: boolean;
  /** A player-authored item, carried inline so it travels with the export. */
  readonly custom: CustomItem | null;
}

export interface Currency {
  readonly cp: number;
  readonly sp: number;
  readonly ep: number;
  readonly gp: number;
  readonly pp: number;
}

export const EMPTY_CURRENCY: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

export interface CharacterDefinition {
  /** Pinned to the 2014 rules. The engine refuses any other value. */
  readonly ruleset: '2014';
  readonly packs: readonly PackRef[];
  readonly name: string;
  readonly abilities: AbilityScores;
  readonly levels: readonly LevelEntry[];
  readonly race: string | null;
  readonly subrace: string | null;
  readonly background: string | null;
  readonly inventory: readonly InventoryItem[];
  readonly currency: Currency;
}

// ---------------------------------------------------------------------------
// Player-authored content
// ---------------------------------------------------------------------------

/**
 * A custom item. Uses the same effect shapes as a pack item, so it flows into
 * the computed attack and damage lines through exactly the same code path.
 */
export interface CustomItem {
  readonly id: string;
  readonly name: string;
  readonly tier: 'custom';
  /** A pack item id supplying the mundane statistics. Null for a trinket. */
  readonly base: string | null;
  readonly effects: readonly Effect[];
}

// ---------------------------------------------------------------------------
// Content entries — what a pack provides
// ---------------------------------------------------------------------------

export interface Source {
  readonly book: string;
  readonly page: number;
}

/**
 * A class entry carries only its *features*. Hit die, saving throws, ASI
 * levels, subclass level and spellcasting progression are rules of the game and
 * live in the engine's verified CLASS_RULES table, so a pack cannot get them
 * wrong and there is one place to audit them.
 */
export interface ClassEntry {
  readonly id: string;
  readonly name: string;
  readonly source: Source;
  readonly features: readonly FeatureEntry[];
}

/**
 * A subclass is a pool member too — the pool is `subclass:<classId>`, resolved
 * from this `class` field. It differs from an `OptionEntry` in carrying
 * *features*, which arrive level by level, rather than flat effects.
 */
export interface SubclassEntry {
  readonly id: string;
  readonly name: string;
  readonly class: string;
  readonly features: readonly FeatureEntry[];
}

/**
 * One option in a pool: a fighting style, a manoeuvre, an eldritch invocation,
 * a metamagic, a pact boon.
 *
 * Membership is the `pool` tag rather than a list held somewhere else, so
 * adding an option is one file and nothing to keep in sync. The weakness of a
 * tag — a typo silently offering an empty list — is closed by the entitlement
 * check in `derive`, which diagnoses an offer with no members.
 */
export interface OptionEntry {
  readonly id: string;
  readonly name: string;
  readonly pool: string;
  readonly summary: string;
  /** Expressions over the character. An unmet one is a diagnostic. */
  readonly prerequisites: readonly string[];
  readonly effects: readonly Effect[];
}

export interface SpellcastingProfile {
  readonly ability: Ability;
  readonly progression: 'full' | 'half' | 'third' | 'pact';
  readonly preparation: 'prepared' | 'known';
}

export interface FeatureEntry {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly summary: string;
  readonly effects: readonly Effect[];
}

export interface RaceEntry {
  readonly id: string;
  readonly name: string;
  readonly abilityIncreases: readonly AbilityIncrease[];
  readonly effects: readonly Effect[];
}

export interface BackgroundEntry {
  readonly id: string;
  readonly name: string;
  readonly effects: readonly Effect[];
}

export interface FeatEntry {
  readonly id: string;
  readonly name: string;
  readonly effects: readonly Effect[];
}

export interface AbilityIncrease {
  readonly ability: Ability;
  readonly amount: number;
}

export interface ArmorEntry {
  readonly kind: 'light' | 'medium' | 'heavy' | 'shield';
  readonly baseAc: number;
  /** Maximum DEX modifier the armour allows. Null when uncapped. */
  readonly maxDex: number | null;
}

export interface ItemEntry {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly armor: ArmorEntry | null;
  readonly weapon: WeaponEntry | null;
  readonly requiresAttunement: boolean;
  readonly effects: readonly Effect[];
}

export interface WeaponEntry {
  /** Proficiency is granted by category, or by naming the weapon itself. */
  readonly category: 'simple' | 'martial';
  readonly damage: Dice;
  readonly versatile: Dice | null;
  readonly damageType: DamageType;
  readonly melee: boolean;
  readonly ranged: boolean;
  readonly properties: readonly string[];
}

/**
 * A dice pool, as content writes it.
 *
 * `count` may be an **expression string** where the pool grows with level:
 * Sneak Attack is 1d6 at 1st and 10d6 at 19th, on one feature, and the rogue's
 * table is the only thing that says so. A number is the common case and stays a
 * number; see `DerivedDice` for the resolved side.
 */
export interface Dice {
  readonly count: number | string;
  readonly die: number;
}

/** A dice pool after evaluation: what a sheet actually rolls. */
export interface DerivedDice {
  readonly count: number;
  readonly die: number;
}

// ---------------------------------------------------------------------------
// Effects — the closed catalogue of shapes
// ---------------------------------------------------------------------------

/**
 * A scope narrows which attacks or checks an effect touches. A declarative
 * filter, never a predicate function: content stays data.
 *
 * A scope's own constraints are **conjunctive** — every one stated must hold —
 * and `or` adds a disjunction on top. Sneak Attack is why: "the attack must use
 * a finesse or a ranged weapon" is a weapon, and then one of two things.
 */
export interface Scope {
  readonly kind?: 'weapon' | 'check' | 'save';
  /**
   * This exact item, by id. A magic weapon's bonus belongs to that weapon and
   * not to whatever else the character is holding, which is why the engine
   * scopes an item's own attack and damage effects to it unless the content
   * says otherwise.
   */
  readonly id?: string;
  readonly melee?: boolean;
  readonly ranged?: boolean;
  readonly properties?: readonly string[];
  readonly skills?: readonly SkillId[];
  readonly abilities?: readonly Ability[];
  /** Matches when any one of these matches. Each is itself a conjunction. */
  readonly or?: readonly Scope[];
}

export interface Condition {
  /** The effect applies only if the player opts in at the table. */
  readonly optional: boolean;
  readonly label: string;
}

export type Effect = EffectShape & {
  readonly scope?: Scope;
  readonly condition?: Condition;
};

/**
 * The closed catalogue. Every shape the engine understands, and nothing else:
 * a feature that fits no shape is `feature.text` and computes nothing.
 */
export type EffectShape =
  | { readonly shape: 'ability.increase'; readonly ability: Ability; readonly amount: number }
  | { readonly shape: 'proficiency.grant'; readonly kind: 'skill' | 'save' | 'tool' | 'armor' | 'weapon'; readonly ids: readonly string[] }
  | { readonly shape: 'proficiency.expertise'; readonly kind: 'skill' | 'tool'; readonly ids: readonly string[] }
  | { readonly shape: 'proficiency.half'; readonly kind: 'skill'; readonly round: 'up' | 'down' }
  | { readonly shape: 'check.floor'; readonly value: number }
  | { readonly shape: 'check.advantage' }
  | { readonly shape: 'ac.formula'; readonly label: string; readonly base: number; readonly abilities: readonly Ability[]; readonly allowShield: boolean; readonly requiresNoArmor: boolean; readonly requiresNoShield: boolean }
  | { readonly shape: 'ac.bonus'; readonly amount: number }
  | { readonly shape: 'hp.per-level'; readonly amount: number }
  | { readonly shape: 'hp.flat'; readonly amount: number }
  | { readonly shape: 'speed.set'; readonly amount: number }
  | { readonly shape: 'speed.bonus'; readonly amount: number }
  | { readonly shape: 'attack.bonus'; readonly amount: number }
  | { readonly shape: 'damage.bonus'; readonly amount: number }
  | { readonly shape: 'damage.dice'; readonly dice: Dice; readonly damageType: DamageType; readonly label: string }
  | { readonly shape: 'attack.count'; readonly value: number }
  | { readonly shape: 'attack.crit-range'; readonly minimum: number }
  | { readonly shape: 'unarmed.die'; readonly die: number }
  | { readonly shape: 'spellcasting.grant'; readonly classId: string; readonly ability: Ability; readonly progression: 'full' | 'half' | 'third' | 'pact'; readonly preparation: 'prepared' | 'known' }
  | { readonly shape: 'spell.dc.bonus'; readonly amount: number }
  | { readonly shape: 'initiative.bonus'; readonly amount: number }
  | { readonly shape: 'resource.pool'; readonly id: string; readonly max: string; readonly recharge: 'short' | 'long' }
  | { readonly shape: 'choice.offer'; readonly pool: string; readonly label: string; readonly count: number; readonly from: readonly string[] | null; readonly grants: readonly ChoiceGrant[] };
  // Note: there is deliberately no `feature.text` shape. Every FeatureEntry
  // already carries a name, a level and a summary, and the derivation pass
  // surfaces those as notes. A separate text shape would duplicate that.

/**
 * What a pick from a *built-in* pool confers — a skill list grants
 * proficiency, Expertise grants expertise in what it picks.
 *
 * Only the id-taking shapes appear here, because the picks supply the ids: a
 * pick from `skill` is a bare `stealth`, which has no entry of its own to carry
 * effects. A pick from a pool of entries applies the entry's own effects
 * instead, and an offer declaring `grants` there is a diagnostic.
 *
 * `ids` is absent by design — it is the picks. `kind` is absent too, because a
 * pool may span kinds: PHB 96 lets a rogue take Expertise in a skill *or* in
 * thieves' tools, and the member knows which it is.
 */
export type ChoiceGrant =
  | { readonly shape: 'proficiency.grant' }
  | { readonly shape: 'proficiency.expertise' };

export type EffectShapeId = EffectShape['shape'];

/**
 * The same catalogue, at runtime, for anything that has to *check* content
 * rather than compile against it — the pack loader, above all.
 *
 * A `Record` keyed by the union's members rather than an array, so adding a
 * shape to `EffectShape` and forgetting it here is a type error. An array would
 * drift, and drift here means a pack's effects are silently ignored.
 */
export const EFFECT_SHAPES: Readonly<Record<EffectShapeId, true>> = {
  'ability.increase': true,
  'proficiency.grant': true,
  'proficiency.expertise': true,
  'proficiency.half': true,
  'check.floor': true,
  'check.advantage': true,
  'ac.formula': true,
  'ac.bonus': true,
  'hp.per-level': true,
  'hp.flat': true,
  'speed.set': true,
  'speed.bonus': true,
  'attack.bonus': true,
  'damage.bonus': true,
  'damage.dice': true,
  'attack.count': true,
  'attack.crit-range': true,
  'unarmed.die': true,
  'spellcasting.grant': true,
  'spell.dc.bonus': true,
  'initiative.bonus': true,
  'resource.pool': true,
  'choice.offer': true,
};

export const EFFECT_SHAPE_IDS: readonly EffectShapeId[] = Object.keys(EFFECT_SHAPES) as readonly EffectShapeId[];

// ---------------------------------------------------------------------------
// Derived sheet — computed, never stored
// ---------------------------------------------------------------------------

export interface DerivedAbility {
  readonly id: Ability;
  readonly score: number;
  readonly modifier: number;
}

export interface DerivedSkill {
  readonly id: SkillId;
  readonly ability: Ability;
  readonly proficient: boolean;
  readonly expertise: boolean;
  readonly halfProficiency: boolean;
  readonly bonus: number;
}

export interface DerivedSave {
  readonly ability: Ability;
  readonly proficient: boolean;
  readonly bonus: number;
}

export interface DerivedDamageComponent {
  readonly dice: DerivedDice | null;
  readonly flat: number;
  readonly damageType: DamageType;
  readonly label: string | null;
  readonly conditional: boolean;
}

export interface DerivedAttack {
  readonly name: string;
  readonly ability: Ability;
  readonly toHit: number;
  readonly damage: readonly DerivedDamageComponent[];
  readonly notes: readonly string[];
}

/** A feature the sheet cannot compute, surfaced as text. */
export interface DerivedNote {
  readonly name: string;
  readonly level: number;
  readonly summary: string;
}

export interface DerivedSpellcasting {
  readonly source: string;
  readonly ability: Ability;
  readonly saveDc: number;
  readonly attackBonus: number;
  readonly slots: readonly number[];
}

export interface DerivedResource {
  readonly id: string;
  readonly max: number;
  readonly recharge: 'short' | 'long';
}

/** One thing taken from a pool, resolved to something displayable. */
export interface DerivedPick {
  readonly id: string;
  readonly name: string;
  readonly pool: string;
  /**
   * The entry's own summary, so a player can read what a fighting style or an
   * invocation does before choosing it. Empty for a skill or a tool, which have
   * nothing to say.
   */
  readonly summary: string;
}

/**
 * A pool the character's features offer, and what has been taken from it.
 *
 * `entitled` is computed from the features the character actually has, which is
 * why a subclass cannot be picked at 1st level on a fighter, and why the UI can
 * show "1 of 2 chosen" without knowing any rules of its own.
 */
export interface DerivedSelection {
  readonly pool: string;
  readonly label: string;
  readonly entitled: number;
  /** Everything the pool offers, so a picker can be rendered without any rules. */
  readonly candidates: readonly DerivedPick[];
  readonly picks: readonly DerivedPick[];
}

/**
 * A place where the character is entitled to an Ability Score Improvement or a
 * feat. It is not a pool — the alternatives are two different kinds of choice —
 * so it is reported separately, and the class table's `asiLevels` remains the
 * only place the rule lives.
 */
export interface DerivedAdvancement {
  /** Index into `definition.levels`, so the UI knows which entry to show it on. */
  readonly level: number;
  readonly classId: string;
  readonly classLevel: number;
  readonly kind: 'asi-or-feat';
  /** True when an ASI or a feat sits on that level entry. */
  readonly taken: boolean;
}

export interface DerivedSheet {
  readonly name: string;
  readonly totalLevel: number;
  readonly classLevels: Readonly<Record<string, number>>;
  readonly proficiencyBonus: number;
  readonly abilities: Readonly<Record<Ability, DerivedAbility>>;
  readonly skills: readonly DerivedSkill[];
  readonly saves: readonly DerivedSave[];
  readonly passive: Readonly<Record<'perception' | 'investigation' | 'insight', number>>;
  readonly armorClass: number;
  readonly armorClassBreakdown: string;
  readonly initiative: number;
  readonly speed: number;
  readonly hitPoints: { readonly maximum: number; readonly breakdown: string };
  /** A floor applied to the d20 on proficient checks (Reliable Talent), or null. */
  readonly checkFloor: number | null;
  /** Diagnostics: content the character references that could not be resolved. */
  readonly diagnostics: readonly string[];
  readonly hitDice: Readonly<Record<string, number>>;
  readonly attacks: readonly DerivedAttack[];
  /** Attacks per Attack action: 1, or 2+ once Extra Attack applies. */
  readonly attacksPerAction: number;
  /** Lowest d20 roll that scores a critical hit: 20, or lower by feature. */
  readonly critRange: number;
  readonly spellcasting: readonly DerivedSpellcasting[];
  readonly resources: readonly DerivedResource[];
  /** Every pool the character was offered, and what was taken from it. */
  readonly selections: readonly DerivedSelection[];
  /** Every level entry that grants an ASI-or-feat, and whether it was spent. */
  readonly advancements: readonly DerivedAdvancement[];
  /** Things the sheet cannot compute, shown as text. */
  readonly notes: readonly DerivedNote[];
}
