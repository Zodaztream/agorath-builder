/**
 * The level-up preview.
 *
 * The claim under test is the whole reason the builder can explain a level
 * without a table of its own: *a preview is the difference between two
 * derivations, and nothing else*. So the assertions below are about what the
 * diff produces — Action Surge on the second fighter level, an archetype offer
 * on the third, the ASI on the fourth, Extra Attack and a proficiency bonus on
 * the fifth — each of which a reader can check against the 2014 class tables.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inMemoryContent } from '../src/content.ts';
import { previewLevel, previewTakenLevel, type LevelGain } from '../src/preview.ts';
import { EMPTY_CURRENCY, type Ability, type CharacterDefinition, type LevelChoice, type LevelEntry } from '../src/types.ts';
import { ALL_CLASSES, ALL_FEATS, ALL_ITEMS, ALL_OPTIONS, ALL_SUBCLASSES, human, soldier } from './fixtures.ts';

const content = inMemoryContent({
  classes: ALL_CLASSES,
  subclasses: ALL_SUBCLASSES,
  options: ALL_OPTIONS,
  items: ALL_ITEMS,
  feats: ALL_FEATS,
  races: [human],
  backgrounds: [soldier],
});

function character(opts: {
  levels?: readonly LevelEntry[];
  abilities?: Partial<Record<Ability, number>>;
  race?: string | null;
  background?: string | null;
} = {}): CharacterDefinition {
  const abilities: Record<Ability, number> = { str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8 };
  for (const [k, v] of Object.entries(opts.abilities ?? {})) abilities[k as Ability] = v as number;
  return {
    ruleset: '2014',
    packs: [],
    name: 'Test',
    abilities,
    levels: opts.levels ?? [],
    race: opts.race ?? null,
    subrace: null,
    background: opts.background ?? null,
    inventory: [],
    currency: EMPTY_CURRENCY,
  };
}

const level = (classId: string, choices: readonly LevelChoice[] = []): LevelEntry => ({
  class: classId,
  hp: { mode: 'average' },
  choices,
});

/** The gains of one kind, narrowed for assertions. */
function gainsOf<K extends LevelGain['kind']>(
  gains: readonly LevelGain[],
  kind: K,
): Extract<LevelGain, { kind: K }>[] {
  return gains.filter((g): g is Extract<LevelGain, { kind: K }> => g.kind === kind);
}

test('the first level of a class reports its features, its offers and its hit die', () => {
  const preview = previewLevel(character(), content, { classId: 'fighter' });

  assert.equal(preview.classLevel, 1);
  assert.equal(preview.totalLevel, 1);
  assert.equal(preview.firstLevel, true);
  assert.equal(preview.hitDie, 10);

  const features = gainsOf(preview.gains, 'feature').map((g) => g.name);
  assert.deepEqual(features, ['Proficiencies', 'Skills', 'Fighting Style', 'Second Wind', 'Equipment']);

  // Four pools open at 1st level, and each says how many picks it adds. Two are
  // the class's own choices; two are the kit it starts with (ADR-0013), which a
  // first level asks for and a second one does not.
  assert.deepEqual(preview.offers.map((o) => [o.pool, o.count]), [
    ['skill:fighter', 2],
    ['fighting-style', 1],
    ['starting-equipment:fighter:armour', 1],
    ['starting-equipment:fighter:weapons', 1],
  ]);

  // At 1st level the die is taken at its maximum, not its average.
  const hp = gainsOf(preview.gains, 'hit-points')[0];
  assert.equal(hp?.base, 10);
  assert.equal(hp?.firstLevel, true);
  // CON 14 is +2, and a first-level fighter's 10 + 2 is the sheet's 12.
  assert.equal(hp?.conModifier, 2);
  assert.equal(hp?.total, 12);
});

test('a level is offered by the class table, so a second level of fighter is not an archetype level', () => {
  const definition = character({ levels: [level('fighter')] });
  const preview = previewLevel(definition, content, { classId: 'fighter' });

  assert.equal(preview.classLevel, 2);
  assert.equal(preview.totalLevel, 2);
  assert.deepEqual(gainsOf(preview.gains, 'feature').map((g) => g.name), ['Action Surge']);
  assert.deepEqual(preview.offers, []);
  assert.equal(preview.advancement, null);
});

