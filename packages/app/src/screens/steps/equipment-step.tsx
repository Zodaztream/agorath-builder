/**
 * What the character starts with.
 *
 * A step, not a catalogue. The book gives a class a list of packages and a few
 * fixed items — "chain mail, or leather and a longbow and 20 arrows" — and this
 * asks for those and nothing else. The item list a player browses for a blade
 * the DM handed out is on the sheet, because that is a mid-campaign act rather
 * than a step in making a 1st-level character (ADR-0013).
 *
 * Every card is the pack's own sentence about a package, and the panel at the
 * top moves as packages are taken, so the connection between "I took the chain
 * mail" and "my Armour Class is 16" is visible rather than inferred.
 */

import type { JSX } from 'preact';
import {
  type CharacterDefinition,
  type ContentProvider,
  type DerivedSheet,
} from '@agorath/engine';
import { kitChoices } from '../../flow.ts';
import { picksFor, setPicks } from '../../store.ts';
import { PoolPicker } from '../../components/pool-picker.tsx';
import { Stat } from '../../ui.tsx';

export function EquipmentStep(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  sheet: DerivedSheet;
  /** The level entry each pool's picks belong on, from the engine's own view. */
  homes: ReadonlyMap<string, number>;
  onChange: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const { definition, content, sheet, homes, onChange } = props;

  const kit = kitChoices(sheet).filter((selection) => selection.entitled > 0);

  return (
    <>
      <div class="stats">
        <Stat label="Armour class" value={sheet.armorClass} hint={sheet.armorClassBreakdown} />
        <Stat label="Hit points" value={sheet.hitPoints.maximum} hint={sheet.hitPoints.breakdown} />
        <Stat
          label="Attacks"
          value={sheet.attacks.length - 1}
          hint="Weapons you are holding. The unarmed strike is always on the sheet too."
        />
      </div>

      {kit.length === 0 ? (
        <NoKit definition={definition} sheet={sheet} />
      ) : (
        <>
          {kit.map((selection) => (
            <PoolPicker
              key={selection.pool}
              selection={selection}
              count={selection.entitled}
              picks={picksFor(definition, selection.pool)}
              onChange={(picks) => {
                const home = homes.get(selection.pool) ?? 0;
                onChange(setPicks(definition, home, selection.pool, picks));
              }}
            />
          ))}
          <Received definition={definition} sheet={sheet} content={content} />
        </>
      )}
    </>
  );
}

/**
 * Why there is nothing to choose.
 *
 * Three different situations look identical from here, and saying which one it
 * is saves the player hunting for a bug that is not there.
 */
function NoKit(props: {
  definition: CharacterDefinition;
  sheet: DerivedSheet;
}): JSX.Element {
  const { definition, sheet } = props;

  if (definition.levels.length === 0) {
    return (
      <p class="muted">
        Nothing to choose yet. A class decides what its members start with — pick one on the Class
        step and its equipment will appear here.
      </p>
    );
  }

  const suppressed = sheet.diagnostics.some((d) => d.includes('starting equipment is not granted'));
  if (suppressed) {
    return (
      <p class="muted">
        Your first class brings the equipment, and this character's first class is not one of the
        loaded pack's — or a later class is the one with a kit. A multiclass character takes
        equipment from their first class only, which the sheet explains.
      </p>
    );
  }

  return (
    <p class="muted">
      The loaded pack does not say what this class starts with. That is a gap in the pack rather
      than a choice you are missing; add what your table agrees on from the Sheet tab.
    </p>
  );
}

/**
 * What has actually been handed over.
 *
 * A package says what it contains on its own card, but the fixed items — a
 * rogue's leather armour, two daggers and thieves' tools — were never a choice
 * and would otherwise arrive invisibly. This is the list of everything that
 * did, and the reason the inventory has anything in it at all.
 */
function Received(props: {
  definition: CharacterDefinition;
  sheet: DerivedSheet;
  content: ContentProvider;
}): JSX.Element | null {
  const { sheet, content } = props;
  if (sheet.startingItems.length === 0) return null;

  const bySource = new Map<string, { item: string; quantity: number }[]>();
  for (const granted of sheet.startingItems) {
    const bucket = bySource.get(granted.grantedBy) ?? [];
    bucket.push({ item: granted.item, quantity: granted.quantity });
    bySource.set(granted.grantedBy, bucket);
  }

  const nameOf = (id: string): string => {
    const entry = content.item(id);
    if (entry !== null) return entry.name;
    const option = content.option(id);
    return option === null ? id : option.name;
  };

  return (
    <section class="equip-group">
      <h3>You are carrying</h3>
      <ul class="carried">
        {[...bySource].map(([source, items]) => (
          <li key={source}>
            <span class="muted">{nameOf(source)}</span>
            <ul>
              {items.map((line) => (
                <li key={line.item}>
                  {nameOf(line.item)}
                  {line.quantity > 1 && <span class="badge">×{line.quantity}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p class="muted">
        Everything here is on the sheet, where you can equip it, put it down, or add what you pick
        up along the way.
      </p>
    </section>
  );
}
