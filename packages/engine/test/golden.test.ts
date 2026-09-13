/**
 * The golden corpus.
 *
 * Every expected value here is computed by hand from the 2014 rules and written
 * into the test, so the assertion *is* the specification. If the engine and the
 * expectation disagree, one of them is wrong and the disagreement is the point.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inMemoryContent } from '../src/content.ts';
import { derive } from '../src/derive.ts';
import { EMPTY_CURRENCY, type Ability, type DerivedDice, type AbilityScores, type CharacterDefinition, type ClassEntry, type InventoryItem, type LevelChoice, type LevelEntry } from '../src/types.ts';
import { ALL_CLASSES, ALL_FEATS, ALL_ITEMS, ALL_OPTIONS, ALL_SUBCLASSES, fighter, human, rogue, soldier } from './fixtures.ts';

const content = inMemoryContent({
  classes: ALL_CLASSES,
  subclasses: ALL_SUBCLASSES,
  options: ALL_OPTIONS,
  items: ALL_ITEMS,
  feats: ALL_FEATS,
  races: [human],
  backgrounds: [soldier],
});

const BASE: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

function build(opts: {
  levels: readonly LevelEntry[];
  abilities?: Partial<Record<Ability, number>>;
  inventory?: readonly InventoryItem[];
  race?: string;
  background?: string;
}): CharacterDefinition {
  const abilities: Record<Ability, number> = { ...BASE };
  for (const [k, v] of Object.entries(opts.abilities ?? {})) abilities[k as Ability] = v as number;
  return {
    ruleset: '2014',
    packs: [],
    name: 'Test',
    abilities: abilities as AbilityScores,
    levels: opts.levels,
    race: opts.race ?? null,
    subrace: null,
    background: opts.background ?? null,
    inventory: opts.inventory ?? [],
    currency: EMPTY_CURRENCY,
  };
}

const at = (cls: string, over: Partial<LevelEntry> = {}): LevelEntry => ({
  class: cls, hp: { mode: 'average' }, choices: [], ...over,
});

/** A `select` choice, which is every "choose N from a list". */
const pick = (pool: string, ...picks: string[]): LevelChoice => ({ kind: 'select', pool, picks });

const asi = (...increases: { ability: Ability; amount: number }[]): LevelChoice => ({ kind: 'asi', increases });

/** A fighter's two class skills, taken the way the book says they are. */
const FIGHTER_SKILLS = pick('skill:fighter', 'athletics', 'perception');

const held = (item: string): InventoryItem => ({ item, quantity: 1, equipped: true, attuned: false, custom: null });

const skillOf = (sheet: ReturnType<typeof derive>, id: string) =>
  sheet.skills.find((s) => s.id === id) ?? assert.fail(`no skill ${id}`);

const attackNamed = (sheet: ReturnType<typeof derive>, name: string) =>
  sheet.attacks.find((a) => a.name === name) ?? assert.fail(`no attack ${name}`);

/** The fighter fixture with an `invocation` pool bolted on, for prerequisites. */
const withFixtureInvocations = (): ClassEntry => ({
  ...fighter,
  features: [
    ...fighter.features,
    { id: 'fixture-invocations', name: 'Invocations', level: 1, summary: 'Fixture.', effects: [
      { shape: 'choice.offer', pool: 'invocation', label: 'Invocations', count: 2, from: null, grants: [] },
    ] },
  ],
});

/** The fighter fixture offering a pool nobody has authored options for. */
const withTypoPool = (): ClassEntry => ({
  ...fighter,
  features: [
    ...fighter.features,
    { id: 'fixture-typo', name: 'Typo', level: 1, summary: 'Offers a pool nobody authored.', effects: [
      { shape: 'choice.offer', pool: 'fighting-stile', label: 'Typo', count: 1, from: null, grants: [] },
    ] },
  ],
});

// ---------------------------------------------------------------------------

test('level 1 fighter: AC, HP, attack, skills and saves', () => {
  const sheet = derive(build({
    levels: [at('fighter', { choices: [FIGHTER_SKILLS] })],
    abilities: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
    inventory: [held('chain-mail'), held('shield'), held('longsword')],
    background: 'soldier',
  }), content);

  // Ability modifiers: floor((score - 10) / 2).
  assert.equal(sheet.abilities.str.modifier, 3);
  assert.equal(sheet.abilities.dex.modifier, 2);
  assert.equal(sheet.abilities.con.modifier, 2);
  assert.equal(sheet.abilities.int.modifier, 0);
  assert.equal(sheet.abilities.wis.modifier, 1);
  assert.equal(sheet.abilities.cha.modifier, -1);

  assert.equal(sheet.proficiencyBonus, 2);
  assert.equal(sheet.totalLevel, 1);

  // Chain mail 16 with DEX ignored, plus a shield's +2.
  assert.equal(sheet.armorClass, 18);

  // d10 maximum at first level, plus CON.
  assert.equal(sheet.hitPoints.maximum, 12);

  // Longsword is melee and not finesse, so Strength: 3 + 2 proficiency.
  const sword = attackNamed(sheet, 'Longsword');
  assert.equal(sword.toHit, 5);
  assert.deepEqual(sword.damage[0]?.dice, { count: 1, die: 8 });
  assert.equal(sword.damage[0]?.flat, 3);
  assert.equal(sword.damage[0]?.damageType, 'slashing');

  // Athletics from the Soldier background: +3 STR, +2 proficiency.
  assert.deepEqual(
    { bonus: skillOf(sheet, 'athletics').bonus, proficient: skillOf(sheet, 'athletics').proficient },
    { bonus: 5, proficient: true },
  );

  // Perception is picked from the fighter's skill list; both are proficient.
  assert.equal(skillOf(sheet, 'perception').proficient, true);

  // Stealth is unproficient and not on the fighter's list.
  assert.equal(skillOf(sheet, 'stealth').bonus, 2);
  assert.equal(sheet.passive.perception, 13);

  assert.equal(sheet.initiative, 2);

  // Saving throws come from the class table: fighter is STR and CON.
  const save = (a: Ability) => sheet.saves.find((s) => s.ability === a);
  assert.deepEqual({ p: save('str')?.proficient, b: save('str')?.bonus }, { p: true, b: 5 });
  assert.deepEqual({ p: save('con')?.proficient, b: save('con')?.bonus }, { p: true, b: 4 });
  assert.deepEqual({ p: save('dex')?.proficient, b: save('dex')?.bonus }, { p: false, b: 2 });

  assert.deepEqual(sheet.diagnostics, []);
});

