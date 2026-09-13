/**
 * A tiny sandboxed expression language, evaluated over a character.
 *
 * This is what lets a formula be *data* rather than code. Content writes a
 * string like `10 + abilityMod(DEX) + abilityMod(WIS)`; the engine parses and
 * evaluates it against a fixed set of identifiers.
 *
 * There is no assignment, no function definition, no property access, and no
 * call outside the whitelist below. An expression naming an unknown identifier
 * throws, so it fails loudly at pack-build time rather than quietly evaluating
 * to zero at the table.
 *
 * Function arguments that name a thing — an ability, a class id, a feature id —
 * take a *name*, not an expression: a bare word (`DEX`, `bard`) or a quoted
 * string when the name contains a character that would otherwise be an operator
 * (`"deft-explorer"`).
 */

import type { Ability } from './types.ts';

export interface ExpressionContext {
  readonly totalLevel: number;
  readonly profBonus: number;
  readonly abilityScore: (ability: Ability) => number;
  readonly abilityMod: (ability: Ability) => number;
  readonly classLevel: (classId: string) => number;
  readonly hasFeature: (featureId: string) => boolean;
}

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type ExprNode =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'ident'; readonly name: string }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly ExprNode[] }
  | { readonly kind: 'unary'; readonly op: '-'; readonly operand: ExprNode }
  | {
      readonly kind: 'binary';
      readonly op: '+' | '-' | '*' | '/';
      readonly left: ExprNode;
      readonly right: ExprNode;
    };

/** Bare identifiers, which take no arguments and no parentheses. */
const VALUE_IDENTIFIERS: readonly string[] = ['totalLevel', 'profBonus'];

/** Functions whose single argument is a name. */
const NAME_FUNCTIONS: readonly string[] = ['abilityScore', 'abilityMod', 'classLevel', 'hasFeature'];

/** Functions whose arguments are numbers. */
const NUMERIC_FUNCTIONS: readonly string[] = ['floor', 'ceil', 'max', 'min'];

export const ABILITY_ABBREVIATIONS: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Every callable the language knows. Used by the pack validator. */
export const KNOWN_FUNCTIONS: readonly string[] = [...NAME_FUNCTIONS, ...NUMERIC_FUNCTIONS];

/** Every identifier the language knows, bare or callable. */
export const KNOWN_IDENTIFIERS: readonly string[] = [...VALUE_IDENTIFIERS, ...KNOWN_FUNCTIONS];

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'number' | 'ident' | 'string' | 'op' | 'paren' | 'comma' | 'eof';

interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly at: number;
}

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < source.length && /[0-9.]/.test(source[i] as string)) i += 1;
      tokens.push({ type: 'number', value: source.slice(start, i), at: start });
      continue;
    }

    // Identifiers exclude '-' so that subtraction works. A name containing a
    // hyphen is written as a quoted string instead.
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i] as string)) i += 1;
      tokens.push({ type: 'ident', value: source.slice(start, i), at: start });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      let value = '';
      while (i < source.length && source[i] !== ch) {
        value += source[i] as string;
        i += 1;
      }
      if (i >= source.length) {
        throw new ExpressionError(`Unterminated string starting at position ${start} in ${JSON.stringify(source)}`);
      }
      i += 1; // closing quote
      tokens.push({ type: 'string', value, at: start });
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch, at: i });
      i += 1;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch, at: i });
      i += 1;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',', at: i });
      i += 1;
      continue;
    }

    throw new ExpressionError(`Unexpected character '${ch}' at position ${i} in ${JSON.stringify(source)}`);
  }
  tokens.push({ type: 'eof', value: '', at: source.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser — recursive descent
// ---------------------------------------------------------------------------

export function parseExpression(source: string): ExprNode {
  const tokens = tokenize(source);
  let pos = 0;

  const peek = (): Token => tokens[pos] as Token;
  const next = (): Token => {
    const t = tokens[pos] as Token;
    pos += 1;
    return t;
  };

  const expect = (value: string): void => {
    const t = peek();
    if (t.value !== value) {
      throw new ExpressionError(
        `Expected '${value}' but found ${describe(t)} at position ${t.at} in ${JSON.stringify(source)}`,
      );
    }
    next();
  };

  /** A name argument: a bare word, or a quoted string when it has a hyphen. */
  const parseNameArgument = (fn: string): ExprNode => {
    const t = next();
    if (t.type === 'ident' || t.type === 'string') return { kind: 'name', value: t.value };
    throw new ExpressionError(
      `${fn}() expects a name (a bare word, or a quoted string) but found ${describe(t)} at position ${t.at} in ${JSON.stringify(source)}`,
    );
  };

  function parsePrimary(): ExprNode {
    const t = next();

    if (t.type === 'number') {
      const value = Number(t.value);
      if (!Number.isFinite(value)) {
        throw new ExpressionError(`Invalid number '${t.value}' in ${JSON.stringify(source)}`);
      }
      return { kind: 'number', value };
    }

    if (t.type === 'string') {
      throw new ExpressionError(
        `A quoted string is only valid as a function argument, at position ${t.at} in ${JSON.stringify(source)}`,
      );
    }

    if (t.type === 'ident') {
      if (peek().value === '(') {
        if (!KNOWN_FUNCTIONS.includes(t.value)) {
          throw new ExpressionError(
            `Unknown function '${t.value}' in ${JSON.stringify(source)}. Known functions: ${KNOWN_FUNCTIONS.join(', ')}`,
          );
        }
        next(); // consume '('
        const args: ExprNode[] = [];

        if (NAME_FUNCTIONS.includes(t.value)) {
          if (peek().value === ')') {
            throw new ExpressionError(`${t.value}() needs one argument in ${JSON.stringify(source)}`);
          }
          args.push(parseNameArgument(t.value));
          if (peek().value === ',') {
            throw new ExpressionError(`${t.value}() takes exactly one argument in ${JSON.stringify(source)}`);
          }
        } else if (peek().value !== ')') {
          args.push(parseArithmetic());
          while (peek().value === ',') {
            next();
            args.push(parseArithmetic());
          }
        }

        expect(')');
        return { kind: 'call', name: t.value, args };
      }

      if (!VALUE_IDENTIFIERS.includes(t.value)) {
        throw new ExpressionError(
          `Unknown identifier '${t.value}' in ${JSON.stringify(source)}. Known identifiers: ${KNOWN_IDENTIFIERS.join(', ')}`,
        );
      }
      return { kind: 'ident', name: t.value };
    }

    if (t.value === '(') {
      const inner = parseArithmetic();
      expect(')');
      return inner;
    }

    if (t.value === '-') {
      return { kind: 'unary', op: '-', operand: parsePrimary() };
    }

    throw new ExpressionError(`Unexpected ${describe(t)} at position ${t.at} in ${JSON.stringify(source)}`);
  }

  function parseTerm(): ExprNode {
    let left = parsePrimary();
    for (;;) {
      const t = peek();
      if (t.type === 'op' && (t.value === '*' || t.value === '/')) {
        next();
        left = { kind: 'binary', op: t.value as '*' | '/', left, right: parsePrimary() };
      } else {
        break;
      }
    }
    return left;
  }

  function parseArithmetic(): ExprNode {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        next();
        left = { kind: 'binary', op: t.value as '+' | '-', left, right: parseTerm() };
      } else {
        break;
      }
    }
    return left;
  }

  const root = parseArithmetic();
  const trailing = peek();
  if (trailing.type !== 'eof') {
    throw new ExpressionError(
      `Unexpected '${trailing.value}' after the end of the expression at position ${trailing.at} in ${JSON.stringify(source)}`,
    );
  }
  return root;
}

