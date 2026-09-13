/**
 * A miniature content pack, small enough to audit by hand.
 *
 * These are test fixtures, not published content. The real entries are read off
 * rendered pages and carry citations; these are invented on purpose, wording and
 * all, so that this repository — which is public — carries no book text. What
 * matters here is the shape and the numbers, and those are the real ones, so the
 * expected values in the golden corpus can be checked against the 2014 rules.
 */

import type {
  BackgroundEntry,
  ClassEntry,
  FeatEntry,
  ItemEntry,
  OptionEntry,
  RaceEntry,
  SubclassEntry,
} from '../src/types.ts';

const PHB = (page: number) => ({ book: 'PHB', page });

// ---------------------------------------------------------------------------
// Classes — features only; every rule lives in the engine's CLASS_RULES table
// ---------------------------------------------------------------------------

export const fighter: ClassEntry = {
  id: 'fighter',
  name: 'Fighter',
  summary: 'Fixture: the fighter, with a skill list, a fighting style and an archetype.',
  source: PHB(70),
  features: [
    { id: 'fighter-proficiencies', name: 'Proficiencies', level: 1, summary: 'Fixture: all armour, shields, simple and martial weapons.', effects: [
      { shape: 'proficiency.grant', kind: 'armor', ids: ['light', 'medium', 'heavy', 'shield'] },
      { shape: 'proficiency.grant', kind: 'weapon', ids: ['simple', 'martial'] },
    ] },
    { id: 'fighter-skills', name: 'Skills', level: 1, summary: 'Fixture: choose two from the fighter\'s list.', effects: [
      { shape: 'choice.offer', pool: 'skill:fighter', label: 'Skills', count: 2,
        from: ['acrobatics', 'animal-handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'],
        grants: [{ shape: 'proficiency.grant' }] },
    ] },
    { id: 'fighter-fighting-style', name: 'Fighting Style', level: 1, summary: 'Fixture: choose one option from a pool.', effects: [
      { shape: 'choice.offer', pool: 'fighting-style', label: 'Fighting Style', count: 1, from: null, grants: [] },
    ] },
    { id: 'fighter-second-wind', name: 'Second Wind', level: 1, summary: 'Fixture: regain hit points as a bonus action, once per rest.', effects: [] },
    { id: 'fighter-action-surge', name: 'Action Surge', level: 2, summary: 'Fixture: take one extra action, once per rest.', effects: [] },
    { id: 'fighter-extra-attack', name: 'Extra Attack', level: 5, summary: 'Fixture: attack twice with the Attack action.', effects: [{ shape: 'attack.count', value: 1 }] },
  ],
};

