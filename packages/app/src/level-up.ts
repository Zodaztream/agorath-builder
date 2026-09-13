/**
 * Levelling: the draft of one level, and the words for what it gives you.
 *
 * Two jobs, both of which have to be right before the screen that shows them:
 * what a level *is* once the player has decided (the entry), and how each thing
 * the engine derived is put into a sentence. Neither is a rule — the numbers all
 * come from `previewLevel` in the engine — so this is the thin layer between a
 * derivation and a page, and it is plain TS so it can be tested without a
 * browser.
 *
 * The wording matters more than it looks. "You gain Action Surge" is a level-up
 * page; "fighter-action-surge" is a debug dump; and "+9 hit points" with no
 * arithmetic is the thing every new player asks about.
 */

import {
  type CharacterDefinition,
  type HitPointRoll,
  type LevelChoice,
  type LevelEntry,
  type LevelGain,
  type LevelUpPreview,
} from '@agorath/engine';
import { ordinal, signed, titleCase } from './text.ts';

/** One level under construction, before it is committed to the character. */
export interface LevelDraft {
  readonly classId: string;
  readonly hp: HitPointRoll;
  /** Everything this level decides: this level's picks, and its ASI or feat. */
  readonly choices: readonly LevelChoice[];
}

export function emptyDraft(classId: string): LevelDraft {
  return { classId, hp: { mode: 'average' }, choices: [] };
}

/** The level entry this draft describes, in the shape the definition stores. */
export function draftEntry(draft: LevelDraft): LevelEntry {
  return { class: draft.classId, hp: draft.hp, choices: draft.choices };
}

/**
 * Commit the level.
 *
 * One write, at the end: the picks are already carried inside the draft's
 * choices, so the level and everything it decided land together. There is no
 * moment where the character has a level whose choices are half-recorded.
 */
export function applyLevel(definition: CharacterDefinition, draft: LevelDraft): CharacterDefinition {
  return { ...definition, levels: [...definition.levels, draftEntry(draft)] };
}

/** Record this level's picks from one pool, replacing whatever was there. */
export function withPicks(draft: LevelDraft, pool: string, picks: readonly string[]): LevelDraft {
  const others = draft.choices.filter((choice) => !(choice.kind === 'select' && choice.pool === pool));
  const choices: readonly LevelChoice[] =
    picks.length === 0 ? others : [...others, { kind: 'select', pool, picks }];
  return { ...draft, choices };
}

/** Record this level's ASI-or-feat, replacing whatever was there. */
export function withAdvancement(draft: LevelDraft, choice: LevelChoice | null): LevelDraft {
  const others = draft.choices.filter((c) => c.kind !== 'asi' && c.kind !== 'feat');
  const choices: readonly LevelChoice[] = choice === null ? others : [...others, choice];
  return { ...draft, choices };
}

/** What this level's draft has picked from a pool. */
export function draftPicks(draft: LevelDraft, pool: string): readonly string[] {
  for (const choice of draft.choices) {
    if (choice.kind === 'select' && choice.pool === pool) return choice.picks;
  }
  return [];
}

/** The ASI or feat this level's draft has taken, if any. */
export function draftAdvancement(draft: LevelDraft): LevelChoice | null {
  return draft.choices.find((choice) => choice.kind === 'asi' || choice.kind === 'feat') ?? null;
}

/**
 * What this level still wants decided, phrased for the player.
 *
 * A level is not required to be complete — the engine would accept a fighter
 * with no fighting style — but a level-up screen should say what it is waiting
 * for rather than let a half-made decision scroll past.
 */
export function draftOutstanding(preview: LevelUpPreview, draft: LevelDraft): readonly string[] {
  const open: string[] = [];

  for (const offer of preview.offers) {
    const taken = draftPicks(draft, offer.pool).length;
    if (taken < offer.count) {
      open.push(`${offer.label}: choose ${offer.count - taken} more.`);
    }
  }
  if (preview.advancement !== null && draftAdvancement(draft) === null) {
    open.push('Choose an ability score improvement or a feat.');
  }
  return open;
}

