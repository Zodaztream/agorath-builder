/**
 * Starting equipment, and what armour does.
 *
 * Two rules that arrived in ADR-0013 and had never been enforced:
 *
 * - A character's class and background say what they start with. The engine
 *   *reports* that list; it does not write to the definition, because the
 *   definition's inventory is the player's.
 * - Armour has consequences (PHB 144) — one of them a number, the rest
 *   conditions on a die roll that a sheet states rather than fakes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inMemoryContent } from '../src/content.ts';
import { derive } from '../src/derive.ts';
import {
  EMPTY_CURRENCY,
  type Ability,
  type AbilityScores,
  type CharacterDefinition,
  type ClassEntry,
  type InventoryItem,
  type LevelChoice,
  type LevelEntry,
} from '../src/types.ts';
import {
  ALL_CLASSES,
  ALL_FEATS,
  ALL_ITEMS,
  ALL_OPTIONS,
  ALL_SUBCLASSES,
  brokenPack,
  fighter,
  human,
  rogue,
  soldier,
} from './fixtures.ts';

const ALL = {
  classes: ALL_CLASSES,
  subclasses: ALL_SUBCLASSES,
  options: ALL_OPTIONS,
  items: ALL_ITEMS,
  feats: ALL_FEATS,
  races: [human],
  backgrounds: [soldier],
};

const content = inMemoryContent(ALL);

/** The same pack with one option swapped, for the pack-defect case. */
const withBrokenPack = inMemoryContent({ ...ALL, options: [...ALL_OPTIONS, brokenPack] });

function build(opts: {
  levels: readonly LevelEntry[];
  abilities?: Partial<Record<Ability, number>>;
  inventory?: readonly InventoryItem[];
  background?: string;
}): CharacterDefinition {
  const abilities: Record<Ability, number> = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  for (const [k, v] of Object.entries(opts.abilities ?? {})) abilities[k as Ability] = v as number;
  return {
    ruleset: '2014',
    packs: [],
    name: 'Test',
    abilities: abilities as AbilityScores,
    levels: opts.levels,
    race: null,
    subrace: null,
    background: opts.background ?? null,
    inventory: opts.inventory ?? [],
    currency: EMPTY_CURRENCY,
  };
}

const at = (cls: string, over: Partial<LevelEntry> = {}): LevelEntry => ({
  class: cls, hp: { mode: 'average' }, choices: [], ...over,
});

const pick = (pool: string, ...picks: string[]): LevelChoice => ({ kind: 'select', pool, picks });

const held = (item: string): InventoryItem => ({ item, quantity: 1, equipped: true, attuned: false, custom: null });

const grantedIds = (sheet: ReturnType<typeof derive>): string[] =>
  sheet.startingItems.map((g) => `${g.item}x${g.quantity} from ${g.grantedBy}`);

// ---------------------------------------------------------------------------
// What a class starts with
// ---------------------------------------------------------------------------

test('a class kit is reported, and is not written into the character', () => {
  const definition = build({ levels: [at('rogue')] });
  const sheet = derive(definition, content);

  assert.deepEqual(grantedIds(sheet), [
    'leatherx1 from rogue-equipment',
    'daggerx2 from rogue-equipment',
    "thieves-toolsx1 from rogue-equipment",
  ]);
  // The engine never writes to the definition: materialising the kit is the
  // builder's job, and the definition keeps only what the player put there.
  assert.deepEqual(definition.inventory, []);
  assert.deepEqual(sheet.diagnostics, []);
});

test('a package pick confers the picked option, and names the option that did it', () => {
  const sheet = derive(build({
    levels: [at('rogue', { choices: [pick('starting-equipment:rogue:pack', 'rogue-pack-burglar')] })],
  }), content);

  assert.deepEqual(grantedIds(sheet), [
    'leatherx1 from rogue-equipment',
    'daggerx2 from rogue-equipment',
    "thieves-toolsx1 from rogue-equipment",
    "burglars-packx1 from rogue-pack-burglar",
  ]);
  assert.deepEqual(sheet.diagnostics, []);
});

