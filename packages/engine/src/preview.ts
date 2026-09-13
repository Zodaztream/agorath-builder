/**
 * What taking a level gives you.
 *
 * A level-up screen has one job: say what you get, in the order you should read
 * it, before you commit to it. The trap is that the obvious way to build one — a
 * table in the UI, "2nd level gives Action Surge" — is a second copy of every
 * class table, and it is wrong the first time a pack disagrees with it.
 *
 * So nothing here is authored. A preview is the **difference between two
 * derivations**: `derive()` with the level, and `derive()` without it. A pack
 * feature therefore explains itself on the level it arrives, with no per-class
 * code anywhere, and a subclass written next year gets a level-up page for free.
 *
 * Two consequences worth stating, because they are the reason this lives in the
 * engine rather than in the app:
 *
 * - The preview is *exact* about the character it is previewing. A wizard taking
 *   a level with CON 14 sees a different hit point gain than the same wizard
 *   with CON 8, and a second class does not change the first class's table,
 *   because both come out of `derive` rather than out of arithmetic here.
 * - It can explain a level that was *already taken*, by replaying it: derive the
 *   character without that entry, add the entry back with the choices recorded
 *   on it, and diff. That is why `LevelPlan` accepts `choices`.
 */

import {
  type CharacterDefinition,
  type DerivedAdvancement,
  type DerivedNote,
  type DerivedSelection,
  type DerivedSheet,
  type HitPointRoll,
  type LevelChoice,
} from './types.ts';

import { averageHitPoints, classRules } from './rules.ts';
import { derive } from './derive.ts';
import type { ContentProvider } from './content.ts';

/** The level being contemplated, and anything already decided about it. */
export interface LevelPlan {
  readonly classId: string;
  /** How this level's hit points are taken. Defaults to the average. */
  readonly hp?: HitPointRoll;
  /**
   * Choices already made at this level. Empty for a level not yet taken, which
   * is the common case; filled in when re-explaining a level from the past.
   */
  readonly choices?: readonly LevelChoice[];
}

/** One spell slot level that moved, as `from` → `to` (0 → 2 is "you gain two"). */
export interface SlotGain {
  /** Spell level, 1–9. */
  readonly level: number;
  readonly from: number;
  readonly to: number;
}

/**
 * One thing a level confers.
 *
 * A tagged union rather than a sentence, so the screen can give each its own
 * weight — a feature is prose, hit points are a number, a choice is something to
 * do — and so a new kind is a compile error at every place that renders one
 * rather than a silently missing row.
 */
export type LevelGain =
  /** A feature, exactly as the pack words it. */
  | { readonly kind: 'feature'; readonly name: string; readonly summary: string }
  /** A pool this level opens, and how many picks it adds to it. */
  | { readonly kind: 'choice'; readonly pool: string; readonly label: string; readonly count: number }
  /** An Ability Score Improvement, which is an ASI *or* a feat. */
  | { readonly kind: 'advancement'; readonly classLevel: number }
  | {
      readonly kind: 'hit-points';
      readonly die: number;
      /** The die's contribution: its maximum at 1st level, its average after. */
      readonly base: number;
      /**
       * The Constitution modifier the level's own hit points are computed with,
       * which is the character's *final* one — the derivation applies every
       * effect before adding anything up, so a level that raises CON raises its
       * own hit points too.
       */
      readonly conModifier: number;
      /** What the sheet's maximum actually moves by, all effects included. */
      readonly total: number;
      /**
       * True when the total is not simply this level's share — because a
       * Constitution increase, or a "per level" effect like Tough, also moves
       * every level already taken. The screen has to say so, or "+12" next to
       * "d10: 6 + CON 3" reads as an arithmetic error.
       */
      readonly beyondThisLevel: boolean;
      readonly firstLevel: boolean;
    }
  | { readonly kind: 'proficiency'; readonly from: number; readonly to: number }
  | { readonly kind: 'slots'; readonly source: string; readonly gained: readonly SlotGain[] }
  | {
      readonly kind: 'resource';
      readonly id: string;
      readonly from: number;
      readonly to: number;
      readonly recharge: 'short' | 'long';
    }
  /** Extra Attack, or a second one. */
  | { readonly kind: 'attacks'; readonly count: number }
  | { readonly kind: 'crit-range'; readonly minimum: number };

/** A pool this level opens, with the pool itself there to be rendered. */
export interface LevelOffer {
  readonly pool: string;
  readonly label: string;
  /** How many picks *this level* adds — not the pool's whole entitlement. */
  readonly count: number;
  /** The pool as the finished sheet sees it: candidates, entitlement, picks. */
  readonly selection: DerivedSelection;
}

