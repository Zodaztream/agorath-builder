/**
 * What a kit does to the inventory.
 *
 * The engine reports what a character's class and background hand over; this is
 * the one function that turns that into things a player can carry. It is also
 * the only place in the app that touches an item the player did not choose, so
 * what it does *not* do matters as much as what it does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inMemoryContent, type CharacterDefinition, type LevelChoice, type LevelEntry } from '@agorath/engine';
import { ALL_CLASSES, ALL_FEATS, ALL_ITEMS, ALL_OPTIONS, ALL_SUBCLASSES, human, soldier } from '../../engine/test/fixtures.ts';
import { withStartingEquipment } from '../src/store.ts';

const content = inMemoryContent({
  classes: ALL_CLASSES,
  subclasses: ALL_SUBCLASSES,
  options: ALL_OPTIONS,
  items: ALL_ITEMS,
  feats: ALL_FEATS,
  races: [human],
  backgrounds: [soldier],
});

function character(levels: readonly LevelEntry[], inventory: CharacterDefinition['inventory'] = []): CharacterDefinition {
  return {
    ruleset: '2014',
    packs: [],
    name: 'Test',
    abilities: { str: 13, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    levels,
    race: null,
    subrace: null,
    background: null,
    inventory,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  };
}

const rogue = (choices: readonly LevelChoice[] = []): LevelEntry => ({ class: 'rogue', hp: { mode: 'average' }, choices });
const pick = (pool: string, ...picks: string[]): LevelChoice => ({ kind: 'select', pool, picks });

/** Rows as `item×qty` with a `*` for anything the player added themselves. */
const rows = (definition: CharacterDefinition): string[] =>
  definition.inventory.map((i) => `${i.item}×${i.quantity}${i.grantedBy === undefined ? '*' : ''}`);

test('a class\'s kit arrives when the class is taken', () => {
  const empty = character([]);
  const withRogue = withStartingEquipment(character([rogue()]), content, empty);

  assert.deepEqual(rows(withRogue), ['leather×1', 'dagger×2', 'thieves-tools×1']);
});

test('what arrives is equipped when equipping it means something', () => {
  const empty = character([]);
  const withRogue = withStartingEquipment(character([rogue()]), content, empty);

  const byItem = new Map(withRogue.inventory.map((i) => [i.item, i]));
  assert.equal(byItem.get('leather')?.equipped, true, 'armour is worn, or the sheet shows the wrong AC');
  assert.equal(byItem.get('thieves-tools')?.equipped, false, 'a toolkit is carried, not worn');
});

test('picking a package confers it, and the items say where they came from', () => {
  const empty = character([]);
  const picked = character([rogue([pick('starting-equipment:rogue:pack', 'rogue-pack-burglar')])]);
  const result = withStartingEquipment(picked, content, empty);

  assert.deepEqual(rows(result), ['leather×1', 'dagger×2', 'thieves-tools×1', 'burglars-pack×1']);
  assert.equal(
    result.inventory.find((i) => i.item === 'burglars-pack')?.grantedBy,
    'rogue-pack-burglar',
  );
});

test('changing the package swaps what it gave, and leaves the fixed kit alone', () => {
  const before = character([rogue([pick('starting-equipment:rogue:pack', 'rogue-pack-burglar')])]);
  const after = character([rogue([pick('starting-equipment:rogue:pack', 'rogue-pack-explorer')])]);

  const first = withStartingEquipment(before, content, character([]));
  const second = withStartingEquipment(after, content, before);

  assert.deepEqual(rows(second), ['leather×1', 'dagger×2', 'thieves-tools×1', 'explorers-pack×1']);
  assert.ok(!second.inventory.some((i) => i.item === 'burglars-pack'), 'the pack not taken goes');
  assert.ok(first.inventory.some((i) => i.item === 'burglars-pack'), 'and it was there before');
});

test('an item the player added by hand is never touched', () => {
  const empty = character([]);
  const withRogue = withStartingEquipment(character([rogue()]), content, empty);
  const withLoot = {
    ...withRogue,
    inventory: [...withRogue.inventory, { item: 'longsword', quantity: 1, equipped: true, attuned: false, custom: null }],
  };
  // A change that moves the grants: the player re-picks the pack.
  const repicked = withStartingEquipment(
    character([rogue([pick('starting-equipment:rogue:pack', 'rogue-pack-explorer')])], withLoot.inventory),
    content,
    withLoot,
  );

  assert.ok(repicked.inventory.some((i) => i.item === 'longsword' && i.grantedBy === undefined));
});

test('dropping a starting item sticks until the choice behind it changes', () => {
  const before = character([rogue([pick('starting-equipment:rogue:pack', 'rogue-pack-burglar')])]);
  const granted = withStartingEquipment(before, content, character([]));

  // The player puts the pack down on the sheet.
  const dropped = { ...granted, inventory: granted.inventory.filter((i) => i.item !== 'burglars-pack') };

  // An edit that changes nothing about the grants — a name, a score — must not
  // put it back. A rule that undoes the player is worse than no rule.
  const renamed = { ...dropped, name: 'Vesaria' };
  assert.deepEqual(rows(withStartingEquipment(renamed, content, dropped)), rows(dropped));

  // But a different package does re-decide the whole group.
  const switched = character([rogue([pick('starting-equipment:rogue:pack', 'rogue-pack-explorer')])], dropped.inventory);
  assert.deepEqual(rows(withStartingEquipment(switched, content, dropped)), [
    'leather×1', 'dagger×2', 'thieves-tools×1', 'explorers-pack×1',
  ]);
});

test('equipping the armour by hand survives a re-reconcile', () => {
  const before = character([rogue([pick('starting-equipment:rogue:pack', 'rogue-pack-burglar')])]);
  const granted = withStartingEquipment(before, content, character([]));

  const unequipped = {
    ...granted,
    inventory: granted.inventory.map((i) => (i.item === 'leather' ? { ...i, equipped: false } : i)),
  };
  const switched = character([rogue([pick('starting-equipment:rogue:pack', 'rogue-pack-explorer')])], unequipped.inventory);
  const after = withStartingEquipment(switched, content, unequipped);

  assert.equal(after.inventory.find((i) => i.item === 'leather')?.equipped, false);
});

test('a character with no grants and no inventory is left exactly as it is', () => {
  const empty = character([]);
  assert.equal(withStartingEquipment(empty, content, empty), empty, 'the same object: nothing was asked of it');
});

test('a multiclass character is not handed a second kit', () => {
  // First an honest rogue, kit and all...
  const rogueOnly = character([rogue()]);
  const withKit = withStartingEquipment(rogueOnly, content, character([]));
  assert.deepEqual(rows(withKit), ['leather×1', 'dagger×2', 'thieves-tools×1']);

  // ...and then a fighter level, which brings a level's features and no kit.
  const rogueThenFighter = character([
    rogue(),
    { class: 'fighter', hp: { mode: 'average' }, choices: [] },
  ], withKit.inventory);
  const result = withStartingEquipment(rogueThenFighter, content, withKit);

  assert.deepEqual(rows(result), ['leather×1', 'dagger×2', 'thieves-tools×1']);
  assert.ok(!result.inventory.some((i) => i.item === 'shield'), 'the fighter brings nothing');
});
