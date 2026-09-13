/**
 * How the six numbers are arrived at.
 *
 * The ability scores are the one part of a character a beginner has no way to
 * judge. "Strength 15" says nothing on its own; what it means is that it is the
 * best score the standard array offers, that it costs nine of point buy's
 * twenty-seven, and that it is a +2 — so the builder offers the methods a table
 * actually uses and shows the arithmetic of each. Nothing here is a rule of the
 * game; it is the counting that a player would otherwise do on scrap paper.
 *
 * The scores in the definition are the *base* scores, before any race or feat
 * raises them. The engine adds those on top, so the builder shows both and the
 * player can see where each number came from. Point buy is scored against the
 * base, which is how the book defines it.
 */

import { ABILITIES, type Ability, type AbilityMethod, type AbilityScores } from '@agorath/engine';

/** The 2014 standard array. */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** Point buy: 27 points, scores from 8 to 15 before racial increases. */
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

/**
 * The cost of each score, indexed from 8. The 14 and 15 steps cost two, which
 * is the whole shape of the method: the last two points of a score are the
 * expensive ones.
 */
const COSTS: readonly number[] = [0, 1, 2, 3, 4, 5, 7, 9];

/** What one score costs, or null when it is outside what point buy allows. */
export function pointBuyCost(score: number): number | null {
  const index = score - POINT_BUY_MIN;
  if (index < 0 || index >= COSTS.length) return null;
  return COSTS[index] ?? null;
}

/** What the six scores cost together, or null when one of them is out of range. */
export function pointsSpent(scores: AbilityScores): number | null {
  let total = 0;
  for (const ability of ABILITIES) {
    const cost = pointBuyCost(scores[ability]);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

/** What is left of the budget, or null when a score is outside the range. */
export function pointsLeft(scores: AbilityScores): number | null {
  const spent = pointsSpent(scores);
  return spent === null ? null : POINT_BUY_BUDGET - spent;
}

/**
 * The values still to be placed, when the six scores are the standard array.
 *
 * Null when they are not: a score that is not in the array cannot be accounted
 * for, and quietly treating it as unassigned would let the step show a pool
 * that does not add up.
 */
export function arrayRemaining(scores: AbilityScores): readonly number[] | null {
  const pool = [...STANDARD_ARRAY];
  for (const ability of ABILITIES) {
    const index = pool.indexOf(scores[ability]);
    if (index === -1) return null;
    pool.splice(index, 1);
  }
  return pool;
}

/** True when the six scores are the standard array, in any order. */
export function isStandardArray(scores: AbilityScores): boolean {
  const remaining = arrayRemaining(scores);
  return remaining !== null && remaining.length === 0;
}

/**
 * A starting assignment for a class, when the player wants one.
 *
 * The two highest scores go to the class's saving-throw abilities, which is the
 * only statement the pack-free half of the engine makes about what a class
 * cares about — so it is offered as a starting point and named as one. It is
 * not advice about how to play, and the step says so.
 */
export function suggestedScores(savingThrows: readonly Ability[]): AbilityScores {
  const favoured = ABILITIES.filter((ability) => savingThrows.includes(ability));
  const rest = ABILITIES.filter((ability) => !savingThrows.includes(ability));

  const scores: Record<Ability, number> = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  const order = [...favoured, ...rest];
  order.forEach((ability, index) => {
    scores[ability] = STANDARD_ARRAY[index] ?? 8;
  });
  return scores;
}

/**
 * Put one of the array's values on an ability, swapping with whoever holds it.
 *
 * The pool is always exactly spent, so there is nothing to drag *from*: the way
 * to move a 15 from Strength to Dexterity is to give Dexterity the 15, and the
 * value that was there takes Strength's place. Every arrangement is therefore
 * legal at every keystroke, and the step never has to say "that was invalid".
 */
export function assignArrayValue(scores: AbilityScores, ability: Ability, value: number): AbilityScores {
  const holder = ABILITIES.find((candidate) => scores[candidate] === value);
  const displaced = scores[ability];
  return {
    ...scores,
    [ability]: value,
    ...(holder === undefined || holder === ability ? {} : { [holder]: displaced }),
  };
}

/**
 * What a method starts with, when the player chooses it.
 *
 * The methods are not interchangeable — a 15 costs nine of point buy's
 * twenty-seven, so an array is not a legal point-buy allocation — so choosing
 * one lays the scores out for it rather than leaving an arrangement that is
 * wrong for the method just picked.
 */
export function seedFor(method: AbilityMethod, savingThrows: readonly Ability[]): AbilityScores {
  if (method === 'point-buy') {
    // Everything at the floor: the budget is unspent, and the step says so.
    const scores: Record<Ability, number> = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    return scores;
  }
  // The array is a legal starting point for a player about to type their own
  // rolls as well: it is a shape to overwrite rather than a blank page.
  return suggestedScores(savingThrows);
}

/**
 * The methods, as a `Record` keyed by the union rather than an array — the same
 * trick the engine uses for its effect catalogue: adding a method to
 * `AbilityMethod` and forgetting it here is a type error, where an array would
 * simply drift.
 */
export const ABILITY_METHODS: Readonly<Record<AbilityMethod, true>> = {
  'standard-array': true,
  'point-buy': true,
  manual: true,
};

export const ABILITY_METHOD_ORDER: readonly AbilityMethod[] = Object.keys(
  ABILITY_METHODS,
) as readonly AbilityMethod[];

export const ABILITY_METHOD_LABELS: Readonly<Record<AbilityMethod, string>> = {
  'standard-array': 'Standard array',
  'point-buy': 'Point buy',
  manual: 'Enter them myself',
};

export const ABILITY_METHOD_BLURBS: Readonly<Record<AbilityMethod, string>> = {
  'standard-array':
    'Six fixed numbers — 15, 14, 13, 12, 10, 8 — placed wherever you like. The simplest way, and the one most tables start with.',
  'point-buy':
    'Twenty-seven points to spend. Higher scores cost more: 13 costs 5, and 15 costs 9. Balanced, and lets you choose exactly where your strengths are.',
  manual: 'Type the numbers you rolled at the table. The tool takes them as they are.',
};
