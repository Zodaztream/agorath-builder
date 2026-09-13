/**
 * The shape of making a character, as a sequence of decisions.
 *
 * A beginner's problem is not that the builder lacks controls — it is that it
 * offers *all* of them at once, so nothing says which decision matters or what
 * a choice will do. So the builder is a short list of steps, one decision each,
 * and this module is that list: what the steps are, whether each is settled,
 * and what is still open.
 *
 * It is deliberately free of TSX and of any state of its own. The screens render
 * it; the tests test it; a step that is "settled" is settled by a rule you can
 * read here rather than by whatever the screen happens to remember.
 *
 * Nothing in here blocks. A player who jumps to the last step and exports gets a
 * character with holes in it and a list saying which holes — which is better
 * than a form that refuses to move.
 */

import type { CharacterDefinition, DerivedSheet, AbilityMethod } from '@agorath/engine';
import { isStandardArray, pointsSpent, POINT_BUY_BUDGET } from './abilities.ts';
import { titleCase } from './text.ts';

export type StepId =
  | 'class'
  | 'race'
  | 'background'
  | 'abilities'
  | 'choices'
  | 'equipment'
  | 'character';

export interface StepDefinition {
  readonly id: StepId;
  /** The rail label. One word where one word will do. */
  readonly short: string;
  readonly title: string;
  /** Why this step exists, for the player who wonders what it is for. */
  readonly blurb: string;
}

export const STEPS: readonly StepDefinition[] = [
  {
    id: 'class',
    short: 'Class',
    title: 'Choose a class',
    blurb:
      'Your class is what your character does: it decides your hit die, your saving throws, and most of what you will be able to do. Everything else follows from it.',
  },
  {
    id: 'race',
    short: 'Race',
    title: 'Choose a race',
    blurb:
      'Where you are from, and what that gave you. A race raises your ability scores and may grant more besides.',
  },
  {
    id: 'background',
    short: 'Background',
    title: 'Choose a background',
    blurb:
      'What you did before you started adventuring. It grants two skill proficiencies and a feature.',
  },
  {
    id: 'abilities',
    short: 'Abilities',
    title: 'Set your ability scores',
    blurb:
      'Six numbers that everything else is measured against: a 15 is a +2, and a +2 is what you add to a die. This is the step worth reading twice.',
  },
  {
    id: 'choices',
    short: 'Choices',
    title: 'Make your class choices',
    blurb:
      'What your class lets you pick: which skills you are trained in, and any first-level option. Each one says what it gives you.',
  },
  {
    id: 'equipment',
    short: 'Equipment',
    title: 'Choose your equipment',
    blurb:
      'What you carry. Armour sets your Armour Class and weapons become attack lines on the sheet, so this is where the numbers start to look like a character.',
  },
  {
    id: 'character',
    short: 'Character',
    title: 'Your character',
    blurb:
      'Every level you have, what each one gave you, and what is still open. Levelling up happens from here.',
  },
];

export const STEP_IDS: readonly StepId[] = STEPS.map((step) => step.id);

export function stepDefinition(id: StepId): StepDefinition {
  const found = STEPS.find((step) => step.id === id);
  // Unreachable: StepId is the union of the ids above.
  return found ?? (STEPS[0] as StepDefinition);
}

export interface FlowContext {
  readonly definition: CharacterDefinition;
  readonly sheet: DerivedSheet;
  /**
   * Steps the player has been through *this session*. Satisfaction alone is not
   * enough to tick a step: a player who is happy with all tens has settled the
   * ability step only once they have looked at it and said so.
   */
  readonly visited: ReadonlySet<StepId>;
}

/** Whether the character already satisfies the step, whoever has visited it. */
export function satisfied(id: StepId, ctx: FlowContext): boolean {
  const { definition, sheet } = ctx;

  switch (id) {
    case 'class':
      return definition.levels.length > 0;
    case 'race':
      return definition.race !== null;
    case 'background':
      return definition.background !== null;
    case 'abilities':
      return abilityStepSettled(definition);
    case 'choices':
      return sheet.selections.every((selection) => selection.picks.length >= selection.entitled);
    case 'equipment':
      return definition.inventory.length > 0;
    case 'character':
      return true;
  }
}

/**
 * A step is settled when the character satisfies it, or when the player has been
 * through it and moved on. Both are deliberate: the first keeps a finished
 * character's rail complete after a reload, the second lets a player who is
 * happy with the defaults say so by leaving.
 */
export function settled(id: StepId, ctx: FlowContext): boolean {
  return ctx.visited.has(id) || satisfied(id, ctx);
}