test('a later CON increase retroactively moves hit points at every level', () => {
  // CON 14 for the first three levels, raised by 2 at level 4. The 2014 rule is
  // that the new modifier applies as though it had been there from level 1, so
  // every level is recomputed at +3.
  const sheet = derive(build({
    levels: [
      at('fighter'), at('fighter'), at('fighter'),
      at('fighter', { choices: [asi({ ability: 'con', amount: 2 })] }),
      at('fighter'),
    ],
    abilities: { con: 14 },
  }), content);

  assert.equal(sheet.abilities.con.score, 16);
  assert.equal(sheet.abilities.con.modifier, 3);
  // (10 + 3) + 4 x (6 + 3) = 13 + 36
  assert.equal(sheet.hitPoints.maximum, 49);
});

test('proficiency bonus follows TOTAL level, not class level', () => {
  const sheet = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'), at('fighter'), at('fighter'), at('rogue')],
  }), content);

  assert.equal(sheet.totalLevel, 6);
  assert.equal(sheet.classLevels['fighter'], 5);
  assert.equal(sheet.classLevels['rogue'], 1);
  // Total level 6 is in the 5-8 band.
  assert.equal(sheet.proficiencyBonus, 3);
});

test('expertise doubles proficiency, and only when proficient', () => {
  const sheet = derive(build({
    levels: [at('rogue', { choices: [
      pick('skill:rogue', 'stealth', 'sleight-of-hand', 'perception', 'investigation'),
      pick('proficient:skill+tool', 'stealth'),
    ] })],
    abilities: { dex: 16 },
  }), content);

  // DEX +3, proficiency +2 doubled to +4.
  const stealth = skillOf(sheet, 'stealth');
  assert.deepEqual({ bonus: stealth.bonus, proficient: stealth.proficient, expertise: stealth.expertise },
    { bonus: 7, proficient: true, expertise: true });

  // Sleight of Hand is proficient but not expertised.
  assert.equal(skillOf(sheet, 'sleight-of-hand').bonus, 5);
  // Acrobatics is neither.
  assert.equal(skillOf(sheet, 'acrobatics').bonus, 3);
  // One of the two Expertise picks is unused; that is not an error.
  assert.deepEqual(sheet.diagnostics, []);
});

test('expertise may be taken in a tool the character is proficient with (PHB 96)', () => {
  const sheet = derive(build({
    levels: [at('rogue', { choices: [
      pick('skill:rogue', 'stealth', 'sleight-of-hand', 'perception', 'investigation'),
      pick('proficient:skill+tool', 'stealth', 'thieves-tools'),
    ] })],
    abilities: { dex: 16 },
  }), content);

  assert.deepEqual(sheet.diagnostics, []);
  const expertise = sheet.selections.find((s) => s.pool === 'proficient:skill+tool');
  assert.deepEqual(expertise?.picks.map((p) => p.id), ['stealth', 'thieves-tools']);
});

test('expertise in something the character is not proficient in is diagnosed', () => {
  // The engine used to skip this silently, which is the bug the mechanism
  // exists to remove.
  const sheet = derive(build({
    levels: [at('rogue', { choices: [
      pick('skill:rogue', 'stealth', 'sleight-of-hand', 'perception', 'investigation'),
      pick('proficient:skill+tool', 'stealth', 'arcana'),
    ] })],
  }), content);

  assert.equal(skillOf(sheet, 'arcana').expertise, false);
  assert.ok(
    sheet.diagnostics.some((d) => d.includes('arcana') && d.includes('not something the character is proficient in')),
    `expected an expertise diagnostic, got ${JSON.stringify(sheet.diagnostics)}`,
  );
});

