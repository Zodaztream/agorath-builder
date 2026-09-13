/**
 * Set your ability scores.
 *
 * The step a beginner needs most, because the six numbers are the only part of
 * a character with no obvious meaning: nobody is born knowing that 14 is two
 * points better than 13 and costs two points more. So the method is chosen
 * first and each method's editor shows its own arithmetic — the array's pool,
 * point buy's budget — and every score shows what it will become *and* what the
 * race adds on top.
 *
 * The final scores are the engine's (`sheet.abilities`); the editor only ever
 * writes the base scores, which is why the two columns agree by construction.
 */

import type { JSX } from 'preact';
import { classRules, type Ability, type AbilityMethod, type AbilityScores, type DerivedSheet } from '@agorath/engine';
import {
  ABILITY_METHOD_BLURBS,
  ABILITY_METHOD_LABELS,
  ABILITY_METHOD_ORDER,
  POINT_BUY_BUDGET,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  arrayRemaining,
  assignArrayValue,
  isStandardArray,
  pointBuyCost,
  pointsSpent,
  suggestedScores,
} from '../../abilities.ts';
import { ABILITY_LABELS, ABILITY_ORDER } from '../../store.ts';
import { signed } from '../../text.ts';
import { Card, CardGrid, PickChip } from '../../components/cards.tsx';