/**
 * The ability step, by method.
 *
 * "Enter them myself" cannot be checked against anything — any six numbers are
 * a legal character — so it is settled when the player has typed something,
 * which all-tens (the untouched default) is not. The other two have rules, and
 * the standard array's is exact.
 */
export function abilityStepSettled(definition: CharacterDefinition): boolean {
  const method: AbilityMethod = definition.abilityMethod ?? 'manual';

  if (method === 'standard-array') return isStandardArray(definition.abilities);
  if (method === 'point-buy') {
    const spent = pointsSpent(definition.abilities);
    return spent !== null && spent <= POINT_BUY_BUDGET;
  }
  return Object.values(definition.abilities).some((score) => score !== 10);
}

export interface StepStatus {
  readonly step: StepDefinition;
  readonly settled: boolean;
  /** One short line for the rail: what was chosen, or what is still missing. */
  readonly note: string;
}

export function stepStatuses(ctx: FlowContext): readonly StepStatus[] {
  return STEPS.map((step) => ({
    step,
    settled: settled(step.id, ctx),
    note: stepNote(step.id, ctx),
  }));
}

function stepNote(id: StepId, ctx: FlowContext): string {
  const { definition, sheet } = ctx;

  switch (id) {
    case 'class': {
      if (definition.levels.length === 0) return 'not chosen yet';
      const entries = Object.entries(sheet.classLevels).map(([classId, count]) => `${titleCase(classId)} ${count}`);
      return entries.join(' / ');
    }
    case 'race':
      return definition.race === null ? 'not chosen yet' : titleCase(definition.race.replace(/-/g, ' '));
    case 'background':
      return definition.background === null ? 'not chosen yet' : titleCase(definition.background.replace(/-/g, ' '));
    case 'abilities': {
      const method = definition.abilityMethod ?? 'manual';
      if (method === 'point-buy') {
        const spent = pointsSpent(definition.abilities);
        if (spent === null) return 'outside what point buy allows';
        return `${spent} of ${POINT_BUY_BUDGET} points spent`;
      }
      if (method === 'standard-array') return isStandardArray(definition.abilities) ? 'standard array' : 'not settled yet';
      return abilityStepSettled(definition) ? 'typed in' : 'not set yet';
    }
    case 'choices': {
      const offered = sheet.selections.filter((selection) => selection.entitled > 0);
      if (offered.length === 0) return 'nothing to choose yet';
      const taken = offered.reduce((sum, selection) => sum + selection.picks.length, 0);
      const total = offered.reduce((sum, selection) => sum + selection.entitled, 0);
      return taken >= total ? 'all chosen' : `${taken} of ${total} chosen`;
    }
    case 'equipment': {
      const count = definition.inventory.length;
      return count === 0 ? 'nothing carried' : `${count} item${count === 1 ? '' : 's'}`;
    }
    case 'character':
      return sheet.totalLevel === 0 ? 'no levels yet' : `level ${sheet.totalLevel}`;
  }
}

/** What is still open, as a list a screen can print. */
export interface Outstanding {
  readonly step: StepId;
  readonly text: string;
}

export function outstanding(ctx: FlowContext): readonly Outstanding[] {
  const { definition, sheet } = ctx;
  const open: Outstanding[] = [];

  if (definition.levels.length === 0) {
    open.push({ step: 'class', text: 'Take a first level: choose a class.' });
  }
  if (definition.race === null) open.push({ step: 'race', text: 'Choose a race.' });
  if (definition.background === null) open.push({ step: 'background', text: 'Choose a background.' });
  if (!abilityStepSettled(definition)) {
    open.push({ step: 'abilities', text: 'Settle your ability scores.' });
  }
  for (const selection of sheet.selections) {
    const short = selection.entitled - selection.picks.length;
    if (short <= 0) continue;
    open.push({
      step: 'choices',
      text: `${selection.label}: ${selection.picks.length} of ${selection.entitled} chosen.`,
    });
  }
  return open;
}

/** Where to put the player when they come back to a half-built character. */
export function firstOpenStep(ctx: FlowContext): StepId {
  for (const step of STEPS) {
    if (!settled(step.id, ctx)) return step.id;
  }
  return 'character';
}

export function stepAfter(id: StepId): StepId | null {
  const index = STEP_IDS.indexOf(id);
  return index === -1 || index === STEP_IDS.length - 1 ? null : (STEP_IDS[index + 1] ?? null);
}

export function stepBefore(id: StepId): StepId | null {
  const index = STEP_IDS.indexOf(id);
  return index <= 0 ? null : (STEP_IDS[index - 1] ?? null);
}
