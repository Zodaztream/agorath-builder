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
import { EMPTY_CURRENCY, type Ability, type AbilityScores, type CharacterDefinition, type InventoryItem, type LevelEntry } from '../src/types.ts';
import { ALL_CLASSES, ALL_FEATS, ALL_ITEMS, human, soldier } from './fixtures.ts';

const content = inMemoryContent({
  classes: ALL_CLASSES,
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
  class: cls, subclass: null, hp: { mode: 'average' }, choices: [], ...over,
});

const held = (item: string): InventoryItem => ({ item, quantity: 1, equipped: true, attuned: false, custom: null });

const skillOf = (sheet: ReturnType<typeof derive>, id: string) =>
  sheet.skills.find((s) => s.id === id) ?? assert.fail(`no skill ${id}`);

const attackNamed = (sheet: ReturnType<typeof derive>, name: string) =>
  sheet.attacks.find((a) => a.name === name) ?? assert.fail(`no attack ${name}`);

// ---------------------------------------------------------------------------

test('level 1 fighter: AC, HP, attack, skills and saves', () => {
  const sheet = derive(build({
    levels: [at('fighter')],
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

  // Perception is unproficient and not a class skill here.
  assert.equal(skillOf(sheet, 'perception').bonus, 1);
  assert.equal(sheet.passive.perception, 11);

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
      at('fighter', { choices: [{ kind: 'asi', increases: [{ ability: 'con', amount: 2 }] }] }),
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
    levels: [at('rogue', { choices: [{ kind: 'expertise', skills: ['stealth'] }] })],
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
});

test('Jack of All Trades adds half proficiency to everything else', () => {
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
    levels: [at('fighter', { choices: [{ kind: 'feat', feat: 'tough' }] })],
    abilities: { con: 14 },
  }), content);

  // 10 + 2 CON, plus 2 for the one level.
  assert.equal(sheet.hitPoints.maximum, 14);
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
    levels: [at('fighter', { subclass: 'nonexistent-subclass' })],
    race: 'nonexistent-race',
    inventory: [held('nonexistent-item')],
  }), content);

  assert.equal(sheet.diagnostics.length, 3);
  assert.ok(sheet.diagnostics.some((d) => d.includes('nonexistent-race')));
  assert.ok(sheet.diagnostics.some((d) => d.includes('nonexistent-subclass')));
  assert.ok(sheet.diagnostics.some((d) => d.includes('nonexistent-item')));
  // It still produces a usable sheet.
  assert.equal(sheet.hitPoints.maximum, 10);
});

test('a non-2014 ruleset is refused outright', () => {
  const bad = { ...build({ levels: [at('fighter')] }), ruleset: '2024' } as unknown as CharacterDefinition;
  assert.throws(() => derive(bad, content), /2014/);
});

test('the sheet is a pure function of the definition', () => {
  const definition = build({
    levels: [at('fighter')],
    abilities: { str: 16, dex: 14, con: 15 },
    inventory: [held('chain-mail'), held('shield'), held('longsword')],
  });
  assert.deepEqual(derive(definition, content), derive(definition, content));
});
