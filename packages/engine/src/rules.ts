/**
 * Rules of the game (D&D 5e, 2014).
 *
 * Everything here is a property of the game rather than of a book entry, so it
 * lives in code and not in content: proficiency bonus by total level, the skill
 * list, the multiclass caster formula, the armour categories' DEX behaviour,
 * the ASI cap, and the class tables.
 *
 * The class tables are verified against the 2014 SRD (2026-09-13). The ASI
 * levels in particular are declared as explicit per-class lists rather than a
 * cumulative count, because the community SRD dataset's cumulative column is
 * wrong for the rogue from level 11 on.
 */

import type { Ability, Dice, SkillId } from './types.ts';

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

/** `floor((score - 10) / 2)`, the only formula for an ability modifier. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** The highest score an ability can reach by ordinary advancement. */
export const ABILITY_CAP = 20;

// ---------------------------------------------------------------------------
// Proficiency
// ---------------------------------------------------------------------------

/**
 * Proficiency bonus by **total character level**, not class level: +2 at 1-4,
 * +3 at 5-8, +4 at 9-12, +5 at 13-16, +6 at 17-20.
 */
export function proficiencyBonus(totalLevel: number): number {
  const level = Math.max(1, Math.min(20, Math.floor(totalLevel)));
  return 2 + Math.floor((level - 1) / 4);
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/** The 18 skills and the ability each is governed by. */
export const SKILL_ABILITY: Readonly<Record<SkillId, Ability>> = {
  athletics: 'str',
  acrobatics: 'dex',
  'sleight-of-hand': 'dex',
  stealth: 'dex',
  arcana: 'int',
  history: 'int',
  investigation: 'int',
  nature: 'int',
  religion: 'int',
  'animal-handling': 'wis',
  insight: 'wis',
  medicine: 'wis',
  perception: 'wis',
  survival: 'wis',
  deception: 'cha',
  intimidation: 'cha',
  performance: 'cha',
  persuasion: 'cha',
};

export const SKILL_IDS = Object.keys(SKILL_ABILITY) as readonly SkillId[];

export const SKILL_NAMES: Readonly<Record<SkillId, string>> = {
  athletics: 'Athletics',
  acrobatics: 'Acrobatics',
  'sleight-of-hand': 'Sleight of Hand',
  stealth: 'Stealth',
  arcana: 'Arcana',
  history: 'History',
  investigation: 'Investigation',
  nature: 'Nature',
  religion: 'Religion',
  'animal-handling': 'Animal Handling',
  insight: 'Insight',
  medicine: 'Medicine',
  perception: 'Perception',
  survival: 'Survival',
  deception: 'Deception',
  intimidation: 'Intimidation',
  performance: 'Performance',
  persuasion: 'Persuasion',
};

/** A passive score is `10 + the modifier the check would use`. */
export const PASSIVE_BASE = 10;

/** Advantage on a check adds 5 to the passive score; disadvantage subtracts 5. */
export const PASSIVE_ADVANTAGE_BONUS = 5;

// ---------------------------------------------------------------------------
// Hit points
// ---------------------------------------------------------------------------

/**
 * The fixed hit point value for a hit die: `floor(die / 2) + 1`, so d6→4,
 * d8→5, d10→6, d12→7.
 */
export function averageHitPoints(hitDie: number): number {
  return Math.floor(hitDie / 2) + 1;
}

// ---------------------------------------------------------------------------
// Class tables — verified against the 2014 SRD
// ---------------------------------------------------------------------------

export interface ClassRules {
  readonly hitDie: number;
  readonly savingThrows: readonly Ability[];
  /** Levels at which an Ability Score Improvement is granted, by class level. */
  readonly asiLevels: readonly number[];
  /** The class level at which a subclass is chosen. Not 3 for every class. */
  readonly subclassLevel: number;
  readonly spellcasting: 'full' | 'half' | 'third' | 'pact' | null;
  /** The ability this class casts with. Null when the class does not cast. */
  readonly spellcastingAbility: Ability | null;
  /** Whether the class prepares spells from its list or learns a fixed set. */
  readonly preparation: 'prepared' | 'known' | null;
}

export const CLASS_RULES: Readonly<Record<string, ClassRules>> = {
  barbarian: { hitDie: 12, savingThrows: ['str', 'con'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 3, spellcasting: null, spellcastingAbility: null, preparation: null },
  bard: { hitDie: 8, savingThrows: ['dex', 'cha'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 3, spellcasting: 'full', spellcastingAbility: 'cha', preparation: 'known' },
  cleric: { hitDie: 8, savingThrows: ['wis', 'cha'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 1, spellcasting: 'full', spellcastingAbility: 'wis', preparation: 'prepared' },
  druid: { hitDie: 8, savingThrows: ['int', 'wis'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 2, spellcasting: 'full', spellcastingAbility: 'wis', preparation: 'prepared' },
  fighter: { hitDie: 10, savingThrows: ['str', 'con'], asiLevels: [4, 6, 8, 12, 14, 16, 19], subclassLevel: 3, spellcasting: null, spellcastingAbility: null, preparation: null },
  monk: { hitDie: 8, savingThrows: ['str', 'dex'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 3, spellcasting: null, spellcastingAbility: null, preparation: null },
  paladin: { hitDie: 10, savingThrows: ['wis', 'cha'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 3, spellcasting: 'half', spellcastingAbility: 'cha', preparation: 'prepared' },
  ranger: { hitDie: 10, savingThrows: ['str', 'dex'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 3, spellcasting: 'half', spellcastingAbility: 'wis', preparation: 'known' },
  rogue: { hitDie: 8, savingThrows: ['dex', 'int'], asiLevels: [4, 8, 10, 12, 16, 19], subclassLevel: 3, spellcasting: null, spellcastingAbility: null, preparation: null },
  sorcerer: { hitDie: 6, savingThrows: ['con', 'cha'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 1, spellcasting: 'full', spellcastingAbility: 'cha', preparation: 'known' },
  warlock: { hitDie: 8, savingThrows: ['wis', 'cha'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 1, spellcasting: 'pact', spellcastingAbility: 'cha', preparation: 'known' },
  wizard: { hitDie: 6, savingThrows: ['int', 'wis'], asiLevels: [4, 8, 12, 16, 19], subclassLevel: 2, spellcasting: 'full', spellcastingAbility: 'int', preparation: 'prepared' },
};

export function classRules(classId: string): ClassRules | null {
  return CLASS_RULES[classId] ?? null;
}

/** How many Ability Score Improvements a class has granted by a class level. */
export function asiCount(classId: string, classLevel: number): number {
  const rules = classRules(classId);
  if (rules === null) return 0;
  return rules.asiLevels.filter((l) => l <= classLevel).length;
}

// ---------------------------------------------------------------------------
// Spell slots — verified against the 2014 SRD
// ---------------------------------------------------------------------------

/**
 * Spell slots for a full caster, and also the Multiclass Spellcaster table.
 * In 2014 these are the same table; a single-classed paladin or ranger instead
 * uses HALF_CASTER_SLOTS.
 *
 * Each row lists slots for spell levels 1..9.
 */
const FULL_CASTER_SLOTS: readonly (readonly number[])[] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Paladin and Ranger slots, used when the character has no other caster class. */
const HALF_CASTER_SLOTS: readonly (readonly number[])[] = [
  [],
  [2],
  [3],
  [3],
  [4, 2],
  [4, 2],
  [4, 3],
  [4, 3],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2],
];

/** Warlock Pact Magic: number of slots, and the level of those slots. */
const PACT_MAGIC: readonly (readonly [number, number])[] = [
  [1, 1], [2, 1], [2, 2], [2, 2], [2, 3],
  [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
  [3, 5], [3, 5], [3, 5], [3, 5], [3, 5],
  [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

function pad9(row: readonly number[]): readonly number[] {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < row.length && i < 9; i += 1) out[i] = row[i] ?? 0;
  return out;
}

function rowOf(table: readonly (readonly number[])[], level: number): readonly number[] {
  const clamped = Math.max(1, Math.min(20, Math.floor(level)));
  return pad9(table[clamped - 1] ?? []);
}

export function fullCasterSlots(level: number): readonly number[] {
  return rowOf(FULL_CASTER_SLOTS, level);
}

export function halfCasterSlots(level: number): readonly number[] {
  return rowOf(HALF_CASTER_SLOTS, level);
}

/** Pact Magic slots for a warlock of the given level, as 9 spell-level entries. */
export function pactMagicSlots(level: number): readonly number[] {
  const clamped = Math.max(1, Math.min(20, Math.floor(level)));
  const entry = PACT_MAGIC[clamped - 1] ?? [0, 0];
  const count = entry[0] ?? 0;
  const slotLevel = entry[1] ?? 0;
  const out = new Array<number>(9).fill(0);
  if (slotLevel >= 1 && slotLevel <= 9) out[slotLevel - 1] = count;
  return out;
}

/**
 * The 2014 multiclass spellcaster level: full class levels in full-caster
 * classes, half (rounded down) in paladin and ranger, and a third (rounded
 * down) in fighter and rogue when the third-caster subclass is taken.
 *
 * Pact Magic is deliberately excluded — warlock levels never contribute.
 */
export function multiclassCasterLevel(
  contributors: readonly { readonly progression: 'full' | 'half' | 'third'; readonly level: number }[],
): number {
  let total = 0;
  for (const c of contributors) {
    if (c.progression === 'full') total += c.level;
    else if (c.progression === 'half') total += Math.floor(c.level / 2);
    else total += Math.floor(c.level / 3);
  }
  return total;
}

/** Spell save DC: `8 + proficiency + casting ability modifier`. */
export function spellSaveDc(prof: number, abilityMod: number): number {
  return 8 + prof + abilityMod;
}

/** Spell attack bonus: `proficiency + casting ability modifier`. */
export function spellAttackBonus(prof: number, abilityMod: number): number {
  return prof + abilityMod;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

/** Dice parsed from a weapon's damage, or a player-authored override. */
export function dice(count: number, die: number): Dice {
  return { count, die };
}

/**
 * Which ability a weapon attack uses.
 *
 * Finesse takes the better of Strength and Dexterity; a ranged weapon uses
 * Dexterity; everything else uses Strength.
 */
export function attackAbility(
  weapon: { readonly melee: boolean; readonly ranged: boolean; readonly properties: readonly string[] },
  strMod: number,
  dexMod: number,
): Ability {
  if (weapon.properties.includes('finesse')) return strMod >= dexMod ? 'str' : 'dex';
  if (weapon.ranged && !weapon.melee) return 'dex';
  return 'str';
}