test('Jack of All Trades adds half proficiency, rounded down, to everything else', () => {
  const sheet = derive(build({ levels: [at('bard'), at('bard')], abilities: { str: 10 } }), content);

  assert.equal(sheet.proficiencyBonus, 2);
  // Unproficient, half of +2 rounded down is +1, on top of a +0 modifier.
  const athletics = skillOf(sheet, 'athletics');
  assert.deepEqual({ bonus: athletics.bonus, proficient: athletics.proficient, half: athletics.halfProficiency },
    { bonus: 1, proficient: false, half: true });
});

test('a proficient skill does NOT also get the half-proficiency bonus', () => {
  const sheet = derive(build({ levels: [at('bard'), at('bard')], background: 'soldier' }), content);
  const athletics = skillOf(sheet, 'athletics');
  assert.equal(athletics.halfProficiency, false);
  assert.equal(athletics.bonus, 2); // +0 STR, +2 proficiency, not +1 or +3
});

test('Remarkable Athlete rounds up where Jack of All Trades rounds down', () => {
  // Same shape, opposite rounding: at proficiency +3 the two disagree, and
  // nothing but reading PHB 72 settles it.
  const sheet = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter', { choices: [pick('subclass:fighter', 'champion')] }),
             at('fighter'), at('fighter'), at('fighter'), at('fighter')],
    abilities: { str: 14, dex: 14, cha: 14 },
  }), content);

  assert.equal(sheet.proficiencyBonus, 3);

  // Athletics: STR +2, not proficient, not a fighter skill. Half of +3 is 1.5,
  // and PHB 72 says round up.
  assert.equal(skillOf(sheet, 'athletics').bonus, 2 + 2);

  // Persuasion is governed by Charisma, which Remarkable Athlete does not
  // cover, so there is no half bonus at all.
  assert.equal(skillOf(sheet, 'persuasion').bonus, 2);
});

test('barbarian Unarmored Defense: 10 + DEX + CON, and a shield is allowed', () => {
  const base = build({
    levels: [at('barbarian')],
    abilities: { dex: 14, con: 16 },
  });
  assert.equal(derive(base, content).armorClass, 15); // 10 + 2 + 3

  const withShield = build({
    levels: [at('barbarian')],
    abilities: { dex: 14, con: 16 },
    inventory: [held('shield')],
  });
  assert.equal(derive(withShield, content).armorClass, 17); // 15 + 2
});

test('monk Unarmored Defense is lost behind a shield', () => {
  const base = build({ levels: [at('monk')], abilities: { dex: 16, wis: 16 } });
  assert.equal(derive(base, content).armorClass, 16); // 10 + 3 + 3

  const withShield = build({
    levels: [at('monk')],
    abilities: { dex: 16, wis: 16 },
    inventory: [held('shield')],
  });
  // The formula requires no shield, so the plain unarmoured 10 + 3 applies,
  // and then the shield's +2 on top.
  assert.equal(derive(withShield, content).armorClass, 15);
});

test('armour DEX rules: light uncapped, medium capped at +2, heavy ignored', () => {
  const dex18 = { dex: 18 };
  assert.equal(derive(build({ levels: [at('fighter')], abilities: dex18, inventory: [held('studded-leather')] }), content).armorClass, 16); // 12 + 4
  assert.equal(derive(build({ levels: [at('fighter')], abilities: dex18, inventory: [held('scale-mail')] }), content).armorClass, 16);      // 14 + min(4,2)

  // A negative DEX is ignored entirely by heavy armour, not subtracted.
  assert.equal(derive(build({ levels: [at('fighter')], abilities: { dex: 8 }, inventory: [held('chain-mail')] }), content).armorClass, 16);
});

test('finesse takes the better of Strength and Dexterity', () => {
  // DEX higher.
  const dexier = derive(build({
    levels: [at('rogue')], abilities: { str: 10, dex: 18 }, inventory: [held('dagger')],
  }), content);
  const a = attackNamed(dexier, 'Dagger');
  assert.equal(a.ability, 'dex');
  assert.equal(a.toHit, 6); // +4 DEX, +2 proficiency

  // STR higher.
  const stronger = derive(build({
    levels: [at('rogue')], abilities: { str: 20, dex: 10 }, inventory: [held('dagger')],
  }), content);
  const b = attackNamed(stronger, 'Dagger');
  assert.equal(b.ability, 'str');
  assert.equal(b.toHit, 7); // +5 STR, +2 proficiency
});

test('a ranged weapon uses Dexterity', () => {
  const sheet = derive(build({
    levels: [at('rogue')], abilities: { str: 18, dex: 14 }, inventory: [held('shortbow')],
  }), content);
  const bow = attackNamed(sheet, 'Shortbow');
  assert.equal(bow.ability, 'dex');
  assert.equal(bow.toHit, 4); // +2 DEX, +2 proficiency
});

test('a conditional rider is reported, not silently added', () => {
  const sheet = derive(build({
    levels: [at('barbarian')], abilities: { str: 16 }, inventory: [held('greataxe')],
  }), content);

  const axe = attackNamed(sheet, 'Greataxe');
  // Rage's +2 is conditional, so the flat damage stays 1d12 + 3.
  assert.equal(axe.damage[0]?.flat, 3);
  assert.equal(axe.toHit, 5);
  assert.ok(axe.notes.some((n) => n.includes('Raging')), `expected a Rage note, got ${JSON.stringify(axe.notes)}`);
});

