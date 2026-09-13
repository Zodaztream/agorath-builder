/**
 * The choices a class opens: skills, a fighting style, expertise.
 *
 * Which pools exist, how many picks each allows and what the candidates are is
 * entirely the engine's answer — this screen renders `sheet.selections` and
 * writes the picks back to the level entry where the pool first appeared. That
 * is why a 1st-level fighter sees no archetype here and a 3rd-level one does,
 * with nothing in this file that knows what an archetype is.
 */

import type { JSX } from 'preact';
import type { CharacterDefinition, DerivedSheet } from '@agorath/engine';
import { picksFor, setPicks } from '../../store.ts';
import { classChoices } from '../../flow.ts';
import { PoolPicker } from '../../components/pool-picker.tsx';

export function ChoicesStep(props: {
  definition: CharacterDefinition;
  sheet: DerivedSheet;
  /** The level entry each pool's picks belong on, from the engine's own view. */
  homes: ReadonlyMap<string, number>;
  onChange: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const { definition, sheet, homes } = props;
  // The kit is a choice like any other, but it is asked on the Equipment step.
  // `kit` is the engine's answer to which pools those are, so nothing here has
  // to know a pool name.
  const offered = classChoices(sheet).filter((selection) => selection.entitled > 0);

  if (offered.length === 0) {
    return (
      <p class="muted">
        Nothing to choose yet. Your skills and any first-level options come from your class — pick
        one on the Class step, and they will appear here.
      </p>
    );
  }

  return (
    <>
      {offered.map((selection) => (
        <PoolPicker
          key={selection.pool}
          selection={selection}
          count={selection.entitled}
          picks={picksFor(definition, selection.pool)}
          onChange={(picks) => {
            const home = homes.get(selection.pool) ?? 0;
            props.onChange(setPicks(definition, home, selection.pool, picks));
          }}
        />
      ))}
      <p class="muted">
        Every list here comes from a feature your character has. A choice that appears later — an
        archetype at 3rd level, expertise at 6th — arrives with the level that grants it, not before.
      </p>
    </>
  );
}
