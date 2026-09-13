/**
 * A miniature content pack, small enough to audit by hand.
 *
 * These are test fixtures, not published content: the real entries are read off
 * rendered pages and carry citations. What matters here is the shape and the
 * numbers, so the expected values in the golden corpus can be checked against
 * the 2014 rules by reading them.
 */

import type {
  BackgroundEntry,
  ClassEntry,
  FeatEntry,
  ItemEntry,
  RaceEntry,
} from '../src/types.ts';

const PHB = (page: number) => ({ book: 'PHB', page });

// ---------------------------------------------------------------------------
// Classes — features only; every rule lives in the engine's CLASS_RULES table
// ---------------------------------------------------------------------------

export const fighter: ClassEntry = {
  id: 'fighter',
  name: 'Fighter',
  source: PHB(70),
  features: [
    { id: 'fighter-proficiencies', name: 'Proficiencies', level: 1, summary: 'All armour, shields, simple and martial weapons.', effects: [
      { shape: 'proficiency.grant', kind: 'armor', ids: ['light', 'medium', 'heavy', 'shield'] },
      { shape: 'proficiency.grant', kind: 'weapon', ids: ['simple', 'martial'] },
    ] },
    { id: 'fighter-second-wind', name: 'Second Wind', level: 1, summary: 'Regain hit points as a bonus action once per rest.', effects: [] },
    { id: 'fighter-action-surge', name: 'Action Surge', level: 2, summary: 'Take one additional action once per rest.', effects: [] },
    { id: 'fighter-extra-attack', name: 'Extra Attack', level: 5, summary: 'Attack twice whenever you take the Attack action.', effects: [{ shape: 'attack.count', value: 1 }] },
  ],
};

export const rogue: ClassEntry = {
  id: 'rogue',
  name: 'Rogue',
  source: PHB(94),
  features: [
    { id: 'rogue-proficiencies', name: 'Proficiencies', level: 1, summary: 'Light armour, simple weapons, thieves’ tools.', effects: [
      { shape: 'proficiency.grant', kind: 'armor', ids: ['light'] },
      { shape: 'proficiency.grant', kind: 'weapon', ids: ['simple'] },
    ] },
    // NOTE: Sneak Attack really requires finesse *or* a ranged weapon. The
    // scope filter is conjunctive and cannot express "or", so the rider is
    // declared unscoped and conditional. Recorded as a known limitation.
    { id: 'rogue-sneak-attack', name: 'Sneak Attack', level: 1, summary: 'Once per turn, deal extra damage when you have advantage.', effects: [
      { shape: 'damage.dice', dice: { count: 1, die: 6 }, damageType: 'slashing', label: 'Sneak Attack', condition: { optional: true, label: 'Sneak Attack' } },
    ] },
    { id: 'rogue-skills', name: 'Skills', level: 1, summary: 'Test fixture: the two skills this rogue chose.', effects: [
      { shape: 'proficiency.grant', kind: 'skill', ids: ['stealth', 'sleight-of-hand'] },
    ] },
    { id: 'rogue-expertise', name: 'Expertise', level: 1, summary: 'Double your proficiency bonus for two chosen skills.', effects: [] },
  ],
};

export const barbarian: ClassEntry = {
  id: 'barbarian',
  name: 'Barbarian',
  source: PHB(46),
  features: [
    { id: 'barbarian-proficiencies', name: 'Proficiencies', level: 1, summary: 'Light and medium armour, shields, simple and martial weapons.', effects: [
      { shape: 'proficiency.grant', kind: 'armor', ids: ['light', 'medium', 'shield'] },
      { shape: 'proficiency.grant', kind: 'weapon', ids: ['simple', 'martial'] },
    ] },
    { id: 'barbarian-unarmored-defense', name: 'Unarmored Defense', level: 1, summary: 'While not wearing armour, AC is 10 + DEX + CON. A shield is allowed.', effects: [
      { shape: 'ac.formula', label: 'Unarmored Defense', base: 10, abilities: ['dex', 'con'], allowShield: true, requiresNoArmor: true, requiresNoShield: false },
    ] },
    { id: 'barbarian-rage', name: 'Rage', level: 1, summary: 'Bonus damage on melee Strength attacks while raging.', effects: [
      { shape: 'damage.bonus', amount: 2, scope: { kind: 'weapon', melee: true }, condition: { optional: true, label: 'Raging' } },
    ] },
  ],
};