test('a scope can say "or", which Sneak Attack needs', () => {
  // PHB 96 gates Sneak Attack on the weapon being finesse or ranged — a weapon,
  // and then one of two things. The conjunction alone could not express it.
  const withWeapon = (item: string) => derive(build({
    levels: [at('rogue')],
    abilities: { str: 16, dex: 16 },
    inventory: [held(item)],
  }), content);

  const rider = (sheet: ReturnType<typeof derive>, name: string) =>
    attackNamed(sheet, name).damage.some((d) => d.label === 'Sneak Attack');

  // A dagger is finesse, a shortbow is ranged — both qualify.
  assert.equal(rider(withWeapon('dagger'), 'Dagger'), true);
  assert.equal(rider(withWeapon('shortbow'), 'Shortbow'), true);

  // A greataxe is neither, so the rider is not on that line at all.
  assert.equal(rider(withWeapon('greataxe'), 'Greataxe'), false);
});

test('a feature is collected once, not once per level', () => {
  // The pipeline's per-level loop used to collect every feature the class had
  // reached, once per level entry. A 5th-level rogue carried five Sneak Attack
  // riders and a 3rd-level barbarian added Rage's damage three times.
  const sheet = derive(build({
    levels: [at('rogue'), at('rogue'), at('rogue'), at('rogue'), at('rogue')],
    abilities: { dex: 16 },
    inventory: [held('dagger')],
  }), content);

  const dagger = attackNamed(sheet, 'Dagger');
  const sneak = dagger.damage.filter((d) => d.label === 'Sneak Attack');
  assert.equal(sneak.length, 1);
  assert.equal(sheet.notes.filter((n) => n.name === 'Sneak Attack').length, 1);

  const barbarian = derive(build({
    levels: [at('barbarian'), at('barbarian'), at('barbarian')],
    abilities: { str: 16 },
    inventory: [held('greataxe')],
  }), content);
  const notes = attackNamed(barbarian, 'Greataxe').notes.filter((n) => n.includes('Raging'));
  assert.deepEqual(notes, ['Raging: +2 damage']);
});

test('a feat that raises an ability score is applied, not dropped', () => {
  // Effects are collected before abilities resolve, so a feat's +1 STR has
  // somewhere to go. It used to reach the accumulator after the score was
  // already final, and vanished without a diagnostic.
  const sheet = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'),
             at('fighter', { choices: [{ kind: 'feat', feat: 'tavern-brawler' }] })],
    abilities: { str: 15 },
  }), content);

  assert.equal(sheet.abilities.str.score, 16);
  assert.equal(sheet.abilities.str.modifier, 3);
  assert.deepEqual(sheet.diagnostics, []);
});

test('Extra Attack raises the count, and does not stack across classes', () => {
  const one = derive(build({ levels: [at('fighter')] }), content);
  assert.equal(one.attacksPerAction, 1);

  const five = derive(build({ levels: [at('fighter'), at('fighter'), at('fighter'), at('fighter'), at('fighter')] }), content);
  assert.equal(five.attacksPerAction, 2);

  // Fighter 5 also grants Extra Attack; a second source must not stack to 3.
  const twoSources = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'), at('fighter'), at('fighter'), at('barbarian')],
  }), content);
  assert.equal(twoSources.attacksPerAction, 2);
});

test('spell slots: a single half-caster uses its own table, not the multiclass formula', () => {
  const sheet = derive(build({
    levels: [at('paladin'), at('paladin'), at('paladin'), at('paladin'), at('paladin')],
    abilities: { cha: 16 },
  }), content);

  assert.equal(sheet.spellcasting.length, 1);
  assert.deepEqual(sheet.spellcasting[0]?.slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sheet.spellcasting[0]?.saveDc, 8 + 3 + 3);
  assert.equal(sheet.spellcasting[0]?.attackBonus, 3 + 3);
});

test('spell slots: a full caster', () => {
  const sheet = derive(build({
    levels: [at('wizard'), at('wizard'), at('wizard'), at('wizard'), at('wizard')],
    abilities: { int: 18 },
  }), content);

  assert.deepEqual(sheet.spellcasting[0]?.slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(sheet.spellcasting[0]?.saveDc, 8 + 3 + 4);
});

test('Pact Magic is its own table and scales differently', () => {
  const sheet = derive(build({
    levels: [at('warlock'), at('warlock'), at('warlock'), at('warlock'), at('warlock')],
    abilities: { cha: 16 },
  }), content);

  // Level 5 warlock: two slots, both of 3rd level.
  assert.deepEqual(sheet.spellcasting[0]?.slots, [0, 0, 2, 0, 0, 0, 0, 0, 0]);
});

test('multiclass casters combine, and Pact Magic is excluded from the total', () => {
  // Two full casters: caster level 3 + 2 = 5, so the full table row 5.
  const full = derive(build({
    levels: [at('wizard'), at('wizard'), at('wizard'), at('cleric'), at('cleric')],
  }), content);
  assert.deepEqual(full.spellcasting[0]?.slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);

  // Paladin 6 contributes floor(6/2) = 3, wizard 3 contributes 3, total 6.
  const mixed = derive(build({
    levels: [at('paladin'), at('paladin'), at('paladin'), at('paladin'), at('paladin'), at('paladin'),
             at('wizard'), at('wizard'), at('wizard')],
  }), content);
  assert.deepEqual(mixed.spellcasting[0]?.slots, [4, 3, 3, 0, 0, 0, 0, 0, 0]);
});

test('Tough adds 2 hit points per level, including the first', () => {
  const sheet = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'),
             at('fighter', { choices: [{ kind: 'feat', feat: 'tough' }] })],
    abilities: { con: 14 },
  }), content);

  // Level 1 takes 10 + 2 CON; three more levels take 6 + 2 each; Tough adds 2
  // for each of the four levels.
  assert.equal(sheet.hitPoints.maximum, 12 + 3 * 8 + 8);
});