export function AbilityStep(props: {
  sheet: DerivedSheet;
  method: AbilityMethod;
  scores: AbilityScores;
  classId: string | null;
  onMethod: (method: AbilityMethod) => void;
  onScores: (scores: AbilityScores) => void;
}): JSX.Element {
  const { sheet, method, scores } = props;
  const rules = props.classId === null ? null : classRules(props.classId);

  return (
    <>
      <CardGrid>
        {ABILITY_METHOD_ORDER.map((value) => (
          <Card
            key={value}
            title={ABILITY_METHOD_LABELS[value]}
            summary={ABILITY_METHOD_BLURBS[value]}
            selected={method === value}
            onSelect={() => props.onMethod(value)}
          />
        ))}
      </CardGrid>

      <p class="muted">
        Your race and class add to these afterwards, and those increases are not limited by the
        method — a score of 15 can still become 17 with the right race.
      </p>

      {method === 'standard-array' && (
        <ArrayEditor scores={scores} onScores={props.onScores} />
      )}
      {method === 'point-buy' && (
        <PointBuyEditor scores={scores} onScores={props.onScores} />
      )}
      {method === 'manual' && (
        <ManualEditor scores={scores} onScores={props.onScores} />
      )}

      {rules !== null && (
        <div class="suggestion">
          <button
            type="button"
            onClick={() => props.onScores(suggestedScores(rules.savingThrows))}
          >
            Start from a suggestion for a {props.classId}
          </button>
          <span class="muted">
            {' '}
            Puts your best two scores on the class's saving throws — a starting point, not advice
            about how to play.
          </span>
        </div>
      )}

      <table class="ability-table">
        <thead>
          <tr>
            <th>Ability</th>
            <th class="num">Base</th>
            <th class="num">With race</th>
            <th class="num">Modifier</th>
            <th>What it is for</th>
          </tr>
        </thead>
        <tbody>
          {ABILITY_ORDER.map((ability) => {
            const derived = sheet.abilities[ability];
            const added = derived.score - scores[ability];
            return (
              <tr key={ability}>
                <td>{ABILITY_LABELS[ability]}</td>
                <td class="num">{scores[ability]}</td>
                <td class="num">
                  {derived.score}
                  {added > 0 && <span class="muted"> (+{added})</span>}
                </td>
                <td class="num">{signed(derived.modifier)}</td>
                <td class="muted">{ABILITY_USES[ability]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** What each ability is rolled for, in one line. A label, not a rule. */
const ABILITY_USES: Readonly<Record<Ability, string>> = {
  str: 'Melee weapons, Athletics, shoving, carrying.',
  dex: 'Armour class, initiative, ranged weapons, Stealth.',
  con: 'Hit points at every level, and concentration.',
  int: 'Arcana, History, Investigation, a wizard\'s spells.',
  wis: 'Perception, Insight, a cleric\'s or druid\'s spells.',
  cha: 'Persuasion, Deception, a bard\'s or warlock\'s spells.',
};

function ArrayEditor(props: {
  scores: AbilityScores;
  onScores: (scores: AbilityScores) => void;
}): JSX.Element {
  const remaining = arrayRemaining(props.scores);
  const settled = isStandardArray(props.scores);

  return (
    <div class="editor">
      <div class="pool-head">
        <strong>Place the six numbers</strong>
        <span class={settled ? 'badge done' : 'badge bad'}>
          {settled ? 'all six placed' : `not the array: ${remaining === null ? 'a score is not one of them' : `${remaining.length} unplaced`}`}
        </span>
      </div>
      <p class="muted">
        Giving a score to one ability gives that ability's old number to whoever had it, so the six
        stay the six. Nothing can be lost or duplicated.
      </p>
      <div class="array-editor">
        {ABILITY_ORDER.map((ability) => (
          <div class="array-row" key={ability}>
            <span class="array-label">{ABILITY_LABELS[ability]}</span>
            <div class="chips">
              {STANDARD_VALUES.map((value) => (
                <PickChip
                  key={value}
                  label={`${value}`}
                  selected={props.scores[ability] === value}
                  onToggle={() => props.onScores(assignArrayValue(props.scores, ability, value))}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const STANDARD_VALUES: readonly number[] = [15, 14, 13, 12, 10, 8];

function PointBuyEditor(props: {
  scores: AbilityScores;
  onScores: (scores: AbilityScores) => void;
}): JSX.Element {
  const spent = pointsSpent(props.scores);
  const left = spent === null ? null : POINT_BUY_BUDGET - spent;

  const step = (ability: Ability, delta: number): void => {
    const next = (props.scores[ability] ?? POINT_BUY_MIN) + delta;
    if (next < POINT_BUY_MIN || next > POINT_BUY_MAX) return;
    const candidate = { ...props.scores, [ability]: next };
    const cost = pointsSpent(candidate);
    // Refuse to go over budget rather than going over and apologising after.
    if (cost === null || cost > POINT_BUY_BUDGET) return;
    props.onScores(candidate);
  };

  return (
    <div class="editor">
      <div class="pool-head">
        <strong>Spend your points</strong>
        <span class={left === 0 ? 'badge done' : 'badge'}>
          {left === null ? 'outside what point buy allows' : `${left} of ${POINT_BUY_BUDGET} left`}
        </span>
      </div>
      <p class="muted">
        Every score starts at {POINT_BUY_MIN} and costs {pointBuyCost(13)} points to raise to 13, or{' '}
        {pointBuyCost(15)} to raise to 15 — the last two steps cost two each. You may leave points
        unspent.
      </p>
      <div class="array-editor">
        {ABILITY_ORDER.map((ability) => {
          const score = props.scores[ability] ?? POINT_BUY_MIN;
          const raising = pointBuyCost(score + 1);
          const affordable = raising !== null && left !== null && raising - (pointBuyCost(score) ?? 0) <= left;
          return (
            <div class="array-row" key={ability}>
              <span class="array-label">{ABILITY_LABELS[ability]}</span>
              <div class="row">
                <button type="button" disabled={score <= POINT_BUY_MIN} onClick={() => step(ability, -1)}>−</button>
                <b class="num">{score}</b>
                <button type="button" disabled={score >= POINT_BUY_MAX || !affordable} onClick={() => step(ability, 1)}>+</button>
                <span class="muted">costs {pointBuyCost(score)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ManualEditor(props: {
  scores: AbilityScores;
  onScores: (scores: AbilityScores) => void;
}): JSX.Element {
  return (
    <div class="editor">
      <p class="muted">
        Whatever you rolled. The tool takes the numbers as they are — the only limit is 1 to 30,
        and the cap of 20 still applies once your race has added its increases.
      </p>
      <div class="array-editor">
        {ABILITY_ORDER.map((ability) => (
          <label class="array-row" key={ability}>
            <span class="array-label">{ABILITY_LABELS[ability]}</span>
            <input
              type="number"
              min={1}
              max={30}
              value={props.scores[ability]}
              onInput={(event) =>
                props.onScores({ ...props.scores, [ability]: clamp(Number(event.currentTarget.value)) })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(30, Math.round(value)));
}