export interface LevelUpPreview {
  readonly classId: string;
  /** The character's class level after taking it. */
  readonly classLevel: number;
  /** The character's total level after taking it. */
  readonly totalLevel: number;
  /** True when this would be the character's first level of any class. */
  readonly firstLevel: boolean;
  readonly hitDie: number;
  readonly hitPoints: {
    readonly die: number;
    readonly base: number;
    readonly conModifier: number;
    readonly firstLevel: boolean;
  };
  /** New features, in the order the pack lists them. */
  readonly features: readonly DerivedNote[];
  /** Pools this level opens, ready to render a picker for. */
  readonly offers: readonly LevelOffer[];
  /** The ASI-or-feat this level grants, when it grants one. */
  readonly advancement: DerivedAdvancement | null;
  /** Everything above, in the order a player should read it. */
  readonly gains: readonly LevelGain[];
  /**
   * Rule objections this level would *add*. Normally empty — a level is offered
   * by a class table, which is not a thing that can be illegal — but a pack that
   * is missing the class, or a level whose recorded choices no longer validate,
   * says so here rather than in silence.
   */
  readonly problems: readonly string[];
}

/**
 * What taking this level would do.
 *
 * Total: an unknown class, an empty pack or a level that breaks a rule all come
 * back as a preview with `problems`, never as a throw. The screen that asks the
 * question has to be able to show the answer.
 */
export function previewLevel(
  definition: CharacterDefinition,
  content: ContentProvider,
  plan: LevelPlan,
): LevelUpPreview {
  const index = definition.levels.length;

  const entry = {
    class: plan.classId,
    hp: plan.hp ?? ({ mode: 'average' } as HitPointRoll),
    choices: plan.choices ?? [],
  };

  const before = definition;
  const after: CharacterDefinition = { ...definition, levels: [...definition.levels, entry] };

  const beforeSheet = derive(before, content);
  const afterSheet = derive(after, content);

  const rules = classRules(plan.classId);
  const hitDie = rules?.hitDie ?? 8;
  const firstLevel = index === 0;
  const base = firstLevel ? hitDie : averageHitPoints(hitDie);
  const conModifier = afterSheet.abilities.con.modifier;
  const ownShare = Math.max(1, base + conModifier);

  return build(
    plan.classId,
    index,
    beforeSheet,
    afterSheet,
    {
      hitDie,
      base,
      conModifier,
      firstLevel,
      beyondThisLevel: afterSheet.hitPoints.maximum - beforeSheet.hitPoints.maximum !== ownShare,
      // `after` includes the level's own features, and any choices recorded on
      // it, so this is the true movement of the sheet's maximum — a level that
      // raises CON moves every earlier level's hit points with it, and the
      // preview says so rather than reporting the die alone.
      hitPointGain: afterSheet.hitPoints.maximum - beforeSheet.hitPoints.maximum,
    },
    entry.choices,
  );
}

/**
 * What the level at `index` gave the character, replayed from the entry itself.
 *
 * Null when there is no such level. This is what makes the builder able to show
 * a character's history: every level already taken is explained by the same
 * machinery as the one about to be taken, so the two can never disagree.
 */
export function previewTakenLevel(
  definition: CharacterDefinition,
  content: ContentProvider,
  index: number,
): LevelUpPreview | null {
  const entry = definition.levels[index];
  if (entry === undefined) return null;

  const truncated: CharacterDefinition = { ...definition, levels: definition.levels.slice(0, index) };
  return previewLevel(truncated, content, { classId: entry.class, hp: entry.hp, choices: entry.choices });
}

// ---------------------------------------------------------------------------

interface HitPointFacts {
  readonly hitDie: number;
  readonly base: number;
  readonly conModifier: number;
  readonly firstLevel: boolean;
  readonly beyondThisLevel: boolean;
  readonly hitPointGain: number;
}

function build(
  classId: string,
  index: number,
  beforeSheet: DerivedSheet,
  afterSheet: DerivedSheet,
  hp: HitPointFacts,
  choices: readonly LevelChoice[],
): LevelUpPreview {
  const classLevel = afterSheet.classLevels[classId] ?? 0;
  const totalLevel = afterSheet.totalLevel;

  const features = newNotes(beforeSheet, afterSheet, choices);
  const offers = newOffers(beforeSheet, afterSheet);
  const advancement = afterSheet.advancements.find((a) => a.level === index) ?? null;

  const gains: LevelGain[] = [
    {
      kind: 'hit-points',
      die: hp.hitDie,
      base: hp.base,
      conModifier: hp.conModifier,
      total: hp.hitPointGain,
      beyondThisLevel: hp.beyondThisLevel,
      firstLevel: hp.firstLevel,
    },
    ...features.map((note): LevelGain => ({ kind: 'feature', name: note.name, summary: note.summary })),
    ...offers.map((offer): LevelGain => ({ kind: 'choice', pool: offer.pool, label: offer.label, count: offer.count })),
    ...(advancement === null ? [] : [{ kind: 'advancement', classLevel } as const]),
    ...proficiencyGain(beforeSheet, afterSheet),
    ...slotGains(beforeSheet, afterSheet),
    ...resourceGains(beforeSheet, afterSheet),
    ...attackGains(beforeSheet, afterSheet),
    ...critGains(beforeSheet, afterSheet),
  ];

  // A level is offered by a class table, which is not a thing that can be
  // illegal. What *can* be wrong is the pack, or choices recorded on a level
  // that no longer offers them — so those are what a preview reports.
  const beforeProblems = new Set(beforeSheet.diagnostics);
  const problems = afterSheet.diagnostics.filter((d) => !beforeProblems.has(d));

  return {
    classId,
    classLevel,
    totalLevel,
    firstLevel: hp.firstLevel,
    hitDie: hp.hitDie,
    hitPoints: {
      die: hp.hitDie,
      base: hp.base,
      conModifier: hp.conModifier,
      firstLevel: hp.firstLevel,
    },
    features,
    offers,
    advancement,
    gains,
    problems,
  };
}