test('hit dice pool counts by die size across classes', () => {
  const sheet = derive(build({
    levels: [at('fighter'), at('fighter'), at('barbarian')],
  }), content);
  assert.deepEqual(sheet.hitDice, { d10: 2, d12: 1 });
});

test('a rolled hit point is an input, and level 1 is still the maximum', () => {
  const sheet = derive(build({
    levels: [at('fighter', { hp: { mode: 'rolled', value: 1 } }), at('fighter', { hp: { mode: 'rolled', value: 3 } })],
    abilities: { con: 10 },
  }), content);
  // Level 1 takes max (10) regardless; level 2 takes the roll (3).
  assert.equal(sheet.hitPoints.maximum, 13);
});

test('unresolvable content is a diagnostic, not a crash', () => {
  const sheet = derive(build({
    levels: [
      at('fighter'), at('fighter'),
      at('fighter', { choices: [pick('subclass:fighter', 'nonexistent-subclass')] }),
    ],
    race: 'nonexistent-race',
    inventory: [held('nonexistent-item')],
  }), content);

  assert.ok(sheet.diagnostics.some((d) => d.includes('nonexistent-race')));
  assert.ok(sheet.diagnostics.some((d) => d.includes('nonexistent-subclass')));
  assert.ok(sheet.diagnostics.some((d) => d.includes('nonexistent-item')));
  // It still produces a usable sheet.
  assert.equal(sheet.hitPoints.maximum, 22);
});

test('a non-2014 ruleset is refused outright', () => {
  const bad = { ...build({ levels: [at('fighter')] }), ruleset: '2024' } as unknown as CharacterDefinition;
  assert.throws(() => derive(bad, content), /2014/);
});

test('the sheet is a pure function of the definition', () => {
  const definition = build({
    levels: [at('fighter', { choices: [FIGHTER_SKILLS] })],
    abilities: { str: 16, dex: 14, con: 15 },
    inventory: [held('chain-mail'), held('shield'), held('longsword')],
  });
  assert.deepEqual(derive(definition, content), derive(definition, content));
});

// ---------------------------------------------------------------------------
// Entitlement — the checks that were the point of ADR-0008
// ---------------------------------------------------------------------------

test('a fighter may not choose an archetype before 3rd level', () => {
  const sheet = derive(build({
    levels: [at('fighter', { choices: [pick('subclass:fighter', 'champion')] })],
  }), content);

  // No feature offers the pool at 1st level, so the pick is entitled to
  // nothing. Under-subscription is fine; over-subscription is not.
  assert.equal(sheet.selections.find((s) => s.pool === 'subclass:fighter')?.entitled, 0);
  assert.ok(
    sheet.diagnostics.some((d) => d.includes('subclass:fighter') && d.includes('no feature offers')),
    `expected an entitlement diagnostic, got ${JSON.stringify(sheet.diagnostics)}`,
  );
});

test('a fighter of 3rd level may choose an archetype, and gets its features', () => {
  const sheet = derive(build({
    levels: [
      at('fighter'), at('fighter'),
      at('fighter', { choices: [pick('subclass:fighter', 'champion')] }),
    ],
    inventory: [held('longsword')],
  }), content);

  assert.deepEqual(sheet.diagnostics, []);
  assert.equal(sheet.critRange, 19);
  const chosen = sheet.selections.find((s) => s.pool === 'subclass:fighter');
  assert.deepEqual(chosen?.picks.map((p) => p.name), ['Champion']);

  // The archetype grants features at 3rd, 7th, 10th, 15th and 18th — so the
  // 7th-level one waits.
  const seventh = derive(build({
    levels: [
      at('fighter'), at('fighter'),
      at('fighter', { choices: [pick('subclass:fighter', 'champion')] }),
      at('fighter'), at('fighter'), at('fighter'),
      at('fighter', { choices: [asi({ ability: 'str', amount: 2 })] }),
    ],
    abilities: { str: 12 },
  }), content);
  assert.ok(
    seventh.diagnostics.every((d) => !d.includes('Remarkable Athlete')),
    JSON.stringify(seventh.diagnostics),
  );
});

test('an archetype chosen at 3rd level does not grant a later feature early', () => {
  const three = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter', { choices: [pick('subclass:fighter', 'champion')] })],
  }), content);
  // Improved Critical is a 3rd-level feature; Additional Fighting Style is 10th.
  assert.equal(three.selections.filter((s) => s.pool === 'fighting-style').length, 1);
  assert.equal(three.critRange, 19);
});

