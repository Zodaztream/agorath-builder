/**
 * The level-up draft and the words for what a level gives you.
 *
 * The numbers come from the engine and are tested there; what is tested here is
 * that committing a level carries its decisions with it, that a level knows what
 * it is still waiting for, and that a gain is written as a sentence a player can
 * read. The last of those is the point of the screen, so it is asserted rather
 * than eyeballed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  derive,
  inMemoryContent,
  previewLevel,
  type AbilityScores,
  type CharacterDefinition,
  type LevelChoice,
  type LevelEntry,
  type LevelGain,
} from '@agorath/engine';
import { ALL_CLASSES, ALL_FEATS, ALL_ITEMS, ALL_OPTIONS, ALL_SUBCLASSES, human, soldier } from '../../engine/test/fixtures.ts';
import {
  applyLevel,
  draftAdvancement,
  draftEntry,
  draftOutstanding,
  draftPicks,
  emptyDraft,
  gainLine,
  mergeGains,
  withAdvancement,
  withPicks,
} from '../src/level-up.ts';
import { ordinal, titleCase } from '../src/text.ts';

const content = inMemoryContent({
  classes: ALL_CLASSES,
  subclasses: ALL_SUBCLASSES,
  options: ALL_OPTIONS,
  items: ALL_ITEMS,
  feats: ALL_FEATS,
  races: [human],
  backgrounds: [soldier],
});

const ARRAY: AbilityScores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

function character(levels: readonly LevelEntry[] = []): CharacterDefinition {
  return {
    ruleset: '2014',
    packs: [],
    name: 'Test',
    abilityMethod: 'standard-array',
    abilities: ARRAY,
    levels,
    race: null,
    subrace: null,
    background: null,
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  };
}

const level = (classId: string, choices: readonly LevelChoice[] = []): LevelEntry => ({
  class: classId,
  hp: { mode: 'average' },
  choices,
});

test('a draft with picks and an advancement becomes one level entry with both', () => {
  const draft = withAdvancement(
    withPicks(
      withPicks(emptyDraft('fighter'), 'skill:fighter', ['athletics', 'perception']),
      'fighting-style',
      ['fighting-style-archery'],
    ),
    { kind: 'asi', increases: [{ ability: 'str', amount: 2 }] },
  );

  const entry = draftEntry(draft);
  assert.equal(entry.class, 'fighter');
  assert.deepEqual(draftPicks(draft, 'skill:fighter'), ['athletics', 'perception']);
  assert.deepEqual(draftPicks(draft, 'fighting-style'), ['fighting-style-archery']);
  assert.equal(entry.choices.length, 3);
});

test('a pool\'s picks are replaced, not appended, when the player changes their mind', () => {
  const first = withPicks(emptyDraft('rogue'), 'skill:rogue', ['stealth']);
  const second = withPicks(first, 'skill:rogue', ['stealth', 'perception']);

  assert.deepEqual(draftPicks(second, 'skill:rogue'), ['stealth', 'perception']);
  assert.equal(second.choices.length, 1, 'one entry for the pool, not two');
});

test('clearing a pool removes it, so a stale pick cannot linger on the level', () => {
  const draft = withPicks(emptyDraft('fighter'), 'fighting-style', ['fighting-style-archery']);
  assert.deepEqual(withPicks(draft, 'fighting-style', []).choices, []);
});

test('an ASI and a feat are the same slot: taking one clears the other', () => {
  const asi = withAdvancement(emptyDraft('fighter'), { kind: 'asi', increases: [{ ability: 'str', amount: 2 }] });
  const feat = withAdvancement(asi, { kind: 'feat', feat: 'tough' });

  assert.equal(feat.choices.length, 1);
  assert.equal(draftAdvancement(feat)?.kind, 'feat');
  assert.equal(draftAdvancement(withAdvancement(feat, null)), null);
});

test('committing a level appends one entry and changes nothing else', () => {
  const before = character([level('fighter')]);
  const after = applyLevel(before, withPicks(emptyDraft('fighter'), 'fighting-style', ['fighting-style-defense']));

  assert.equal(before.levels.length, 1, 'the original is untouched');
  assert.equal(after.levels.length, 2);
  assert.deepEqual(after.levels[1]?.choices, [{ kind: 'select', pool: 'fighting-style', picks: ['fighting-style-defense'] }]);
  assert.deepEqual(after.abilities, before.abilities);
});

test('a level-up knows what it is still waiting for, pool by pool', () => {
  const base = character([level('fighter'), level('fighter')]);
  const preview = previewLevel(base, content, { classId: 'fighter' });

  // 3rd level is the archetype level: one pool, one pick, no ASI.
  assert.deepEqual(draftOutstanding(preview, emptyDraft('fighter')), ['Subclass: choose 1 more.']);

  const chosen = withPicks(emptyDraft('fighter'), 'subclass:fighter', ['champion']);
  assert.deepEqual(draftOutstanding(preview, chosen), []);
});

test('a level that grants an ASI says so until one is taken', () => {
  const base = character([level('fighter'), level('fighter'), level('fighter')]);
  const preview = previewLevel(base, content, { classId: 'fighter' });

  assert.deepEqual(draftOutstanding(preview, emptyDraft('fighter')), [
    'Choose an ability score improvement or a feat.',
  ]);

  const taken = withAdvancement(emptyDraft('fighter'), { kind: 'feat', feat: 'tough' });
  assert.deepEqual(draftOutstanding(preview, taken), []);
});

test('a level that asks for nothing whatever is complete as it stands', () => {
  const base = character([level('fighter')]);
  const preview = previewLevel(base, content, { classId: 'fighter' });

  assert.deepEqual(draftOutstanding(preview, emptyDraft('fighter')), []);
});

test('a gain is written as a sentence, with the arithmetic behind the number', () => {
  const base = character([level('fighter')]);
  const preview = previewLevel(base, content, { classId: 'fighter' });

  const lines = preview.gains.map(gainLine);
  const hp = lines.find((line) => line.title === 'Hit points');
  // CON 13 is a +1: six on the average, plus one, is seven.
  assert.equal(hp?.value, '+7');
  assert.equal(hp?.detail, 'd10: 6 on the average and +1 Constitution.');

  const feature = lines.find((line) => line.title === 'Action Surge');
  assert.equal(feature?.detail, 'Fixture: take one extra action, once per rest.');
  assert.equal(feature?.tone, 'plain');
});

test('hit points that arrive with a Constitution increase say that the old levels move too', () => {
  const base = character([level('fighter'), level('fighter'), level('fighter')]);
  const preview = previewLevel(base, content, {
    classId: 'fighter',
    choices: [{ kind: 'asi', increases: [{ ability: 'con', amount: 2 }] }],
  });

  // CON 13 → 15 is +1 → +2, so this level takes 6 + 2 and the three already
  // taken each gain one.
  const hp = gainLine(preview.gains[0]!);
  assert.equal(hp.value, '+11');
  assert.equal(hp.detail, 'd10: 6 on the average and +2 Constitution, and your existing levels move with it.');
});

test('a first level is described as taking the die\'s best, not its average', () => {
  const preview = previewLevel(character(), content, { classId: 'wizard' });
  const hp = gainLine(preview.gains[0]!);

  assert.equal(hp.value, '+7');
  assert.equal(hp.detail, 'd6: 6 at 1st level, the die\'s best and +1 Constitution.');
});

test('a level with no Constitution modifier says so rather than showing +0', () => {
  const flat = { ...character([level('fighter')]), abilities: { ...ARRAY, con: 10 } };
  const preview = previewLevel(flat, content, { classId: 'fighter' });

  assert.equal(gainLine(preview.gains[0]!).detail, 'd10: 6 on the average and no Constitution modifier.');
  assert.equal(gainLine(preview.gains[0]!).value, '+6');
});

test('every gain the engine can report has words for it', () => {
  // A sweep, so a new gain kind cannot reach a screen with no sentence: the
  // switch in `gainLine` is exhaustive over `LevelGain` and this proves it runs.
  const base = character([level('fighter'), level('fighter'), level('fighter'), level('fighter')]);
  const preview = previewLevel(base, content, { classId: 'fighter' });

  for (const gain of preview.gains) {
    const line = gainLine(gain);
    assert.notEqual(line.title, '', `${gain.kind} has no title`);
    assert.notEqual(line.detail, '', `${gain.kind} has no detail`);
  }
  assert.equal(preview.gains.some((gain) => gain.kind === 'proficiency'), true, '5th level raises it');
  assert.equal(preview.gains.some((gain) => gain.kind === 'attacks'), true, 'Extra Attack');
});

test('a resource pool folds into the feature that grants it, rather than printing twice', () => {
  // Action Surge is a feature *and* the pool it creates. The pack names them
  // alike — "Action Surge" and `action-surge` — so the second sentence belongs
  // under the first, not beside it.
  const gains: LevelGain[] = [
    { kind: 'feature', name: 'Action Surge', summary: 'One extra action, once per rest.' },
    { kind: 'resource', id: 'action-surge', from: 0, to: 1, recharge: 'short' },
  ];

  const merged = mergeGains(gains);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], {
    kind: 'feature',
    name: 'Action Surge',
    summary: 'One extra action, once per rest. 1 use, recharging on a short rest.',
  });
});

test('a resource with no feature of that name keeps its own row', () => {
  const gains: LevelGain[] = [
    { kind: 'feature', name: 'Second Wind', summary: 'Regain hit points.' },
    { kind: 'resource', id: 'superiority-dice', from: 0, to: 4, recharge: 'short' },
  ];

  const merged = mergeGains(gains);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[1], { kind: 'resource', id: 'superiority-dice', from: 0, to: 4, recharge: 'short' });
});

test('folding a resource into a feature leaves every other gain where it was', () => {
  const gains: LevelGain[] = [
    { kind: 'hit-points', die: 10, base: 6, conModifier: 2, total: 8, beyondThisLevel: false, firstLevel: false },
    { kind: 'feature', name: 'Rage', summary: 'Bonus damage while raging.' },
    { kind: 'resource', id: 'rage', from: 0, to: 2, recharge: 'long' },
    { kind: 'proficiency', from: 2, to: 3 },
  ];

  const merged = mergeGains(gains);
  assert.deepEqual(merged.map((gain) => gain.kind), ['hit-points', 'feature', 'proficiency']);
  assert.equal((merged[1] as { summary: string }).summary.includes('2 uses'), true);
});

test('small text helpers behave at the awkward numbers', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');

  assert.equal(titleCase('sleight-of-hand'), 'Sleight Of Hand');
  assert.equal(titleCase('sneak-attack'), 'Sneak Attack');
});

test('a taken level replays identically, which is what makes the history trustworthy', () => {
  // The same character, built by committing a draft and by explaining the level
  // that came out of it: the two must agree, or the builder would tell a player
  // one thing at level-up and another when they looked back at it.
  const draft = withPicks(
    emptyDraft('rogue'),
    'skill:rogue',
    ['stealth', 'perception', 'insight', 'deception'],
  );
  const definition = character([level('fighter'), level('fighter'), level('fighter')]);
  const committed = applyLevel(definition, draft);

  const preview = previewLevel(definition, content, {
    classId: draft.classId,
    hp: draft.hp,
    choices: draft.choices,
  });
  const derived = derive(committed, content);

  assert.equal(derived.totalLevel, preview.totalLevel);
  assert.equal(derived.classLevels['rogue'], 1);
  assert.deepEqual(derived.diagnostics, [], 'a legal level makes no objection');
  assert.deepEqual(
    derived.skills.filter((skill) => skill.proficient).map((skill) => skill.id).sort(),
    ['deception', 'insight', 'perception', 'stealth'],
    'the picks the draft carried are on the sheet',
  );
});