export const monk: ClassEntry = {
  id: 'monk',
  name: 'Monk',
  source: PHB(76),
  features: [
    { id: 'monk-proficiencies', name: 'Proficiencies', level: 1, summary: 'Simple weapons and shortswords.', effects: [
      { shape: 'proficiency.grant', kind: 'weapon', ids: ['simple'] },
    ] },
    { id: 'monk-unarmored-defense', name: 'Unarmored Defense', level: 1, summary: 'While wearing no armour and using no shield, AC is 10 + DEX + WIS.', effects: [
      { shape: 'ac.formula', label: 'Unarmored Defense', base: 10, abilities: ['dex', 'wis'], allowShield: false, requiresNoArmor: true, requiresNoShield: true },
    ] },
    { id: 'monk-martial-arts', name: 'Martial Arts', level: 1, summary: 'Your unarmed strikes use a d4.', effects: [
      { shape: 'unarmed.die', die: 4 },
    ] },
  ],
};

export const bard: ClassEntry = {
  id: 'bard',
  name: 'Bard',
  source: PHB(51),
  features: [
    { id: 'bard-jack-of-all-trades', name: 'Jack of All Trades', level: 2, summary: 'Add half your proficiency bonus to any ability check you are not proficient in.', effects: [
      { shape: 'proficiency.half', kind: 'skill' },
    ] },
  ],
};

export const wizard: ClassEntry = { id: 'wizard', name: 'Wizard', source: PHB(112), features: [] };
export const paladin: ClassEntry = { id: 'paladin', name: 'Paladin', source: PHB(82), features: [] };
export const warlock: ClassEntry = { id: 'warlock', name: 'Warlock', source: PHB(105), features: [] };
export const cleric: ClassEntry = { id: 'cleric', name: 'Cleric', source: PHB(56), features: [] };

// ---------------------------------------------------------------------------
// Race, background, feat
// ---------------------------------------------------------------------------

export const human: RaceEntry = {
  id: 'human',
  name: 'Human',
  abilityIncreases: [
    { ability: 'str', amount: 1 }, { ability: 'dex', amount: 1 }, { ability: 'con', amount: 1 },
    { ability: 'int', amount: 1 }, { ability: 'wis', amount: 1 }, { ability: 'cha', amount: 1 },
  ],
  effects: [],
};

export const soldier: BackgroundEntry = {
  id: 'soldier',
  name: 'Soldier',
  effects: [
    { shape: 'proficiency.grant', kind: 'skill', ids: ['athletics', 'intimidation'] },
  ],
};

export const tough: FeatEntry = {
  id: 'tough',
  name: 'Tough',
  effects: [{ shape: 'hp.per-level', amount: 2 }],
};

export const grappler: FeatEntry = { id: 'grappler', name: 'Grappler', effects: [] };

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

const weapon = (
  id: string,
  name: string,
  category: 'simple' | 'martial',
  damage: { count: number; die: number },
  damageType: 'slashing' | 'piercing' | 'bludgeoning',
  properties: readonly string[],
  opts: { versatile?: { count: number; die: number }; ranged?: boolean } = {},
): ItemEntry => ({
  id, name, weight: 3, armor: null, requiresAttunement: false, effects: [],
  weapon: {
    category, damage, versatile: opts.versatile ?? null, damageType,
    melee: !opts.ranged, ranged: opts.ranged ?? false, properties,
  },
});

const armour = (
  id: string,
  name: string,
  kind: 'light' | 'medium' | 'heavy' | 'shield',
  baseAc: number,
  maxDex: number | null,
): ItemEntry => ({
  id, name, weight: 10, weapon: null, requiresAttunement: false, effects: [],
  armor: { kind, baseAc, maxDex },
});

export const longsword = weapon('longsword', 'Longsword', 'martial', { count: 1, die: 8 }, 'slashing', [], { versatile: { count: 1, die: 10 } });
export const greataxe = weapon('greataxe', 'Greataxe', 'martial', { count: 1, die: 12 }, 'slashing', [], {});
export const dagger = weapon('dagger', 'Dagger', 'simple', { count: 1, die: 4 }, 'piercing', ['finesse', 'light'], {});
export const shortbow = weapon('shortbow', 'Shortbow', 'simple', { count: 1, die: 6 }, 'piercing', [], { ranged: true });

export const chainMail = armour('chain-mail', 'Chain Mail', 'heavy', 16, 0);
export const scaleMail = armour('scale-mail', 'Scale Mail', 'medium', 14, 2);
export const studdedLeather = armour('studded-leather', 'Studded Leather', 'light', 12, null);
export const leatherArmor = armour('leather', 'Leather Armor', 'light', 11, null);
export const shield = armour('shield', 'Shield', 'shield', 2, 0);

export const ALL_CLASSES = [fighter, rogue, barbarian, monk, bard, wizard, paladin, warlock, cleric];
export const ALL_ITEMS = [longsword, greataxe, dagger, shortbow, chainMail, scaleMail, studdedLeather, leatherArmor, shield];
export const ALL_FEATS = [tough, grappler];