test('a second Fighting Style at 10th level is a second offer, not arithmetic', () => {
  // ASIs sit at class levels 4, 6 and 8, which are ASI levels for a fighter.
  const levels = [
    at('fighter', { choices: [pick('fighting-style', 'fighting-style-archery')] }),
    at('fighter'), at('fighter'),
    at('fighter', { choices: [asi({ ability: 'str', amount: 2 })] }),
    at('fighter'),
    at('fighter', { choices: [asi({ ability: 'str', amount: 2 })] }),
    at('fighter'),
    at('fighter', { choices: [asi({ ability: 'str', amount: 2 })] }),
    at('fighter'),
    at('fighter', { choices: [pick('subclass:fighter', 'champion')] }),
  ];
  const nine = derive(build({ levels: levels.slice(0, 9) }), content);
  assert.equal(nine.selections.find((s) => s.pool === 'fighting-style')?.entitled, 1);

  const ten = derive(build({ levels }), content);
  // The Champion's Additional Fighting Style is a 10th-level feature making a
  // second offer of the same pool (PHB 73). No level arithmetic anywhere.
  assert.equal(ten.selections.find((s) => s.pool === 'fighting-style')?.entitled, 2);
  assert.deepEqual(ten.diagnostics, []);
});

test('an over-subscribed pool is diagnosed', () => {
  const sheet = derive(build({
    levels: [at('fighter', { choices: [
      pick('skill:fighter', 'athletics', 'perception', 'insight'),
    ] })],
  }), content);

  assert.ok(
    sheet.diagnostics.some((d) => d.includes('allows 2 picks') && d.includes('3 were taken')),
    JSON.stringify(sheet.diagnostics),
  );
});

test('a pick outside the offered list is diagnosed', () => {
  // Stealth is a real skill, but not one of the fighter's.
  const sheet = derive(build({
    levels: [at('fighter', { choices: [pick('skill:fighter', 'athletics', 'stealth')] })],
  }), content);

  assert.equal(skillOf(sheet, 'stealth').proficient, false);
  assert.ok(
    sheet.diagnostics.some((d) => d.includes('stealth') && d.includes('not one of the options offered')),
    JSON.stringify(sheet.diagnostics),
  );
});

test('an offer naming a pool with no options is diagnosed', () => {
  const emptyPool = inMemoryContent({ classes: [withTypoPool()], options: ALL_OPTIONS });
  const sheet = derive(build({
    levels: [at('fighter', { choices: [pick('fighting-stile', 'fighting-style-archery')] })],
  }), emptyPool);

  assert.ok(
    sheet.diagnostics.some((d) => d.includes('fighting-stile') && d.includes('no options in the loaded packs')),
    JSON.stringify(sheet.diagnostics),
  );
});

test('a class skill choice grants proficiency through the offer\'s grants', () => {
  const sheet = derive(build({
    levels: [at('fighter', { choices: [pick('skill:fighter', 'history', 'survival')] })],
    abilities: { int: 14, wis: 14 },
  }), content);

  assert.equal(skillOf(sheet, 'history').proficient, true);
  assert.equal(skillOf(sheet, 'survival').proficient, true);
  assert.equal(skillOf(sheet, 'history').bonus, 2 + 2);
  assert.deepEqual(sheet.diagnostics, []);
});

test('a picked option confers its own effects', () => {
  const sheet = derive(build({
    levels: [at('fighter', { choices: [pick('fighting-style', 'fighting-style-archery')] })],
    abilities: { dex: 16 },
    inventory: [held('shortbow')],
  }), content);

  assert.equal(attackNamed(sheet, 'Shortbow').toHit, 3 + 2 + 2);
  assert.deepEqual(sheet.diagnostics, []);
});

test('a pick whose prerequisites are unmet is diagnosed', () => {
  const withOffers = inMemoryContent({
    classes: [withFixtureInvocations()],
    subclasses: ALL_SUBCLASSES,
    options: ALL_OPTIONS,
  });

  // A fighter of 4th level picking an invocation that needs 5th.
  const unmet = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'), at('fighter', { choices: [
      pick('invocation', 'invocation-agonizing-blast'),
    ] })],
  }), withOffers);
  assert.ok(
    unmet.diagnostics.some((d) => d.includes('Agonizing Blast') && d.includes('totalLevel >= 5')),
    JSON.stringify(unmet.diagnostics),
  );

  // The same pick at 6th level is met, and still confers its effects.
  const met = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'), at('fighter'), at('fighter'),
             at('fighter', { choices: [pick('invocation', 'invocation-agonizing-blast')] })],
  }), withOffers);
  assert.ok(
    met.diagnostics.every((d) => !d.includes('Agonizing Blast')),
    JSON.stringify(met.diagnostics),
  );
});