export const rogue: ClassEntry = {
  id: 'rogue',
  name: 'Rogue',
  summary: 'Fixture: the rogue, whose expertise draws on skills and tools alike.',
  source: PHB(94),
  features: [
    { id: 'rogue-proficiencies', name: 'Proficiencies', level: 1, summary: 'Fixture: light armour, simple weapons, thieves\' tools.', effects: [
      { shape: 'proficiency.grant', kind: 'armor', ids: ['light'] },
      { shape: 'proficiency.grant', kind: 'weapon', ids: ['simple'] },
      { shape: 'proficiency.grant', kind: 'tool', ids: ['thieves-tools'] },
    ] },
    // PHB 96 gates Sneak Attack on the weapon being finesse *or* ranged. That
    // disjunction is what `scope.or` is for: without it the rider had to be
    // declared unscoped, which put it on every weapon the character held.
    { id: 'rogue-sneak-attack', name: 'Sneak Attack', level: 1, summary: 'Fixture: extra damage once per turn, with advantage.', effects: [
      { shape: 'damage.dice', dice: { count: 1, die: 6 }, damageType: 'slashing', label: 'Sneak Attack',
        scope: { kind: 'weapon', or: [{ properties: ['finesse'] }, { ranged: true }] },
        condition: { optional: true, label: 'Sneak Attack' } },
    ] },
    { id: 'rogue-skills', name: 'Skills', level: 1, summary: 'Fixture: choose four from the rogue\'s list.', effects: [
      { shape: 'choice.offer', pool: 'skill:rogue', label: 'Skills', count: 4,
        from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation',
               'perception', 'performance', 'persuasion', 'sleight-of-hand', 'stealth'],
        grants: [{ shape: 'proficiency.grant' }] },
    ] },
    // PHB 96: "choose two of your skill proficiencies, or one of your skill
    // proficiencies and your proficiency with thieves' tools." The pool is what
    // makes the second form expressible, and what makes expertise in a skill
    // the character lacks impossible rather than silently ignored.
    { id: 'rogue-expertise', name: 'Expertise', level: 1, summary: 'Fixture: double the proficiency bonus on two things you are proficient in.', effects: [
      { shape: 'choice.offer', pool: 'proficient:skill+tool', label: 'Expertise', count: 2, from: null,
        grants: [{ shape: 'proficiency.expertise' }] },
    ] },
    // A class's kit: fixed items granted outright, and one choice of pack. The
    // feature is recognised as a starting-equipment feature by the grant it
    // carries, which is what the multiclass rule keys on (ADR-0013).
    { id: 'rogue-equipment', name: 'Equipment', level: 1, summary: 'Fixture: what a rogue starts with, in addition to their background.', effects: [
      { shape: 'inventory.grant', items: [
        { item: 'leather', quantity: 1 },
        { item: 'dagger', quantity: 2 },
        { item: 'thieves-tools', quantity: 1 },
      ] },
      { shape: 'choice.offer', pool: 'starting-equipment:rogue:pack', label: 'Pack', count: 1, from: null, grants: [] },
    ] },
  ],
};

export const barbarian: ClassEntry = {
  id: 'barbarian',
  name: 'Barbarian',
  summary: 'Fixture: the barbarian, with unarmoured defence and rage.',
  source: PHB(46),
  features: [
    { id: 'barbarian-proficiencies', name: 'Proficiencies', level: 1, summary: 'Fixture: light and medium armour, shields, simple and martial weapons.', effects: [
      { shape: 'proficiency.grant', kind: 'armor', ids: ['light', 'medium', 'shield'] },
      { shape: 'proficiency.grant', kind: 'weapon', ids: ['simple', 'martial'] },
    ] },
    { id: 'barbarian-unarmored-defense', name: 'Unarmored Defense', level: 1, summary: 'Fixture: unarmoured AC is 10 + DEX + CON, and a shield is allowed.', effects: [
      { shape: 'ac.formula', label: 'Unarmored Defense', base: 10, abilities: ['dex', 'con'], allowShield: true, requiresNoArmor: true, requiresNoShield: false },
    ] },
    { id: 'barbarian-rage', name: 'Rage', level: 1, summary: 'Fixture: bonus damage on melee attacks while raging.', effects: [
      { shape: 'damage.bonus', amount: 2, scope: { kind: 'weapon', melee: true }, condition: { optional: true, label: 'Raging' } },
    ] },
  ],
};

export const monk: ClassEntry = {
  id: 'monk',
  name: 'Monk',
  summary: 'Fixture: the monk, for a second unarmoured AC formula.',
  source: PHB(76),
  features: [
    { id: 'monk-proficiencies', name: 'Proficiencies', level: 1, summary: 'Fixture: simple weapons and shortswords.', effects: [
      { shape: 'proficiency.grant', kind: 'weapon', ids: ['simple'] },
    ] },
    { id: 'monk-unarmored-defense', name: 'Unarmored Defense', level: 1, summary: 'Fixture: unarmoured AC with no shield is 10 + DEX + WIS.', effects: [
      { shape: 'ac.formula', label: 'Unarmored Defense', base: 10, abilities: ['dex', 'wis'], allowShield: false, requiresNoArmor: true, requiresNoShield: true },
    ] },
    { id: 'monk-martial-arts', name: 'Martial Arts', level: 1, summary: 'Fixture: unarmed strikes use a d4.', effects: [
      { shape: 'unarmed.die', die: 4 },
    ] },
  ],
};