function describe(t: Token): string {
  return t.type === 'eof' ? 'the end of the expression' : `'${t.value}'`;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function toAbility(raw: string, source: string): Ability {
  const lower = raw.toLowerCase();
  if ((ABILITY_ABBREVIATIONS as readonly string[]).includes(lower)) return lower as Ability;
  throw new ExpressionError(
    `'${raw}' is not an ability abbreviation in ${JSON.stringify(source)}. Expected one of: ${ABILITY_ABBREVIATIONS.join(', ')}`,
  );
}

function nameOf(node: ExprNode, fn: string, source: string): string {
  if (node.kind === 'name') return node.value;
  throw new ExpressionError(`${fn}() expects a name argument in ${JSON.stringify(source)}`);
}

function requireArity(name: string, args: readonly ExprNode[], expected: number, source: string): void {
  if (args.length !== expected) {
    throw new ExpressionError(
      `${name}() takes ${expected} argument${expected === 1 ? '' : 's'} but got ${args.length} in ${JSON.stringify(source)}`,
    );
  }
}

export function evaluateExpression(node: ExprNode, ctx: ExpressionContext, source = ''): number {
  switch (node.kind) {
    case 'number':
      return node.value;

    case 'name':
      throw new ExpressionError(`A bare name '${node.value}' is not a value in ${JSON.stringify(source)}`);

    case 'ident':
      if (node.name === 'totalLevel') return ctx.totalLevel;
      if (node.name === 'profBonus') return ctx.profBonus;
      throw new ExpressionError(`Unknown identifier '${node.name}'`);

    case 'unary':
      return -evaluateExpression(node.operand, ctx, source);

    case 'binary': {
      const l = evaluateExpression(node.left, ctx, source);
      const r = evaluateExpression(node.right, ctx, source);
      switch (node.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          if (r === 0) throw new ExpressionError(`Division by zero in ${JSON.stringify(source)}`);
          return l / r;
      }
    }

    case 'call': {
      const { name, args } = node;

      if (name === 'abilityScore' || name === 'abilityMod') {
        requireArity(name, args, 1, source);
        const ability = toAbility(nameOf(args[0] as ExprNode, name, source), source);
        return name === 'abilityScore' ? ctx.abilityScore(ability) : ctx.abilityMod(ability);
      }

      if (name === 'classLevel') {
        requireArity(name, args, 1, source);
        return ctx.classLevel(nameOf(args[0] as ExprNode, name, source));
      }

      if (name === 'hasFeature') {
        requireArity(name, args, 1, source);
        return ctx.hasFeature(nameOf(args[0] as ExprNode, name, source)) ? 1 : 0;
      }

      if (NUMERIC_FUNCTIONS.includes(name)) {
        if (args.length === 0) {
          throw new ExpressionError(`${name}() needs at least one argument in ${JSON.stringify(source)}`);
        }
        const values = args.map((a) => evaluateExpression(a, ctx, source));
        if (name === 'floor') {
          requireArity(name, args, 1, source);
          return Math.floor(values[0] as number);
        }
        if (name === 'ceil') {
          requireArity(name, args, 1, source);
          return Math.ceil(values[0] as number);
        }
        if (name === 'max') return Math.max(...values);
        if (name === 'min') return Math.min(...values);
      }

      throw new ExpressionError(`Unknown function '${name}'`);
    }
  }
  throw new ExpressionError(`Unhandled expression in ${JSON.stringify(source)}`);
}

/** Parse and evaluate in one step. */
export function evaluate(source: string, ctx: ExpressionContext): number {
  const result = evaluateExpression(parseExpression(source), ctx, source);
  if (!Number.isFinite(result)) {
    throw new ExpressionError(`Expression ${JSON.stringify(source)} did not produce a finite number`);
  }
  return result;
}