test('hasFeature resolves entry ids, not display names', () => {
  // Two invocations, one requiring `hasFeature("fighter-extra-attack")` and one
  // requiring `hasFeature("extra-attack")` — the feature's *name*. A fighter of
  // 6th level has that feature, so the first is met and the second is not.
  const provider = inMemoryContent({
    classes: [withFixtureInvocations()],
    subclasses: ALL_SUBCLASSES,
    options: ALL_OPTIONS,
  });

  const sheet = derive(build({
    levels: [
      at('fighter'), at('fighter'),
      at('fighter', { choices: [pick('subclass:fighter', 'champion')] }),
      at('fighter'), at('fighter'),
      at('fighter', { choices: [
        pick('invocation', 'invocation-eldritch-spear', 'invocation-name-trap'),
      ] }),
    ],
  }), provider);

  assert.ok(
    sheet.diagnostics.every((d) => !d.includes('Eldritch Spear')),
    `the id-based prerequisite should be met: ${JSON.stringify(sheet.diagnostics)}`,
  );
  assert.ok(
    sheet.diagnostics.some((d) => d.includes('Name Trap') && d.includes('hasFeature("extra-attack")')),
    `the name-based prerequisite should not be met: ${JSON.stringify(sheet.diagnostics)}`,
  );
});

test('an ability score improvement is only allowed at an ASI level', () => {
  const legal = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'),
             at('fighter', { choices: [asi({ ability: 'str', amount: 2 })] })],
    abilities: { str: 12 },
  }), content);
  assert.equal(legal.abilities.str.score, 14);
  assert.deepEqual(legal.diagnostics, []);

  // 5th level is not an ASI level for a fighter, for whom the class table lists
  // 4th, 6th, 8th, 12th, 14th, 16th and 19th (PHB 72).
  const illegal = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'), at('fighter'),
             at('fighter', { choices: [asi({ ability: 'str', amount: 2 })] })],
    abilities: { str: 12 },
  }), content);
  assert.equal(illegal.abilities.str.score, 14);
  assert.ok(
    illegal.diagnostics.some((d) => d.includes('ability score improvement') && d.includes('fighter level 5')),
    JSON.stringify(illegal.diagnostics),
  );

  // 6th level is one.
  const sixth = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'), at('fighter'), at('fighter'),
             at('fighter', { choices: [asi({ ability: 'str', amount: 2 })] })],
    abilities: { str: 12 },
  }), content);
  assert.deepEqual(sixth.diagnostics, []);
});

test('a selection reports what the pool offers, so a picker can be rendered', () => {
  const sheet = derive(build({ levels: [at('fighter'), at('fighter')] }), content);

  const skills = sheet.selections.find((s) => s.pool === 'skill:fighter');
  assert.equal(skills?.entitled, 2);
  // The eight the fighter chooses between, not the eighteen that exist.
  assert.deepEqual(skills?.candidates.map((c) => c.id).sort(), [
    'acrobatics', 'animal-handling', 'athletics', 'history',
    'insight', 'intimidation', 'perception', 'survival',
  ]);
  assert.deepEqual(skills?.picks, []);

  // A content pool offers its entries by name, so the UI never needs the pack.
  const styles = sheet.selections.find((s) => s.pool === 'fighting-style');
  assert.deepEqual(styles?.candidates.map((c) => c.name), ['Archery', 'Defense']);

  // Before 3rd level the class offers no archetype, so there is no pool to
  // render at all — not an empty one.
  const one = derive(build({ levels: [at('fighter'), at('fighter')] }), content);
  assert.equal(one.selections.find((s) => s.pool === 'subclass:fighter'), undefined);

  const three = derive(build({ levels: [at('fighter'), at('fighter'), at('fighter')] }), content);
  assert.deepEqual(three.selections.find((s) => s.pool === 'subclass:fighter')?.candidates.map((c) => c.name), ['Champion']);
});

test('advancements report where an ASI-or-feat is owed', () => {
  const sheet = derive(build({
    levels: [at('fighter'), at('fighter'), at('fighter'),
             at('fighter', { choices: [asi({ ability: 'str', amount: 2 })] }),
             at('fighter'), at('fighter')],
    abilities: { str: 12 },
  }), content);

  // Fighter ASI levels are 4, 6, 8, 12, 14, 16, 19 (PHB 72).
  assert.deepEqual(sheet.advancements, [
    { level: 3, classId: 'fighter', classLevel: 4, kind: 'asi-or-feat', taken: true },
    { level: 5, classId: 'fighter', classLevel: 6, kind: 'asi-or-feat', taken: false },
  ]);
});

test("a magic weapon's bonus applies to that weapon, and not to the others", () => {
  // `scope` was written for features — Archery applies to every ranged weapon.
  // An item's bonus is a property of the item, and a +1 longsword that also
  // sharpened the greataxe would be wrong in a way nobody would notice.
  const sheet = derive(build({
    levels: [at('fighter')],
    abilities: { str: 16 },
    inventory: [held('longsword-plus-1'), held('greataxe')],
  }), content);

  const sword = attackNamed(sheet, 'Longsword +1');
  assert.equal(sword.toHit, 3 + 2 + 1);
  assert.equal(sword.damage[0]?.flat, 3 + 1);

  const axe = attackNamed(sheet, 'Greataxe');
  assert.equal(axe.toHit, 3 + 2);
  assert.equal(axe.damage[0]?.flat, 3);
});

test('a worn item keeps its effect global, because it is not a weapon line', () => {
  const sheet = derive(build({
    levels: [at('fighter')],
    abilities: { str: 16 },
    inventory: [held('cloak-of-protection')],
  }), content);

  assert.equal(sheet.armorClass, 10 + 0 + 1);   // 10 + DEX 0, plus the cloak
  assert.equal(sheet.diagnostics.length, 0);
});

