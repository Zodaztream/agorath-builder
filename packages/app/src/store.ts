/**
 * The character being built, and the edits the screens make to it.
 *
 * The definition is the only thing that is ever stored — everything else on
 * screen is `derive(definition, pack)` computed during render. That is the
 * sanctioned architecture (ADR-0003): there is no state library, no cache of
 * derived numbers, and therefore nothing that can go stale.
 *
 * Choices are attached to level entries (ADR-0008), which is right in the data
 * and awkward in a form: a pool belongs to the *character*, not to a level, and
 * a player picks a fighting style once rather than once per level. `poolHomes`
 * resolves that by asking the engine where each pool first becomes available.
 */

import {
  derive,
  type Ability,
  type AbilityMethod,
  type AbilityScores,
  type CharacterDefinition,
  type ContentProvider,
  type InventoryItem,
  type LevelChoice,
  type LevelEntry,
} from '@agorath/engine';
import { seedFor } from './abilities.ts';

export const ABILITY_ORDER: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_LABELS: Readonly<Record<Ability, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/**
 * A new character, already legal.
 *
 * The six scores start as the standard array rather than as six tens, so that
 * the first thing a player sees on the ability step is a real arrangement to
 * move around rather than a blank form with no idea what a good number is. The
 * method is recorded with it, so the step reopens in the editor that produced
 * it.
 */
export function emptyDefinition(name = 'Unnamed character'): CharacterDefinition {
  return {
    ruleset: '2014',
    packs: [],
    name,
    abilityMethod: 'standard-array',
    abilities: seedFor('standard-array', []),
    levels: [],
    race: null,
    subrace: null,
    background: null,
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  };
}

export function setName(definition: CharacterDefinition, name: string): CharacterDefinition {
  return { ...definition, name };
}

export function setRace(definition: CharacterDefinition, race: string | null): CharacterDefinition {
  return { ...definition, race, subrace: null };
}

export function setBackground(definition: CharacterDefinition, background: string | null): CharacterDefinition {
  return { ...definition, background };
}

/**
 * Choose an ability method, and lay the scores out for it.
 *
 * The methods are not interchangeable — a 15 costs nine of point buy's
 * twenty-seven — so the seed is part of the choice rather than a separate
 * button. It is the one edit here that discards what the player had, which is
 * why the step says so before the click.
 */
export function setAbilityMethod(
  definition: CharacterDefinition,
  method: AbilityMethod,
  savingThrows: readonly Ability[],
): CharacterDefinition {
  return { ...definition, abilityMethod: method, abilities: seedFor(method, savingThrows) };
}

/** Replace all six scores at once — the array and point-buy editors do this. */
export function setAbilities(definition: CharacterDefinition, scores: AbilityScores): CharacterDefinition {
  return { ...definition, abilities: scores };
}

export function addLevel(definition: CharacterDefinition, classId: string): CharacterDefinition {
  const level: LevelEntry = { class: classId, hp: { mode: 'average' }, choices: [] };
  return { ...definition, levels: [...definition.levels, level] };
}

export function removeLevel(definition: CharacterDefinition, index: number): CharacterDefinition {
  return { ...definition, levels: definition.levels.filter((_, i) => i !== index) };
}

export function setLevel(definition: CharacterDefinition, index: number, patch: Partial<LevelEntry>): CharacterDefinition {
  return {
    ...definition,
    levels: definition.levels.map((level, i) => (i === index ? { ...level, ...patch } : level)),
  };
}

export function setAbility(definition: CharacterDefinition, ability: Ability, score: number): CharacterDefinition {
  return { ...definition, abilities: { ...definition.abilities, [ability]: score } };
}

/**
 * Replace the picks made from one pool, wherever they were recorded.
 *
 * Clearing the pool from *every* level first matters: a pool belongs to the
 * character, and leaving a stale copy on an earlier level would make the same
 * pick count twice — which the engine would rightly report as an
 * over-subscribed pool.
 */
