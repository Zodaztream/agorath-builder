/**
 * One pool, rendered for choosing from.
 *
 * The engine says what a pool offers, how many picks it allows and which are
 * taken; this renders that and nothing else. Whether the candidates are worth a
 * card or a chip is decided by whether the pack wrote a sentence about them — a
 * fighting style needs one, a skill does not — which keeps the same component
 * usable for both without the caller having to know which it has.
 */

import type { JSX } from 'preact';
import type { DerivedSelection } from '@agorath/engine';
import { Card, CardGrid, PickChip } from './cards.tsx';

export function PoolPicker(props: {
  selection: DerivedSelection;
  /** How many picks *here* — a pool can be offered twice and add to itself. */
  count: number;
  picks: readonly string[];
  /**
   * Drop the picker's own heading, for when it sits under a row that already
   * names the pool — a level's gains list does exactly that, and two headings
   * for one choice reads like two choices.
   */
  bare?: boolean;
  onChange: (picks: readonly string[]) => void;
}): JSX.Element {
  const { selection, count, picks } = props;
  const full = picks.length >= count;
  const remaining = Math.max(0, count - picks.length);

  const toggle = (id: string, on: boolean): void => {
    props.onChange(on ? [...picks, id] : picks.filter((pick) => pick !== id));
  };

  const described = selection.candidates.some((candidate) => candidate.summary !== '');

  return (
    <div class={props.bare === true ? 'pool bare' : 'pool'}>
      {props.bare === true ? null : (
        <div class="pool-head">
          <strong>{selection.label}</strong>
          <span class={`badge${remaining === 0 ? ' done' : ''}`}>
            {remaining === 0 ? 'chosen' : `choose ${remaining} of ${count}`}
          </span>
        </div>
      )}

      {selection.candidates.length === 0 && (
        <p class="muted">
          Nothing to choose from — no pack loaded offers anything for this pool. That is a pack
          problem, not a choice you are missing.
        </p>
      )}

      {described ? (
        <CardGrid>
          {selection.candidates.map((candidate) => {
            const picked = picks.includes(candidate.id);
            return (
              <Card
                key={candidate.id}
                title={candidate.name}
                summary={candidate.summary}
                selected={picked}
                disabled={!picked && full}
                onSelect={() => toggle(candidate.id, !picked)}
              />
            );
          })}
        </CardGrid>
      ) : (
        <div class="chips">
          {selection.candidates.map((candidate) => {
            const picked = picks.includes(candidate.id);
            return (
              <PickChip
                key={candidate.id}
                label={candidate.name}
                selected={picked}
                disabled={!picked && full}
                onToggle={() => toggle(candidate.id, !picked)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