export const bard: ClassEntry = {
  id: 'bard',
  name: 'Bard',
  summary: 'Fixture: the bard, for half proficiency on everything.',
  source: PHB(51),
  features: [
    { id: 'bard-jack-of-all-trades', name: 'Jack of All Trades', level: 2, summary: 'Fixture: half proficiency, rounded down, on checks you are not proficient in.', effects: [
      { shape: 'proficiency.half', kind: 'skill', round: 'down' },
    ] },
  ],
};

export const wizard: ClassEntry = { id: 'wizard', name: 'Wizard', summary: 'Fixture: a full caster with no features of its own.', source: PHB(112), features: [] };
export const paladin: ClassEntry = { id: 'paladin', name: 'Paladin', summary: 'Fixture: a half caster, for the multiclass table.', source: PHB(82), features: [] };
export const warlock: ClassEntry = { id: 'warlock', name: 'Warlock', summary: 'Fixture: a pact caster, so Pact Magic has a user.', source: PHB(105), features: [] };
export const cleric: ClassEntry = { id: 'cleric', name: 'Cleric', summary: 'Fixture: a class nothing else in the corpus uses.', source: PHB(56), features: [] };

// ---------------------------------------------------------------------------
// Subclasses — the one pool member that carries features rather than effects
// ---------------------------------------------------------------------------

export const champion: SubclassEntry = {
  id: 'champion',
  name: 'Champion',
  summary: 'Fixture: the champion, whose crit range and second fighting style are both testable.',
  class: 'fighter',
  features: [
    { id: 'champion-improved-critical', name: 'Improved Critical', level: 3, summary: 'Fixture: weapon attacks crit on 19 or 20.', effects: [
      { shape: 'attack.crit-range', minimum: 19 },
    ] },
    // PHB 72 says "round up" where Jack of All Trades says "round down", and
    // the scope is the three physical abilities.
    { id: 'champion-remarkable-athlete', name: 'Remarkable Athlete', level: 7, summary: 'Fixture: half proficiency, rounded up, on physical ability checks that do not already use it.', effects: [
      { shape: 'proficiency.half', kind: 'skill', round: 'up', scope: { kind: 'check', abilities: ['str', 'dex', 'con'] } },
    ] },
    { id: 'champion-additional-fighting-style', name: 'Additional Fighting Style', level: 10, summary: 'Fixture: a second offer of the same pool.', effects: [
      { shape: 'choice.offer', pool: 'fighting-style', label: 'Fighting Style', count: 1, from: null, grants: [] },
    ] },
  ],
};

// ---------------------------------------------------------------------------
// Options — pool members that carry their own effects
// ---------------------------------------------------------------------------

export const archery: OptionEntry = {
  id: 'fighting-style-archery', name: 'Archery', pool: 'fighting-style',
  summary: 'Fixture: +2 to attack rolls with ranged weapons.',
  prerequisites: [],
  effects: [{ shape: 'attack.bonus', amount: 2, scope: { kind: 'weapon', ranged: true } }],
};

export const defense: OptionEntry = {
  id: 'fighting-style-defense', name: 'Defense', pool: 'fighting-style',
  summary: 'Fixture: +1 to AC.',
  prerequisites: [],
  effects: [{ shape: 'ac.bonus', amount: 1 }],
};

/** One gated by level, one by another feature, so prerequisites can be tested. */
export const agonizingBlast: OptionEntry = {
  id: 'invocation-agonizing-blast', name: 'Agonizing Blast', pool: 'invocation',
  summary: 'Fixture: a prerequisite gated on level.',
  prerequisites: ['totalLevel >= 5'],
  effects: [{ shape: 'damage.bonus', amount: 2, scope: { kind: 'weapon', ranged: true } }],
};

