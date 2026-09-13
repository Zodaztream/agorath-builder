/**
 * The Ability Score Improvement, which is two different choices wearing one name.
 *
 * The book offers "+2 to one score, +1 to two, or a feat instead", and the old
 * builder turned that into three unlabelled dropdowns, which is why it read as
 * noise. Here it is a mode and then one click: the arithmetic — what the score
 * becomes, and what happens at the cap of 20 — is shown on the button, so the
 * choice is made with the numbers in front of you.
 */

import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { ABILITY_CAP, type Ability, type DerivedAbility, type LevelChoice } from '@agorath/engine';
import type { CatalogEntry } from '@agorath/content';
import { ABILITY_LABELS, ABILITY_ORDER } from '../store.ts';
import { signed } from '../text.ts';
import { Card, CardGrid, PickChip } from './cards.tsx';

type Mode = 'one' | 'two' | 'feat';

export function AdvancementPicker(props: {
  choice: LevelChoice | null;
  /** The character's scores as they *are*, so the cap can be shown honestly. */
  abilities: Readonly<Record<Ability, DerivedAbility>>;
  feats: readonly CatalogEntry[];
  onChange: (choice: LevelChoice | null) => void;
}): JSX.Element {
  const { choice, abilities, feats, onChange } = props;

  const [mode, setMode] = useState<Mode>(() => {
    if (choice?.kind === 'feat') return 'feat';
    if (choice?.kind === 'asi' && choice.increases.length === 2) return 'two';
    return 'one';
  });

  const increases = choice?.kind === 'asi' ? choice.increases : [];
  const chosen = choice?.kind === 'feat' ? choice.feat : null;

  const setModeAndChoice = (next: Mode): void => {
    setMode(next);
    onChange(null);
  };

  const pickOne = (ability: Ability): void => {
    onChange({ kind: 'asi', increases: [{ ability, amount: 2 }] });
  };

  const toggleTwo = (ability: Ability): void => {
    const has = increases.some((increase) => increase.ability === ability);
    const next = has
      ? increases.filter((increase) => increase.ability !== ability)
      : [...increases, { ability, amount: 1 }];
    // Never more than two: the third click would make an illegal improvement,
    // and silently dropping one would be worse than ignoring the click.
    if (next.length > 2) return;
    onChange(next.length === 0 ? null : { kind: 'asi', increases: next });
  };

  return (
    <div class="advancement">
      <div class="chips modes">
        <PickChip label="+2 to one" selected={mode === 'one'} onToggle={() => setModeAndChoice('one')} />
        <PickChip label="+1 to two" selected={mode === 'two'} onToggle={() => setModeAndChoice('two')} />
        {feats.length > 0 && (
          <PickChip label="Take a feat" selected={mode === 'feat'} onToggle={() => setModeAndChoice('feat')} />
        )}
        {choice !== null && (
          <button type="button" class="link" onClick={() => onChange(null)}>clear</button>
        )}
      </div>

      {mode === 'one' && (
        <div class="chips">
          {ABILITY_ORDER.map((ability) => (
            <AbilityChip
              key={ability}
              ability={ability}
              score={abilities[ability].score}
              amount={2}
              selected={increases.length === 1 && increases[0]?.ability === ability}
              onClick={() => pickOne(ability)}
            />
          ))}
        </div>
      )}

      {mode === 'two' && (
        <>
          <p class="muted">
            Choose two different abilities. {increases.length === 2 ? 'Both chosen.' : `${increases.length} of 2 chosen.`}
          </p>
          <div class="chips">
            {ABILITY_ORDER.map((ability) => (
              <AbilityChip
                key={ability}
                ability={ability}
                score={abilities[ability].score}
                amount={1}
                selected={increases.some((increase) => increase.ability === ability)}
                onClick={() => toggleTwo(ability)}
              />
            ))}
          </div>
        </>
      )}

      {mode === 'feat' && (
        <CardGrid>
          {feats.map((feat) => (
            <Card
              key={feat.id}
              title={feat.name}
              summary={feat.summary}
              selected={chosen === feat.id}
              onSelect={() => onChange({ kind: 'feat', feat: feat.id })}
            />
          ))}
        </CardGrid>
      )}

      <ScoreReadout abilities={abilities} increases={increases} />
    </div>
  );
}

/**
 * One ability, with what the increase would do to it.
 *
 * The cap is the reason this is not a plain button: adding +2 to a 19 gives 20
 * and wastes a point, and a player who is not told that will not find out until
 * the number refuses to move.
 */
function AbilityChip(props: {
  ability: Ability;
  score: number;
  amount: 1 | 2;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  const from = props.score;
  const to = Math.min(ABILITY_CAP, from + props.amount);
  const wasted = from < ABILITY_CAP && to - from < props.amount;
  const capped = from >= ABILITY_CAP;

  return (
    <button
      type="button"
      class={`chip ability-chip${props.selected ? ' on' : ''}`}
      disabled={capped}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span class="ability-name">{ABILITY_LABELS[props.ability]}</span>
      <span class="ability-scores">
        {from} <span class="arrow">→</span> {to}
        <span class="ability-mod">{signed(Math.floor((to - 10) / 2))}</span>
      </span>
      {capped && <span class="ability-note">already at the maximum of {ABILITY_CAP}</span>}
      {wasted && !capped && (
        <span class="ability-note">
          only +{to - from} lands — {ABILITY_CAP} is the highest a score can go
        </span>
      )}
    </button>
  );
}

/** What the scores are now, and what they would become. */
function ScoreReadout(props: {
  abilities: Readonly<Record<Ability, DerivedAbility>>;
  increases: readonly { readonly ability: Ability; readonly amount: number }[];
}): JSX.Element {
  if (props.increases.length === 0) {
    return (
      <p class="muted">
        Nothing chosen yet. Your scores include everything your race and class have given you;
        an improvement here cannot take one above {ABILITY_CAP}.
      </p>
    );
  }

  return (
    <p class="muted">
      {props.increases.map((increase) => {
        const from = props.abilities[increase.ability].score;
        const to = Math.min(ABILITY_CAP, from + increase.amount);
        return `${ABILITY_LABELS[increase.ability]} ${from} → ${to}`;
      }).join(', ')}
      {'.'}
    </p>
  );
}