/**
 * The features this level adds.
 *
 * Notes for picks are filtered out, because a pick is already reported as a
 * choice the player made — reporting it twice would read as two different
 * things. Feats mark themselves with the summary `"Feat."`, which is the one
 * place the engine writes a note for something that is not a feature.
 */
function newNotes(
  beforeSheet: DerivedSheet,
  afterSheet: DerivedSheet,
  choices: readonly LevelChoice[],
): readonly DerivedNote[] {
  const known = new Set(beforeSheet.notes.map(noteKey));

  const pickedNames = new Set<string>();
  for (const choice of choices) {
    if (choice.kind !== 'select') continue;
    const pool = afterSheet.selections.find((s) => s.pool === choice.pool);
    for (const pick of pool?.picks ?? []) pickedNames.add(pick.name);
  }

  return afterSheet.notes.filter(
    (note) =>
      !known.has(noteKey(note)) &&
      note.summary !== 'Feat.' &&
      !pickedNames.has(note.name),
  );
}

function noteKey(note: DerivedNote): string {
  // Level is part of the key because two classes can name a feature alike, and
  // a feature that arrives at a class level is that class level's.
  return `${note.name} ${note.level}`;
}

/** Pools whose entitlement this level raised, with the size of the raise. */
function newOffers(beforeSheet: DerivedSheet, afterSheet: DerivedSheet): readonly LevelOffer[] {
  const before = new Map(beforeSheet.selections.map((s) => [s.pool, s.entitled]));

  const out: LevelOffer[] = [];
  for (const selection of afterSheet.selections) {
    const count = selection.entitled - (before.get(selection.pool) ?? 0);
    if (count <= 0) continue;
    out.push({ pool: selection.pool, label: selection.label, count, selection });
  }
  return out;
}

function proficiencyGain(beforeSheet: DerivedSheet, afterSheet: DerivedSheet): readonly LevelGain[] {
  if (afterSheet.proficiencyBonus === beforeSheet.proficiencyBonus) return [];
  return [{ kind: 'proficiency', from: beforeSheet.proficiencyBonus, to: afterSheet.proficiencyBonus }];
}

/**
 * Slots that moved. Compared per source and per spell level, so a wizard taking
 * a level is told "you gain a 2nd-level slot" rather than "your slots changed".
 */
function slotGains(beforeSheet: DerivedSheet, afterSheet: DerivedSheet): readonly LevelGain[] {
  const out: LevelGain[] = [];
  for (const casting of afterSheet.spellcasting) {
    const previous = beforeSheet.spellcasting.find((c) => c.source === casting.source);

    // A source that is new this level grants everything it has.
    if (previous === undefined) {
      const gained = casting.slots
        .map((count, i) => ({ level: i + 1, from: 0, to: count }))
        .filter((slot) => slot.to > 0);
      if (gained.length > 0) out.push({ kind: 'slots', source: casting.source, gained });
      continue;
    }

    const gained: SlotGain[] = [];
    casting.slots.forEach((count, i) => {
      const was = previous.slots[i] ?? 0;
      if (count !== was) gained.push({ level: i + 1, from: was, to: count });
    });
    if (gained.length > 0) out.push({ kind: 'slots', source: casting.source, gained });
  }
  return out;
}

/** Resource pools this level created or enlarged. A pool that shrank is not a gain. */
function resourceGains(beforeSheet: DerivedSheet, afterSheet: DerivedSheet): readonly LevelGain[] {
  const out: LevelGain[] = [];
  for (const resource of afterSheet.resources) {
    const was = beforeSheet.resources.find((r) => r.id === resource.id)?.max ?? 0;
    if (resource.max <= was) continue;
    out.push({ kind: 'resource', id: resource.id, from: was, to: resource.max, recharge: resource.recharge });
  }
  return out;
}

function attackGains(beforeSheet: DerivedSheet, afterSheet: DerivedSheet): readonly LevelGain[] {
  if (afterSheet.attacksPerAction <= beforeSheet.attacksPerAction) return [];
  return [{ kind: 'attacks', count: afterSheet.attacksPerAction }];
}

function critGains(beforeSheet: DerivedSheet, afterSheet: DerivedSheet): readonly LevelGain[] {
  if (afterSheet.critRange >= beforeSheet.critRange) return [];
  return [{ kind: 'crit-range', minimum: afterSheet.critRange }];
}