export function setPicks(
  definition: CharacterDefinition,
  index: number,
  pool: string,
  picks: readonly string[],
): CharacterDefinition {
  const levels: LevelEntry[] = definition.levels.map((level, i) => {
    const others = level.choices.filter((choice) => !(choice.kind === 'select' && choice.pool === pool));
    const choices: readonly LevelChoice[] =
      i === index && picks.length > 0 ? [...others, { kind: 'select', pool, picks }] : others;
    return { ...level, choices };
  });
  return { ...definition, levels };
}

/** Set or clear the ASI-or-feat choice on one level entry. */
export function setAdvancement(
  definition: CharacterDefinition,
  index: number,
  choice: LevelChoice | null,
): CharacterDefinition {
  const level = definition.levels[index];
  if (level === undefined) return definition;

  const others = level.choices.filter((c) => c.kind !== 'asi' && c.kind !== 'feat');
  const choices: readonly LevelChoice[] = choice === null ? others : [...others, choice];
  return setLevel(definition, index, { choices });
}

export function addItem(definition: CharacterDefinition, item: InventoryItem): CharacterDefinition {
  return { ...definition, inventory: [...definition.inventory, item] };
}

export function setItem(definition: CharacterDefinition, index: number, patch: Partial<InventoryItem>): CharacterDefinition {
  return {
    ...definition,
    inventory: definition.inventory.map((item, i) => (i === index ? { ...item, ...patch } : item)),
  };
}

export function removeItem(definition: CharacterDefinition, index: number): CharacterDefinition {
  return { ...definition, inventory: definition.inventory.filter((_, i) => i !== index) };
}

// ---------------------------------------------------------------------------
// Where a pool's picks belong
// ---------------------------------------------------------------------------

const homeCache = new Map<string, Map<string, number>>();

/**
 * The level entry each offered pool should record its picks on: the first entry
 * at which the engine says the pool exists.
 *
 * Computed by deriving the character one level at a time, which is cheap (a
 * millisecond) and, more importantly, cannot disagree with the engine — the
 * alternative is re-implementing the class tables here, which is the exact
 * duplication the engine exists to prevent.
 *
 * Memoized on everything the answer depends on, which is the class sequence
 * *and* the choices already recorded: a pick can itself bring a pool into
 * existence (a feat's offer, an expertise), so two characters with the same
 * class sequence are not the same question. The level-up screen does not need
 * this — it knows which entry it is writing — but the builder does, for a pool
 * the player filled in later.
 */
export function poolHomes(
  definition: CharacterDefinition,
  content: ContentProvider,
): ReadonlyMap<string, number> {
  const key = definition.levels
    .map((level) => `${level.class}#${level.choices.map(choiceKey).join(';')}`)
    .join('|');
  const cached = homeCache.get(key);
  if (cached !== undefined) return cached;

  const homes = new Map<string, number>();
  for (let index = 0; index < definition.levels.length; index += 1) {
    const slice = { ...definition, levels: definition.levels.slice(0, index + 1) };
    for (const selection of derive(slice, content).selections) {
      if (!homes.has(selection.pool)) homes.set(selection.pool, index);
    }
  }

  if (homeCache.size > 32) homeCache.clear();
  homeCache.set(key, homes);
  return homes;
}

/** A short, stable signature of one level entry's choices, for the cache key. */
function choiceKey(choice: LevelChoice): string {
  switch (choice.kind) {
    case 'select':
      return `${choice.pool}:${choice.picks.join(',')}`;
    case 'asi':
      return `asi:${choice.increases.map((i) => `${i.ability}+${i.amount}`).join(',')}`;
    case 'feat':
      return `feat:${choice.feat}`;
    case 'other':
      return `other:${choice.id}=${choice.value}`;
  }
}

/** The picks currently recorded for a pool, wherever they sit. */
export function picksFor(definition: CharacterDefinition, pool: string): readonly string[] {
  for (const level of definition.levels) {
    for (const choice of level.choices) {
      if (choice.kind === 'select' && choice.pool === pool) return choice.picks;
    }
  }
  return [];
}