test('a custom item is built on a real base, so its mundane statistics are the base\'s', () => {
  const custom = {
    id: 'custom-fang', name: "Vesaria's Fang", tier: 'custom' as const, base: 'longsword',
    effects: [
      { shape: 'attack.bonus' as const, amount: 1 },
      { shape: 'damage.bonus' as const, amount: 1 },
      { shape: 'damage.dice' as const, dice: { count: 1, die: 6 }, damageType: 'fire' as const, label: 'Flame' },
    ],
  };

  const sheet = derive(build({
    levels: [at('fighter')],
    abilities: { str: 16 },
    inventory: [{ item: custom.id, quantity: 1, equipped: true, attuned: false, custom }],
  }), content);

  const fang = attackNamed(sheet, "Vesaria's Fang");
  // The base longsword supplies d8 slashing; the custom effects sit on top.
  assert.deepEqual(fang.damage[0]?.dice, { count: 1, die: 8 });
  assert.equal(fang.damage[0]?.damageType, 'slashing');
  assert.equal(fang.toHit, 3 + 2 + 1);
  assert.equal(fang.damage[0]?.flat, 3 + 1);
  assert.deepEqual(fang.damage[1]?.dice, { count: 1, die: 6 });
  assert.equal(fang.damage[1]?.damageType, 'fire');
  assert.deepEqual(sheet.diagnostics, []);
});

test('a custom item built on a base the pack does not have is diagnosed', () => {
  const sheet = derive(build({
    levels: [at('fighter')],
    inventory: [{
      item: 'custom-x', quantity: 1, equipped: true, attuned: false,
      custom: { id: 'custom-x', name: 'Mystery Blade', tier: 'custom', base: 'nonexistent-blade', effects: [] },
    }],
  }), content);

  assert.ok(
    sheet.diagnostics.some((d) => d.includes('Mystery Blade') && d.includes('nonexistent-blade')),
    JSON.stringify(sheet.diagnostics),
  );
});

test('a dice pool can grow with level, which is how Sneak Attack is written', () => {
  // PHB 95's Sneak Attack column: 1d6 at 1st, 2d6 at 3rd, 3d6 at 5th, 10d6 at
  // 19th — all on one feature. A fixed count cannot say that.
  const scaling = inMemoryContent({
    classes: [{ ...rogue, features: rogue.features.map((feature) =>
      feature.id === 'rogue-sneak-attack'
        ? { ...feature, effects: [{ shape: 'damage.dice' as const,
            dice: { count: '1 + floor((classLevel(rogue) - 1) / 2)', die: 6 },
            damageType: 'slashing' as const, label: 'Sneak Attack',
            scope: { kind: 'weapon' as const, or: [{ properties: ['finesse'] }, { ranged: true }] },
            condition: { optional: true, label: 'Sneak Attack' } }] }
        : feature) }],
    items: ALL_ITEMS,
  });

  const sneakAt = (levels: number): DerivedDice => {
    const sheet = derive(build({
      levels: Array.from({ length: levels }, () => at('rogue')),
      abilities: { dex: 16 },
      inventory: [held('dagger')],
    }), scaling);
    const rider = attackNamed(sheet, 'Dagger').damage.find((d) => d.label === 'Sneak Attack');
    return rider?.dice ?? { count: -1, die: -1 };
  };

  assert.deepEqual(sneakAt(1), { count: 1, die: 6 });
  assert.deepEqual(sneakAt(3), { count: 2, die: 6 });
  assert.deepEqual(sneakAt(5), { count: 3, die: 6 });
  assert.deepEqual(sneakAt(19), { count: 10, die: 6 });
});

test('a dice expression that does not evaluate is a diagnostic, not a crash', () => {
  const broken = inMemoryContent({
    classes: [{ ...rogue, features: rogue.features.map((feature) =>
      feature.id === 'rogue-sneak-attack'
        ? { ...feature, effects: [{ shape: 'damage.dice' as const,
            dice: { count: 'nonsense()', die: 6 }, damageType: 'slashing' as const, label: 'Sneak Attack' }] }
        : feature) }],
    items: ALL_ITEMS,
  });
  const sheet = derive(build({ levels: [at('rogue')], inventory: [held('dagger')] }), broken);
  assert.ok(sheet.diagnostics.some((d) => d.includes('Sneak Attack')), JSON.stringify(sheet.diagnostics));
});

test('a resource declared twice takes the maximum, after evaluation', () => {
  const portable = inMemoryContent({
    classes: [{
      ...fighter,
      features: [
        { id: 'fixture-portent', name: 'Portent', level: 1, summary: 'Fixture.', effects: [
          { shape: 'resource.pool', id: 'portent', max: '2', recharge: 'long' },
        ] },
        { id: 'fixture-greater-portent', name: 'Greater Portent', level: 2, summary: 'Fixture.', effects: [
          { shape: 'resource.pool', id: 'portent', max: '3', recharge: 'long' },
        ] },
      ],
    }],
  });
  const sheet = derive(build({ levels: [at('fighter'), at('fighter')] }), portable);
  assert.deepEqual(sheet.resources, [{ id: 'portent', max: 3, recharge: 'long' }]);
});