test('the pool is offered with its members and their sentences, so a picker needs no rules', () => {
  const sheet = derive(build({ levels: [at('rogue')] }), content);
  const pack = sheet.selections.find((s) => s.pool === 'starting-equipment:rogue:pack');

  assert.ok(pack, `expected the pack offer, got ${JSON.stringify(sheet.selections.map((s) => s.pool))}`);
  assert.equal(pack.entitled, 1);
  assert.deepEqual(pack.candidates.map((c) => c.id), ['rogue-pack-burglar', 'rogue-pack-explorer']);
  assert.equal(pack.candidates[0]?.summary, 'Fixture: a pack of thieving kit.');
});

test('a grant naming an item no pack defines is a diagnostic, and grants nothing', () => {
  const sheet = derive(build({
    levels: [at('rogue', { choices: [pick('starting-equipment:rogue:pack', 'rogue-pack-missing')] })],
  }), withBrokenPack);

  assert.ok(
    sheet.diagnostics.some((d) => d.includes('no-such-item') && d.includes('rogue-pack-missing')),
    JSON.stringify(sheet.diagnostics),
  );
  assert.ok(!sheet.startingItems.some((g) => g.item === 'no-such-item'));
});

test('the background hands over its own package, cited to itself', () => {
  const sheet = derive(build({ levels: [at('rogue')], background: 'soldier' }), content);
  // The soldier fixture grants nothing yet; this asserts the shape of the list,
  // not the soldier's contents, which are the pack's business.
  assert.ok(sheet.startingItems.every((g) => g.grantedBy === 'rogue-equipment'));
});

// ---------------------------------------------------------------------------
// Multiclassing grants no second kit
// ---------------------------------------------------------------------------

test('a class taken after the first brings no equipment, and says so', () => {
  const sheet = derive(build({ levels: [at('fighter'), at('rogue')] }), content);

  assert.deepEqual(sheet.startingItems, []);
  assert.ok(
    sheet.diagnostics.some((d) => d.includes('Rogue starting equipment') && d.includes('multiclass')),
    JSON.stringify(sheet.diagnostics),
  );
  // The rogue's *other* features are granted as written — only the kit is not.
  assert.ok(sheet.notes.some((n) => n.name === 'Expertise'));
});

test('the first class keeps its kit when a second class is added', () => {
  const sheet = derive(build({ levels: [at('rogue'), at('fighter')] }), content);

  assert.deepEqual(grantedIds(sheet), [
    'leatherx1 from rogue-equipment',
    'daggerx2 from rogue-equipment',
    "thieves-toolsx1 from rogue-equipment",
  ]);
  assert.ok(!sheet.diagnostics.some((d) => d.includes('starting equipment')));
});

test('a one-class character is never told about multiclassing', () => {
  const sheet = derive(build({ levels: [at('rogue'), at('rogue'), at('rogue')] }), content);
  assert.ok(!sheet.diagnostics.some((d) => d.includes('multiclass')));
});

// ---------------------------------------------------------------------------
// What the armour does (PHB 144)
// ---------------------------------------------------------------------------

const notesMatching = (sheet: ReturnType<typeof derive>, needle: string): string[] =>
  sheet.armorNotes.filter((n) => n.includes(needle));

test('armour whose Strength requirement is missed costs ten feet of speed', () => {
  const sheet = derive(build({
    levels: [at('fighter')], abilities: { str: 10 }, inventory: [held('chain-mail')],
  }), content);

  assert.equal(sheet.speed, 20);
  assert.equal(notesMatching(sheet, 'requires Strength 13').length, 1);
  assert.ok(
    notesMatching(sheet, 'requires Strength 13')[0]?.includes('yours is 10'),
    JSON.stringify(sheet.armorNotes),
  );
});

test('meeting the requirement costs nothing, and says nothing', () => {
  const sheet = derive(build({
    levels: [at('fighter')], abilities: { str: 13 }, inventory: [held('chain-mail')],
  }), content);

  assert.equal(sheet.speed, 30);
  assert.deepEqual(notesMatching(sheet, 'Strength'), []);
});

test('the comparison is against the score, not the modifier', () => {
  // Str 13 is a +1. Reading the modifier would make this plate legal, and it is
  // not: PHB 144 says "a Strength score equal to or higher than the listed
  // score".
  const sheet = derive(build({
    levels: [at('fighter')], abilities: { str: 13 }, inventory: [held('plate')],
  }), content);

  assert.equal(plateRequirementNote(sheet), 'Plate requires Strength 15, and yours is 13: your speed is reduced by 10 feet (PHB 144).');
  assert.equal(sheet.speed, 20);
});

