import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseExpression, ExpressionError, type ExpressionContext } from '../src/expression.ts';

const ctx: ExpressionContext = {
  totalLevel: 6,
  profBonus: 3,
  abilityScore: (a) => ({ str: 10, dex: 16, con: 14, int: 8, wis: 12, cha: 13 })[a],
  abilityMod: (a) => Math.floor((({ str: 10, dex: 16, con: 14, int: 8, wis: 12, cha: 13 })[a] - 10) / 2),
  classLevel: (id) => ({ bard: 5, rogue: 1 })[id] ?? 0,
  hasFeature: (id) => id === 'deft-explorer',
};

test('arithmetic and precedence', () => {
  assert.equal(evaluate('1 + 1', ctx), 2);
  assert.equal(evaluate('2 + 3 * 4', ctx), 14);
  assert.equal(evaluate('(2 + 3) * 4', ctx), 20);
  assert.equal(evaluate('10 - 2 - 3', ctx), 5);
  assert.equal(evaluate('8 / 2 / 2', ctx), 2);
  assert.equal(evaluate('-5 + 2', ctx), -3);
});

test('identifiers', () => {
  assert.equal(evaluate('totalLevel', ctx), 6);
  assert.equal(evaluate('profBonus', ctx), 3);
  assert.equal(evaluate('totalLevel * 2', ctx), 12);
});

test('ability functions take a bare or quoted name, case-insensitively', () => {
  assert.equal(evaluate('abilityMod(DEX)', ctx), 3);
  assert.equal(evaluate('abilityMod(dex)', ctx), 3);
  assert.equal(evaluate('abilityMod("DEX")', ctx), 3);
  assert.equal(evaluate('abilityScore(CHA)', ctx), 13);
  // The real unarmoured defence formula.
  assert.equal(evaluate('10 + abilityMod(DEX) + abilityMod(WIS)', ctx), 10 + 3 + 1);
});

test('class levels and hyphenated feature ids', () => {
  assert.equal(evaluate('classLevel(bard)', ctx), 5);
  assert.equal(evaluate('classLevel(rogue)', ctx), 1);
  assert.equal(evaluate('classLevel(wizard)', ctx), 0);
  // A hyphen is an operator, so a hyphenated id must be quoted.
  assert.equal(evaluate('hasFeature("deft-explorer")', ctx), 1);
  assert.equal(evaluate('hasFeature("something-else")', ctx), 0);
});

test('numeric functions', () => {
  assert.equal(evaluate('floor(classLevel(bard) / 2)', ctx), 2);
  assert.equal(evaluate('ceil(classLevel(bard) / 2)', ctx), 3);
  assert.equal(evaluate('max(1, abilityMod(INT))', ctx), 1);
  assert.equal(evaluate('max(1, abilityMod(DEX))', ctx), 3);
  assert.equal(evaluate('min(2, abilityMod(DEX))', ctx), 2);
  assert.equal(evaluate('max(1, 2, 3, 0)', ctx), 3);
});

test('unknown names are refused, not silently zero', () => {
  assert.throws(() => evaluate('nonsense', ctx), ExpressionError);
  assert.throws(() => evaluate('nonsense()', ctx), ExpressionError);
  assert.throws(() => evaluate('abilityMod(WISDOM)', ctx), ExpressionError);
  assert.throws(() => evaluate('abilityMod()', ctx), ExpressionError);
  assert.throws(() => evaluate('abilityMod(DEX, STR)', ctx), ExpressionError);
});

test('malformed input is refused', () => {
  assert.throws(() => evaluate('1 +', ctx), ExpressionError);
  assert.throws(() => evaluate('(1 + 2', ctx), ExpressionError);
  assert.throws(() => evaluate('1 + 2)', ctx), ExpressionError);
  assert.throws(() => evaluate('1 / 0', ctx), ExpressionError);
  assert.throws(() => evaluate('', ctx), ExpressionError);
  assert.throws(() => evaluate('1 @ 2', ctx), ExpressionError);
});

test('parsing and evaluation are separate steps', () => {
  const ast = parseExpression('10 + abilityMod(DEX)');
  assert.equal(ast.kind, 'binary');
});
