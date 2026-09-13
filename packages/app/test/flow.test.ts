/**
 * The shape of the build.
 *
 * These tests are about the *promises the rail makes*: that a step reads as
 * settled only when there is something behind it, that a half-filled choice
 * shows as half-filled rather than as done, and that the review step's list of
 * what is missing is exactly the things that are missing. The content here is
 * the engine's own fixtures, so a change to what a class offers shows up here
 * rather than in a second, drifting copy of a fighter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { derive, inMemoryContent, type AbilityScores, type CharacterDefinition, type LevelEntry } from '@agorath/engine';
import { ALL_CLASSES, ALL_FEATS, ALL_ITEMS, ALL_OPTIONS, ALL_SUBCLASSES, human, soldier } from '../../engine/test/fixtures.ts';
import { STEPS, firstOpenStep, outstanding, satisfied, settled, stepStatuses, type FlowContext, type StepId } from '../src/flow.ts';
import { seedFor } from '../src/abilities.ts';

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

function character(over: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return {
    ruleset: '2014',
    packs: [],
    name: 'Test',
    abilityMethod: 'standard-array',
    abilities: ARRAY,
    levels: [],
    race: null,
    subrace: null,
    background: null,
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ...over,
  };
}

const level = (classId: string, choices: LevelEntry['choices'] = []): LevelEntry => ({
  class: classId,
  hp: { mode: 'average' },
  choices,
});

function context(definition: CharacterDefinition, visited: readonly StepId[] = []): FlowContext {
  return { definition, sheet: derive(definition, content), visited: new Set(visited) };
}

const note = (ctx: FlowContext, id: StepId): string =>
  stepStatuses(ctx).find((status) => status.step.id === id)?.note ?? '';

test('an empty character has settled only the step that asks nothing', () => {
  const ctx = context(character());

  assert.equal(satisfied('class', ctx), false);
  assert.equal(satisfied('race', ctx), false);
  assert.equal(satisfied('background', ctx), false);
  assert.equal(satisfied('choices', ctx), true, 'nothing is offered yet, so nothing is outstanding');
  assert.equal(satisfied('character', ctx), true, 'the last step is a summary, not a decision');
});

test('a step the player has been through is settled even when nothing satisfies it', () => {
  const ctx = context(character(), ['race']);

  assert.equal(satisfied('race', ctx), false, 'still no race chosen');
  assert.equal(settled('race', ctx), true, 'but they have looked at it and moved on');
});

test('the rail says what the character has, not just whether it is done', () => {
  const ctx = context(character({ levels: [level('fighter'), level('fighter')], race: 'human' }));

  assert.equal(note(ctx, 'class'), 'Fighter 2');
  assert.equal(note(ctx, 'race'), 'Human');
  assert.equal(note(ctx, 'background'), 'not chosen yet');
  assert.equal(note(ctx, 'choices'), '0 of 3 chosen', 'two skills and a fighting style');
  assert.equal(note(ctx, 'character'), 'level 2');
  assert.equal(note(ctx, 'equipment'), 'nothing carried');
});

test('multiclassing reads as two classes, not as one', () => {
  const ctx = context(character({ levels: [level('fighter'), level('fighter'), level('rogue')] }));
  assert.equal(note(ctx, 'class'), 'Fighter 2 / Rogue 1');
});

test('the final step summarises the levels and what is still open', () => {
  const ctx = context(character({ levels: [level('fighter')] }));
  const open = outstanding(ctx).map((item) => item.step);

  // Each unfilled pool is its own line, because each is its own decision.
  assert.deepEqual(open, ['race', 'background', 'choices', 'choices']);

  const texts = outstanding(ctx).map((item) => item.text);
  assert.deepEqual(texts, [
    'Choose a race.',
    'Choose a background.',
    'Skills: 0 of 2 chosen.',
    'Fighting Style: 0 of 1 chosen.',
  ]);
});

test('a character with everything decided has nothing outstanding', () => {
  const definition = character({
    race: 'human',
    background: 'soldier',
    levels: [level('fighter', [
      { kind: 'select', pool: 'skill:fighter', picks: ['athletics', 'perception'] },
      { kind: 'select', pool: 'fighting-style', picks: ['fighting-style-archery'] },
    ])],
  });

  assert.deepEqual(outstanding(context(definition)), []);

  const ctx = context(definition);
  const statuses = stepStatuses(ctx);
  assert.deepEqual(statuses.filter((s) => !s.settled).map((s) => s.step.id), ['equipment']);
});

test('resuming lands on the first step that is neither done nor visited', () => {
  const ctx = context(character({ levels: [level('fighter')] }), ['class']);
  assert.equal(firstOpenStep(ctx), 'race');

  const finished = context(character({
    race: 'human',
    background: 'soldier',
    levels: [level('fighter', [
      { kind: 'select', pool: 'skill:fighter', picks: ['athletics', 'perception'] },
      { kind: 'select', pool: 'fighting-style', picks: ['fighting-style-archery'] },
    ])],
  }));
  assert.equal(firstOpenStep(finished), 'equipment');
});

test('the ability step is settled by its own method\'s rule', () => {
  // The standard array has an exact rule: a 15 twice is not the array.
  assert.equal(satisfied('abilities', context(character())), true);
  assert.equal(
    satisfied('abilities', context(character({ abilities: { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 } }))),
    false,
  );

  // Point buy has a budget.
  const pointBuy = character({ abilityMethod: 'point-buy', abilities: seedFor('point-buy', []) });
  assert.equal(satisfied('abilities', context(pointBuy)), true, 'nothing spent is legal');
  assert.equal(
    satisfied('abilities', context({ ...pointBuy, abilities: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 } })),
    false,
    '36 points of a 27-point budget',
  );

  // Typing them in has no rule at all, so it is settled once something is typed.
  const manual = character({ abilityMethod: 'manual', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  assert.equal(satisfied('abilities', context(manual)), false);
  assert.equal(satisfied('abilities', context({ ...manual, abilities: { ...manual.abilities, str: 12 } })), true);
});

test('the steps are in the order a character is actually built', () => {
  assert.deepEqual(STEPS.map((step) => step.id), [
    'class', 'race', 'background', 'abilities', 'choices', 'equipment', 'character',
  ]);
  for (const step of STEPS) {
    assert.notEqual(step.title, '');
    assert.notEqual(step.blurb, '');
  }
});