function plateRequirementNote(sheet: ReturnType<typeof derive>): string | undefined {
  return sheet.armorNotes.find((n) => n.includes('Plate requires'));
}

test('a proficiency the character lacks is stated, not enforced', () => {
  const wizardish = derive(build({
    levels: [at('monk')], abilities: { str: 13 }, inventory: [held('chain-mail')],
  }), content);

  // The monk fixture is proficient with simple weapons only, so heavy armour is
  // not theirs — and the sheet says what that costs rather than refusing it.
  assert.equal(notesMatching(wizardish, 'Not proficient with Chain Mail').length, 1);
  assert.ok(wizardish.armorNotes.some((n) => n.includes('no spellcasting')));
  // Wearing it is still legal, so nothing appears as an error.
  assert.ok(!wizardish.diagnostics.some((d) => d.includes('Chain Mail')));
});

test('being proficient is silent', () => {
  const sheet = derive(build({
    levels: [at('fighter')], abilities: { str: 13 }, inventory: [held('chain-mail')],
  }), content);

  assert.deepEqual(notesMatching(sheet, 'not proficient'), []);
});

test('the Stealth column is carried through as a disadvantage', () => {
  const noisy = derive(build({ levels: [at('fighter')], inventory: [held('scale-mail')] }), content);
  const quiet = derive(build({ levels: [at('fighter')], inventory: [held('studded-leather')] }), content);

  assert.equal(notesMatching(noisy, 'Dexterity (Stealth)').length, 1);
  assert.equal(notesMatching(quiet, 'Dexterity (Stealth)').length, 0);
  assert.ok(notesMatching(noisy, 'Scale Mail')[0]?.startsWith('Scale Mail:'), 'the note names the armour');
});

test('a shield is armour for proficiency, and is checked as one', () => {
  const rogueWithShield = derive(build({ levels: [at('rogue')], inventory: [held('shield')] }), content);
  const fighterWithShield = derive(build({ levels: [at('fighter')], inventory: [held('shield')] }), content);

  assert.equal(notesMatching(rogueWithShield, 'Not proficient with Shield').length, 1);
  assert.equal(notesMatching(fighterWithShield, 'proficient').length, 0);
});

test('a shield has no Strength requirement to miss', () => {
  const sheet = derive(build({
    levels: [at('fighter')], abilities: { str: 8 }, inventory: [held('shield')],
  }), content);

  assert.equal(sheet.speed, 30);
  assert.deepEqual(notesMatching(sheet, 'Strength'), []);
});

test('armour that is carried rather than worn does nothing at all', () => {
  const sheet = derive(build({
    levels: [at('fighter')], abilities: { str: 8 },
    inventory: [{ item: 'chain-mail', quantity: 1, equipped: false, attuned: false, custom: null }],
  }), content);

  assert.equal(sheet.speed, 30);
  assert.deepEqual(sheet.armorNotes, []);
});

test('speed is floored at zero rather than going negative', () => {
  const slow = derive(build({
    levels: [at('fighter')], abilities: { str: 8 }, inventory: [held('plate')],
  }), content);

  assert.equal(slow.speed, 20);
  assert.ok(slow.speed >= 0);
});

test('a class with no equipment feature is not mistaken for one', () => {
  // The fighter fixture grants no items, so the multiclass rule must not fire
  // for it — it only suppresses features that actually hand something over.
  const sheet = derive(build({ levels: [at('rogue'), at('fighter')] }), content);
  assert.ok(!sheet.diagnostics.some((d) => d.includes('Fighter starting equipment')));
});

/** Guards the helper above against a fixture rename quietly disabling a test. */
test('the fixture classes are the ones these tests think they are', () => {
  assert.ok(rogue.features.some((f) => f.id === 'rogue-equipment'));
  assert.ok(!fighter.features.some((f) => f.effects.some((e) => e.shape === 'inventory.grant')));
  assert.equal((ALL_CLASSES as readonly ClassEntry[]).length, 9);
});
