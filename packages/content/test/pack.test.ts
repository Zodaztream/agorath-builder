/**
 * Reading a pack.
 *
 * The interesting cases are all the ways a hand-assembled file can be wrong.
 * A pack is transcribed from a printed page, so the tests here are about the
 * reader saying *precisely* what is broken rather than about the happy path —
 * although the last test is the one that matters most: a pack's provider has to
 * derive a real character.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { derive, type CharacterDefinition } from '@agorath/engine';
import { readPack, readPackText } from '../src/pack.ts';

const PHB = (page: number) => ({ book: 'PHB', page });

/** The smallest pack that can derive something: one class, one option. */
const valid = () => ({
  pack: { id: 'test', name: 'Test pack', version: '1.0.0', ruleset: '2014', tier: 'published', requires: [] },
  entries: [
    {
      id: 'fighter', kind: 'class', name: 'Fighter', source: PHB(70),
      features: [
        {
          id: 'fighter-fighting-style', name: 'Fighting Style', level: 1,
          summary: 'Choose one of the following options.',
          effects: [{ shape: 'choice.offer', pool: 'fighting-style', label: 'Fighting Style', count: 1, from: null, grants: [] }],
        },
      ],
    },
    {
      id: 'champion', kind: 'subclass', name: 'Champion', class: 'fighter', source: PHB(72),
      features: [
        { id: 'champion-improved-critical', name: 'Improved Critical', level: 3,
          summary: 'Weapon attacks crit on 19 or 20.', effects: [{ shape: 'attack.crit-range', minimum: 19 }] },
      ],
    },
    {
      id: 'archery', kind: 'option', name: 'Archery', pool: 'fighting-style', source: PHB(72),
      summary: '+2 to attack rolls with ranged weapons.', prerequisites: [],
      effects: [{ shape: 'attack.bonus', amount: 2, scope: { kind: 'weapon', ranged: true } }],
    },
  ],
});

test('a valid pack loads, and describes itself', () => {
  const result = readPack(valid());

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.meta?.id, 'test');
  assert.equal(result.meta?.ruleset, '2014');
  assert.deepEqual(result.catalog.classes, [{ id: 'fighter', name: 'Fighter', group: '' }]);
  assert.deepEqual(result.catalog.options, [{ id: 'archery', name: 'Archery', group: 'fighting-style' }]);
  assert.deepEqual(result.catalog.subclasses, [{ id: 'champion', name: 'Champion', group: 'fighter' }]);
  assert.equal(result.catalog.counts['options'], 1);
});

test('a pack derives a character through its provider', () => {
  // The whole point of the seam: what the reader hands back must be something
  // `derive()` can use, entry kinds and all.
  const result = readPack(valid());
  const definition: CharacterDefinition = {
    ruleset: '2014',
    packs: [{ id: 'test', version: '1.0.0' }],
    name: 'Test',
    abilities: { str: 12, dex: 16, con: 14, int: 10, wis: 10, cha: 10 },
    levels: [{
      class: 'fighter',
      hp: { mode: 'average' },
      choices: [{ kind: 'select', pool: 'fighting-style', picks: ['archery'] }],
    }],
    race: null, subrace: null, background: null,
    inventory: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  };

  const sheet = derive(definition, result.provider);
  assert.deepEqual(sheet.diagnostics, []);
  // The option was found, picked, and its effect applied.
  assert.deepEqual(sheet.selections.find((s) => s.pool === 'fighting-style')?.picks.map((p) => p.name), ['Archery']);
  assert.equal(sheet.attacks.find((a) => a.name === 'Unarmed strike') !== undefined, true);
});

test('text that is not JSON is an error, not a throw', () => {
  const result = readPackText('{ not json');
  assert.equal(result.meta, null);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] as string, /not valid JSON/);
});

test('the ruleset is enforced at load, not only at derive', () => {
  const pack = valid();
  const result = readPack({ ...pack, pack: { ...pack.pack, ruleset: '2024' } });
  assert.ok(result.errors.some((e) => e.includes('2024')), JSON.stringify(result.errors));
});

test('a missing envelope is reported rather than crashed on', () => {
  const result = readPack({ entries: [] });
  assert.equal(result.meta, null);
  assert.ok(result.errors.some((e) => e.includes('"pack" header')));
});

test('an unknown kind, a missing id and a duplicate are each refused', () => {
  const pack = valid();
  const result = readPack({
    ...pack,
    entries: [
      ...pack.entries,
      { id: 'x', kind: 'spell', name: 'Fireball' },
      { kind: 'feat', name: 'No id' },
      { id: 'archery', kind: 'feat', name: 'Duplicate id' },
    ],
  });

  assert.ok(result.errors.some((e) => e.includes('not a kind of entry')));
  assert.ok(result.errors.some((e) => e.includes('missing "id"')));
  assert.ok(result.errors.some((e) => e.includes('already used by a option')));
  // The good entries still loaded.
  assert.equal(result.catalog.counts['options'], 1);
});