test('the archetype offer appears on the level the class table says, and not before', () => {
  const first = previewLevel(character(), content, { classId: 'fighter' });
  const second = previewLevel(character({ levels: [level('fighter')] }), content, { classId: 'fighter' });
  const third = previewLevel(character({ levels: [level('fighter'), level('fighter')] }), content, { classId: 'fighter' });

  assert.equal(first.offers.some((o) => o.pool === 'subclass:fighter'), false);
  assert.equal(second.offers.some((o) => o.pool === 'subclass:fighter'), false);

  const archetype = third.offers.find((o) => o.pool === 'subclass:fighter');
  assert.notEqual(archetype, undefined);
  assert.equal(archetype?.count, 1);
  assert.deepEqual(archetype?.selection.candidates.map((c) => c.name), ['Champion']);
});

test('the ASI level says so, and the level that grants it is the class table\'s, not the character\'s', () => {
  const levels = [level('fighter'), level('fighter'), level('fighter')];
  const preview = previewLevel(character({ levels }), content, { classId: 'fighter' });

  assert.equal(preview.classLevel, 4);
  assert.equal(preview.advancement?.classLevel, 4);
  assert.equal(preview.advancement?.kind, 'asi-or-feat');
  assert.equal(preview.advancement?.taken, false);
  assert.deepEqual(gainsOf(preview.gains, 'advancement'), [{ kind: 'advancement', classLevel: 4 }]);
});

test('Extra Attack and the proficiency bonus arrive on the same level, and both are reported', () => {
  const levels = [level('fighter'), level('fighter'), level('fighter'), level('fighter')];
  const preview = previewLevel(character({ levels }), content, { classId: 'fighter' });

  assert.equal(preview.classLevel, 5);
  assert.deepEqual(gainsOf(preview.gains, 'attacks'), [{ kind: 'attacks', count: 2 }]);
  assert.deepEqual(gainsOf(preview.gains, 'proficiency'), [{ kind: 'proficiency', from: 2, to: 3 }]);
});

test('hit points move by the die and the constitution modifier, and say so', () => {
  const definition = character({ levels: [level('fighter')], abilities: { con: 16 } });
  const preview = previewLevel(definition, content, { classId: 'fighter' });

  const hp = gainsOf(preview.gains, 'hit-points')[0];
  assert.equal(hp?.base, 6, 'a d10 takes 6 on the average');
  assert.equal(hp?.conModifier, 3);
  assert.equal(hp?.total, 9);
});

test('a rolled hit die is the level\'s own business, not the preview\'s', () => {
  const definition = character({ levels: [level('fighter')] });
  const average = previewLevel(definition, content, { classId: 'fighter' });
  const rolled = previewLevel(definition, content, { classId: 'fighter', hp: { mode: 'rolled', value: 10 } });

  assert.equal(gainsOf(average.gains, 'hit-points')[0]?.total, 8);
  assert.equal(gainsOf(rolled.gains, 'hit-points')[0]?.total, 12);
});

test('a level that raises constitution moves the earlier levels too, and the preview reports what the sheet does', () => {
  // 4th is an ASI level for a fighter. CON 14 → 16 is +3 instead of +2 on this
  // level (6 + 3), *and* +1 on each of the three levels already taken. Before:
  // 12 + 8 + 8 = 28. After: 13 + 9 + 9 + 9 = 40. So the gain is 12, not 9 — and
  // the preview has to be able to say why.
  const levels = [level('fighter'), level('fighter'), level('fighter')];
  const definition = character({ levels, abilities: { con: 14 } });
  const preview = previewLevel(definition, content, {
    classId: 'fighter',
    choices: [{ kind: 'asi', increases: [{ ability: 'con', amount: 2 }] }],
  });

  const hp = gainsOf(preview.gains, 'hit-points')[0];
  assert.equal(hp?.conModifier, 3, 'the final Constitution is what the derivation uses');
  assert.equal(hp?.total, 12);
  assert.equal(hp?.beyondThisLevel, true, 'more than this level\'s own 6 + 3');
});

test('the taken level reads back the same as the preview said it would', () => {
  const levels = [level('fighter'), level('fighter'), level('fighter')];
  const asi: LevelChoice = { kind: 'asi', increases: [{ ability: 'con', amount: 2 }] };
  const definition = character({ levels, abilities: { con: 14 } });

  const preview = previewLevel(definition, content, { classId: 'fighter', choices: [asi] });
  const taken = previewTakenLevel(character({ levels: [...levels, level('fighter', [asi])], abilities: { con: 14 } }), content, 3);

  assert.notEqual(taken, null);
  assert.deepEqual(taken?.gains, preview.gains);
});

test('an unremarkable level is exactly its own share, and says so', () => {
  const preview = previewLevel(character({ levels: [level('fighter')] }), content, { classId: 'fighter' });

  const hp = gainsOf(preview.gains, 'hit-points')[0];
  assert.equal(hp?.total, 8);
  assert.equal(hp?.beyondThisLevel, false);
});