/**
 * Fold a resource into the feature that grants it.
 *
 * Action Surge arrives twice from the derivation: once as the feature, with the
 * pack's own wording, and once as the resource pool it creates — "one use,
 * recharging on a short rest". Printed as two rows it reads as a duplication,
 * because it is one; folded, the second sentence lands under the feature it
 * belongs to, where D&D Beyond puts it too.
 *
 * The match is name against id, prettified, which is how the pack writes them:
 * feature "Action Surge", pool `action-surge`. A pool that matches nothing
 * keeps its own row, which is the honest failure — it means the pack names them
 * differently, not that the resource is missing.
 */
export function mergeGains(gains: readonly LevelGain[]): readonly LevelGain[] {
  const features = gains.filter((gain): gain is Extract<LevelGain, { kind: 'feature' }> => gain.kind === 'feature');
  const resources = gains.filter((gain): gain is Extract<LevelGain, { kind: 'resource' }> => gain.kind === 'resource');

  const folded = new Map<string, string>();
  for (const resource of resources) {
    const name = titleCase(resource.id);
    if (!features.some((feature) => feature.name.toLowerCase() === name.toLowerCase())) continue;
    folded.set(
      name.toLowerCase(),
      `${resource.to} use${resource.to === 1 ? '' : 's'}, recharging on a ${resource.recharge} rest.`,
    );
  }

  if (folded.size === 0) return gains;

  const out: LevelGain[] = [];
  for (const gain of gains) {
    if (gain.kind === 'resource' && folded.has(titleCase(gain.id).toLowerCase())) continue;
    if (gain.kind === 'feature') {
      const extra = folded.get(gain.name.toLowerCase());
      if (extra !== undefined) {
        out.push({ kind: 'feature', name: gain.name, summary: `${gain.summary} ${extra}`.trim() });
        continue;
      }
    }
    out.push(gain);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a level gives you, in words
// ---------------------------------------------------------------------------

export interface GainLine {
  readonly title: string;
  /** The number, shown beside the title. */
  readonly value: string;
  /** The explanation, shown under it. */
  readonly detail: string;
  /** `todo` marks something the player still has to decide on this screen. */
  readonly tone: 'plain' | 'number' | 'todo';
}

export function gainLine(gain: LevelGain): GainLine {
  switch (gain.kind) {
    case 'hit-points': {
      const die = `d${gain.die}`;
      const base = gain.firstLevel
        ? `${gain.base} at 1st level, the die's best`
        : `${gain.base} on the average`;
      const con =
        gain.conModifier === 0
          ? 'and no Constitution modifier'
          : `and ${signed(gain.conModifier)} Constitution`;
      const moves = gain.beyondThisLevel
        ? ', and your existing levels move with it'
        : '';
      return {
        title: 'Hit points',
        value: `+${gain.total}`,
        detail: `${die}: ${base} ${con}${moves}.`,
        tone: 'number',
      };
    }
    case 'feature':
      return { title: gain.name, value: '', detail: gain.summary, tone: 'plain' };
    case 'choice':
      return {
        title: gain.label,
        value: `choose ${gain.count}`,
        detail: 'This level opens this choice, below.',
        tone: 'todo',
      };
    case 'advancement':
      return {
        title: 'Ability Score Improvement',
        value: 'or a feat',
        detail: 'Either +2 to one ability score, +1 to two, or a feat instead.',
        tone: 'todo',
      };
    case 'proficiency':
      return {
        title: 'Proficiency bonus',
        value: `+${gain.to}`,
        detail: `Up from +${gain.from}. It applies to every skill, save and attack you are proficient with, not only to anything new.`,
        tone: 'number',
      };
    case 'slots': {
      const parts = gain.gained.map((slot) => `${ordinal(slot.level)}: ${slot.from} → ${slot.to}`);
      return {
        title: `Spell slots (${titleCase(gain.source)})`,
        value: `${gain.gained.length}`,
        detail: parts.join(', '),
        tone: 'number',
      };
    }
    case 'resource':
      return {
        title: titleCase(gain.id),
        value: `${gain.from === 0 ? '' : `${gain.from} → `}${gain.to}`,
        detail: `Recharges on a ${gain.recharge} rest.`,
        tone: 'number',
      };
    case 'attacks':
      return {
        title: 'Attacks per Attack action',
        value: `${gain.count}`,
        detail: 'You can attack this many times whenever you take the Attack action.',
        tone: 'number',
      };
    case 'crit-range':
      return {
        title: 'Critical hits',
        value: `${gain.minimum}+`,
        detail: 'Your weapon attacks score a critical hit on this roll or higher.',
        tone: 'number',
      };
  }
}

