/**
 * The ability-score methods.
 *
 * Point buy's cost table is the one piece of arithmetic in the builder that a
 * player might check by hand, so it is asserted here against the book's own
 * numbers: 8 to 13 cost a point per step, and 14 and 15 cost two. The standard
 * array is asserted as a multiset, because the *arrangement* is the player's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Ability, AbilityScores } from '@agorath/engine';
import {
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  arrayRemaining,
  assignArrayValue,
  isStandardArray,
  pointBuyCost,
  pointsLeft,
  pointsSpent,
  seedFor,
  suggestedScores,
} from '../src/abilities.ts';

const scores = (over: Partial<Record<Ability, number>> = {}): AbilityScores => ({
  str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...over,
});

test('point buy costs a point per step to 13, and two for the last two points', () => {
  assert.equal(pointBuyCost(8), 0);
  assert.equal(pointBuyCost(13), 5);
  assert.equal(pointBuyCost(14), 7);
  assert.equal(pointBuyCost(15), 9);
  assert.equal(pointBuyCost(7), null, 'below the floor');
  assert.equal(pointBuyCost(16), null, 'above the ceiling, before racial increases');
});

test('the budget is 27, and the classic 15/15/15/8/8/8 spends 27 of it', () => {
  assert.equal(POINT_BUY_BUDGET, 27);

  const spiked = scores({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 });
  assert.equal(pointsSpent(spiked), 27);
  assert.equal(pointsLeft(spiked), 0);
});

test('an all-8 spread has spent nothing, and an illegal score makes the total unknown', () => {
  const floor = scores({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
  assert.equal(pointsSpent(floor), 0);
  assert.equal(pointsLeft(floor), 27);

  // 16 is not reachable with points, so there is no honest answer to give.
  assert.equal(pointsSpent(scores({ str: 16 })), null);
  assert.equal(pointsLeft(scores({ str: 16 })), null);
});

test('the standard array is recognised in any arrangement, and nothing else is', () => {
  const canonical = scores({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
  assert.equal(isStandardArray(canonical), true);

  const rearranged = scores({ str: 8, dex: 12, con: 15, int: 10, wis: 13, cha: 14 });
  assert.equal(isStandardArray(rearranged), true);

  assert.equal(isStandardArray(scores()), false, 'six tens are not the array');
  assert.equal(isStandardArray(scores({ str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 })), false);
});

test('the array reports what is left when it cannot account for a score', () => {
  const reassigned = scores({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 10 });
  assert.equal(arrayRemaining(reassigned), null, '10 is in the array once and used twice');
});

test('assigning an array value swaps with whoever holds it, so the pool always adds up', () => {
  const canonical = scores({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });

  // Move the 15 from Strength to Charisma. Charisma's 8 has to go somewhere.
  const moved = assignArrayValue(canonical, 'cha', 15);
  assert.equal(moved.cha, 15);
  assert.equal(moved.str, 8);
  assert.equal(isStandardArray(moved), true, 'still the array, whatever the arrangement');

  // A value nobody holds is simply placed; the arrangement is the player's
  // problem and the step says so.
  const off = assignArrayValue(canonical, 'cha', 11);
  assert.equal(off.cha, 11);
  assert.equal(isStandardArray(off), false);
});

test('a suggested spread puts the two best scores on the class\'s saving throws', () => {
  const fighter = suggestedScores(['str', 'con']);
  assert.equal(fighter.str, STANDARD_ARRAY[0]);
  assert.equal(fighter.con, STANDARD_ARRAY[1]);
  assert.deepEqual(
    Object.values(fighter).sort((a, b) => b - a),
    [...STANDARD_ARRAY],
    'and it is still the standard array',
  );

  // A class with no rules at all still gets a legal arrangement.
  const unknown = suggestedScores([]);
  assert.deepEqual(Object.values(unknown).sort((a, b) => b - a), [...STANDARD_ARRAY]);
});

test('choosing a method lays the scores out for it', () => {
  const pointBuy = seedFor('point-buy', ['str', 'con']);
  assert.deepEqual(Object.values(pointBuy), [8, 8, 8, 8, 8, 8], 'nothing spent yet');

  const array = seedFor('standard-array', ['dex', 'int']);
  assert.equal(array.dex, 15);
  assert.equal(array.int, 14);
  assert.equal(isStandardArray(array), true);
});