export const eldritchSpear: OptionEntry = {
  id: 'invocation-eldritch-spear', name: 'Eldritch Spear', pool: 'invocation',
  summary: 'Fixture: a prerequisite gated on another feature.',
  prerequisites: ['hasFeature("fighter-extra-attack")'],
  effects: [],
};

/**
 * The trap: "extra-attack" is Extra Attack's *name*, not its id, and
 * `hasFeature()` resolves ids. This prerequisite can never be met, which is
 * exactly what a pack author would not notice.
 */
export const burglarPack: OptionEntry = {
  id: 'rogue-pack-burglar', name: "Burglar's Pack", pool: 'starting-equipment:rogue:pack',
  summary: 'Fixture: a pack of thieving kit.',
  prerequisites: [],
  effects: [{ shape: 'inventory.grant', items: [{ item: 'burglars-pack', quantity: 1 }] }],
};

export const explorerPack: OptionEntry = {
  id: 'rogue-pack-explorer', name: "Explorer's Pack", pool: 'starting-equipment:rogue:pack',
  summary: 'Fixture: a pack for the wild.',
  prerequisites: [],
  effects: [{ shape: 'inventory.grant', items: [{ item: 'explorers-pack', quantity: 1 }] }],
};

/** Grants something no pack defines, which a pack must never do. */
export const brokenPack: OptionEntry = {
  id: 'rogue-pack-missing', name: 'Missing Pack', pool: 'starting-equipment:rogue:pack',
  summary: 'Fixture: grants an item nobody authored.',
  prerequisites: [],
  effects: [{ shape: 'inventory.grant', items: [{ item: 'no-such-item', quantity: 1 }] }],
};

/**
 * The trap: "extra-attack" is Extra Attack's *name*, not its id, and
 * `hasFeature()` resolves ids. This prerequisite can never be met, which is
 * exactly what a pack author would not notice.
 */
export const nameTrap: OptionEntry = {
  id: 'invocation-name-trap', name: 'Name Trap', pool: 'invocation',
  summary: 'Fixture: a prerequisite written against a display name.',
  prerequisites: ['hasFeature("extra-attack")'],
  effects: [],
};

// ---------------------------------------------------------------------------
// Race, background, feat
// ---------------------------------------------------------------------------

export const human: RaceEntry = {
  id: 'human',
  name: 'Human',
  summary: 'Fixture: every ability score increases by 1.',
  abilityIncreases: [
    { ability: 'str', amount: 1 }, { ability: 'dex', amount: 1 }, { ability: 'con', amount: 1 },
    { ability: 'int', amount: 1 }, { ability: 'wis', amount: 1 }, { ability: 'cha', amount: 1 },
  ],
  effects: [],
};

export const soldier: BackgroundEntry = {
  id: 'soldier',
  name: 'Soldier',
  summary: 'Fixture: proficiency in Athletics and Intimidation.',
  effects: [
    { shape: 'proficiency.grant', kind: 'skill', ids: ['athletics', 'intimidation'] },
  ],
};

export const tough: FeatEntry = {
  id: 'tough',
  name: 'Tough',
  summary: 'Fixture: two hit points per level, on every level.',
  effects: [{ shape: 'hp.per-level', amount: 2 }],
};

/** A feat that raises a score, which is what makes collection order matter. */
export const tavernBrawler: FeatEntry = {
  id: 'tavern-brawler',
  name: 'Tavern Brawler',
  summary: 'Fixture: raises Strength by 1.',
  effects: [{ shape: 'ability.increase', ability: 'str', amount: 1 }],
};