test('an unknown effect shape is an error; a catalogue shape not yet built is a warning', () => {
  const pack = valid();
  const withEffects = (effect: object) => readPack({
    ...pack,
    entries: [
      pack.entries[0],
      { id: 'archery', kind: 'option', name: 'Archery', pool: 'fighting-style', summary: '', prerequisites: [], effects: [effect] },
    ],
  });

  const unknown = withEffects({ shape: 'attack.bonus-ish', amount: 2 });
  assert.ok(unknown.errors.some((e) => e.includes('not an effect shape')), JSON.stringify(unknown.errors));

  const unimplemented = withEffects({ shape: 'damage.reroll', scope: { kind: 'weapon' }, below: 2 });
  assert.deepEqual(unimplemented.errors, []);
  assert.ok(
    unimplemented.warnings.some((w) => w.includes('damage.reroll') && w.includes('does nothing')),
    JSON.stringify(unimplemented.warnings),
  );
});

test('expressions are parsed at load, so a bad one fails here and not at the table', () => {
  const pack = valid();
  const withResource = (max: string) => readPack({
    ...pack,
    entries: [
      ...pack.entries,
      {
        id: 'ki', kind: 'class', name: 'Monk',
        features: [{ id: 'monk-ki', name: 'Ki', level: 2, summary: '', effects: [
          { shape: 'resource.pool', id: 'ki', max, recharge: 'short' },
        ] }],
      },
    ],
  });

  assert.deepEqual(withResource('classLevel(monk)').errors, []);
  const bad = withResource('classLevel(monk) + nonsense()');
  assert.ok(bad.errors.some((e) => e.includes('nonsense')), JSON.stringify(bad.errors));

  const badPrereq = readPack({
    ...pack,
    entries: [
      pack.entries[0],
      { id: 'archery', kind: 'option', name: 'Archery', pool: 'fighting-style', summary: '',
        prerequisites: ['totalLevel >'], effects: [] },
    ],
  });
  assert.ok(badPrereq.errors.some((e) => e.includes('prerequisite')), JSON.stringify(badPrereq.errors));
});

test('a field the engine does not read is a warning, because a typo here does nothing', () => {
  const pack = valid();
  const result = readPack({
    ...pack,
    entries: [{
      id: 'tough', kind: 'feat', name: 'Tough',
      effect: [{ shape: 'hp.per-level', amount: 2 }],   // singular — a real mistake
    }],
  });

  assert.ok(
    result.warnings.some((w) => w.includes('"effect"') && w.includes('not a field the engine reads')),
    JSON.stringify(result.warnings),
  );
  // The entry still loads, with no effects, rather than becoming a crash.
  assert.equal(result.catalog.counts['feats'], 1);
});

test('an offer naming a pool with no options is an error at load', () => {
  const pack = valid();
  const result = readPack({
    ...pack,
    entries: [{
      ...pack.entries[0],
      features: [{
        id: 'fighter-fighting-style', name: 'Fighting Style', level: 1, summary: '',
        effects: [{ shape: 'choice.offer', pool: 'fighting-stile', label: 'Fighting Style', count: 1, from: null, grants: [] }],
      }],
    }],
  });

  assert.ok(
    result.errors.some((e) => e.includes('fighting-stile') && e.includes('no options in this pack')),
    JSON.stringify(result.errors),
  );
});

test('a built-in pool needs no authored options, and a class with no subclass is flagged', () => {
  const pack = valid();
  const result = readPack({
    ...pack,
    // No subclass in this pack, so the engine's own 3rd-level offer has nothing
    // to fill it with — worth saying out loud rather than at the table.
    entries: [
      {
        ...pack.entries[0],
        features: [{
          id: 'fighter-skills', name: 'Skills', level: 1, summary: '',
          effects: [{ shape: 'choice.offer', pool: 'skill:fighter', label: 'Skills', count: 2,
                      from: ['athletics', 'perception'], grants: [{ shape: 'proficiency.grant' }] }],
        }],
      },
      pack.entries[2],   // the option only
    ],
  });

  assert.deepEqual(result.errors, []);
  // `skill` is the engine's own table, so it is not a missing pool...
  assert.ok(!result.warnings.some((w) => w.includes('skill:fighter')), JSON.stringify(result.warnings));
  // ...but the fighter's 3rd-level archetype has no subclass in this pack.
  assert.ok(
    result.warnings.some((w) => w.includes('chooses a subclass at 3 level') && w.includes('no Fighter subclass')),
    JSON.stringify(result.warnings),
  );
});

test('a scope typo is a warning, because a field that never matches fails silently', () => {
  const pack = valid();
  const result = readPack({
    ...pack,
    entries: [
      pack.entries[0],
      { id: 'archery', kind: 'option', name: 'Archery', pool: 'fighting-style', summary: '', prerequisites: [],
        effects: [{ shape: 'attack.bonus', amount: 2, scope: { kind: 'weapon', rnged: true } }] },
    ],
  });

  assert.ok(
    result.warnings.some((w) => w.includes('"rnged"') && w.includes('never matches')),
    JSON.stringify(result.warnings),
  );
});