test('a class that casts reports the slots it gains, by spell level', () => {
  // A first-level wizard has two 1st-level slots, and none of anything else.
  const first = previewLevel(character(), content, { classId: 'wizard' });
  assert.deepEqual(gainsOf(first.gains, 'slots'), [
    { kind: 'slots', source: 'wizard', gained: [{ level: 1, from: 0, to: 2 }] },
  ]);

  // At 2nd level the table says three 1st-level slots, so the level adds one.
  const second = previewLevel(character({ levels: [level('wizard')] }), content, { classId: 'wizard' });
  assert.deepEqual(gainsOf(second.gains, 'slots'), [
    { kind: 'slots', source: 'wizard', gained: [{ level: 1, from: 2, to: 3 }] },
  ]);
});

test('a pick made at a level is reported as a choice, not twice as a feature', () => {
  const definition = character({ levels: [level('fighter')] });
  const preview = previewLevel(definition, content, {
    classId: 'fighter',
    choices: [{ kind: 'select', pool: 'fighting-style', picks: ['fighting-style-archery'] }],
  });

  const names = gainsOf(preview.gains, 'feature').map((g) => g.name);
  assert.equal(names.includes('Archery'), false, 'the picked option is not a feature of the level');
  assert.equal(names.includes('Action Surge'), true, 'the level\'s own features still are');
});

test('a feat taken at a level is the advancement, not a feature of the level', () => {
  const levels = [level('fighter'), level('fighter'), level('fighter')];
  const withFeat = [...levels, level('fighter', [{ kind: 'feat', feat: 'tough' }])];

  const preview = previewTakenLevel(character({ levels: withFeat }), content, 3);
  assert.equal(preview?.advancement?.taken, true);
  assert.equal(gainsOf(preview?.gains ?? [], 'feature').every((g) => g.name !== 'Tough'), true);

  // ...and it is still applied: six from the die, two from CON, Tough's two on
  // this level, and Tough's two on each of the three levels already taken.
  const hp = gainsOf(preview?.gains ?? [], 'hit-points')[0];
  assert.equal(hp?.total, 6 + 2 + 2 + 6);
  assert.equal(hp?.beyondThisLevel, true);
});

test('the second offer of a pool reports the raise, not the pool\'s whole entitlement', () => {
  // The champion's Additional Fighting Style is a second, separate offer of the
  // same pool at 10th level: 1 pick of entitlement becomes 2, and *this* level
  // adds one. A screen that showed "2 of 2" here would be asking for a pick the
  // player already made at 1st level.
  const archetype: LevelChoice = { kind: 'select', pool: 'subclass:fighter', picks: ['champion'] };
  const levels = [
    level('fighter'),
    level('fighter'),
    level('fighter', [archetype]),
    ...Array.from({ length: 6 }, () => level('fighter')),
  ];
  assert.equal(levels.length, 9);

  const preview = previewLevel(character({ levels }), content, { classId: 'fighter' });
  assert.equal(preview.classLevel, 10);

  const offer = preview.offers.find((o) => o.pool === 'fighting-style');
  assert.equal(offer?.count, 1);
  assert.equal(offer?.selection.entitled, 2, 'the pool as a whole is now worth two picks');
  assert.deepEqual(gainsOf(preview.gains, 'choice'), [{ kind: 'choice', pool: 'fighting-style', label: 'Fighting Style', count: 1 }]);
});

test('a second class reports its own features and leaves the first class alone', () => {
  const definition = character({ levels: [level('fighter'), level('fighter')] });
  const preview = previewLevel(definition, content, { classId: 'rogue' });

  assert.equal(preview.classLevel, 1, 'the rogue is 1st level even though the character is 3rd');
  assert.equal(preview.totalLevel, 3);

  const features = gainsOf(preview.gains, 'feature').map((g) => g.name);
  assert.equal(features.includes('Sneak Attack'), true);
  assert.equal(features.includes('Action Surge'), false, 'the fighter\'s features are not this level\'s');

  // Proficiency is by *total* level, so 3rd is still +2 either way.
  assert.deepEqual(gainsOf(preview.gains, 'proficiency'), []);
});

test('an unknown class is a problem on the preview, never a throw', () => {
  const preview = previewLevel(character(), content, { classId: 'artificer' });

  assert.equal(preview.classLevel, 1);
  assert.equal(preview.hitDie, 8, 'the fallback die, so the screen can still render');
  assert.equal(preview.problems.some((p) => p.includes('artificer')), true);
});

test('a bar for a level that was never taken is null', () => {
  assert.equal(previewTakenLevel(character(), content, 0), null);
  assert.equal(previewTakenLevel(character({ levels: [level('fighter')] }), content, 5), null);
});