export const grappler: FeatEntry = {
  id: 'grappler',
  name: 'Grappler',
  summary: 'Fixture: a feat with no effects at all, so a feat may compute nothing.',
  effects: [],
};

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
  id, name, summary: '', weight: 3, armor: null, requiresAttunement: false, effects: [],
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
  /** The Armor table's Strength column (PHB 145), and its Stealth column. */
  extra: { strength?: number | null; stealthDisadvantage?: boolean } = {},
): ItemEntry => ({
  id, name, summary: '', weight: 10, weapon: null, requiresAttunement: false, effects: [],
  armor: {
    kind, baseAc, maxDex,
    strength: extra.strength ?? null,
    stealthDisadvantage: extra.stealthDisadvantage ?? false,
  },
});

export const longsword = weapon('longsword', 'Longsword', 'martial', { count: 1, die: 8 }, 'slashing', [], { versatile: { count: 1, die: 10 } });
export const greataxe = weapon('greataxe', 'Greataxe', 'martial', { count: 1, die: 12 }, 'slashing', [], {});
export const dagger = weapon('dagger', 'Dagger', 'simple', { count: 1, die: 4 }, 'piercing', ['finesse', 'light'], {});
export const shortbow = weapon('shortbow', 'Shortbow', 'simple', { count: 1, die: 6 }, 'piercing', [], { ranged: true });

/** A magic weapon: its bonuses belong to it, not to whatever else is held. */
export const longswordPlus1: ItemEntry = {
  ...weapon('longsword-plus-1', 'Longsword +1', 'martial', { count: 1, die: 8 }, 'slashing', [], { versatile: { count: 1, die: 10 } }),
  summary: 'Fixture: a magic weapon, whose bonus belongs to it alone.',
  effects: [{ shape: 'attack.bonus', amount: 1 }, { shape: 'damage.bonus', amount: 1 }],
};

/** A worn item with an effect that is *not* a weapon line, so it stays global. */
export const cloakOfProtection: ItemEntry = {
  id: 'cloak-of-protection', name: 'Cloak of Protection',
  summary: 'Fixture: +1 to AC, and it requires attunement.',
  weight: 1,
  armor: null, weapon: null, requiresAttunement: true,
  effects: [{ shape: 'ac.bonus', amount: 1 }],
};

// The Strength and Stealth columns are the Armor table's own (PHB 145): chain
// mail needs Str 13 and is noisy, scale mail is only noisy, and the light suits
// print a dash in both.
export const chainMail = armour('chain-mail', 'Chain Mail', 'heavy', 16, 0, { strength: 13, stealthDisadvantage: true });
export const plateArmor = armour('plate', 'Plate', 'heavy', 18, 0, { strength: 15, stealthDisadvantage: true });
export const scaleMail = armour('scale-mail', 'Scale Mail', 'medium', 14, 2, { stealthDisadvantage: true });
export const studdedLeather = armour('studded-leather', 'Studded Leather', 'light', 12, null);
export const leatherArmor = armour('leather', 'Leather Armor', 'light', 11, null);
export const shield = armour('shield', 'Shield', 'shield', 2, 0);

/** Gear that is neither weapon nor armour, so the starting kits have somewhere to land. */
const gear = (id: string, name: string): ItemEntry => ({
  id, name, summary: 'Fixture: ordinary gear.', weight: 1, armor: null, weapon: null,
  requiresAttunement: false, effects: [],
});

export const thievesTools = gear('thieves-tools', "Thieves' Tools");
export const burglarsPack = gear('burglars-pack', "Burglar's Pack");
export const explorersPack = gear('explorers-pack', "Explorer's Pack");

export const ALL_CLASSES = [fighter, rogue, barbarian, monk, bard, wizard, paladin, warlock, cleric];
export const ALL_SUBCLASSES = [champion];
export const ALL_OPTIONS = [archery, defense, agonizingBlast, eldritchSpear, nameTrap, burglarPack, explorerPack];
export const ALL_ITEMS = [longsword, longswordPlus1, greataxe, dagger, shortbow, cloakOfProtection, chainMail, plateArmor, scaleMail, studdedLeather, leatherArmor, shield, thievesTools, burglarsPack, explorersPack];
export const ALL_FEATS = [tough, tavernBrawler, grappler];
