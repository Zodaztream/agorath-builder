/**
 * Race and background.
 *
 * Two steps of the same shape, so they are one file: each is a list of things
 * the pack describes, and the only difference is what the card says about them.
 * A race's card states the ability increases it grants, because that is the part
 * that changes the numbers two steps later; a background's card states the
 * proficiencies it grants, for the same reason.
 *
 * Both read their facts from the catalogue and the pack's own sentence. Nothing
 * here knows what a race *is*.
 */

import type { JSX } from 'preact';
import { ABILITY_NAMES, type ContentProvider } from '@agorath/engine';
import type { PackCatalog } from '@agorath/content';
import { signed, titleCase } from '../../text.ts';
import { Card, CardGrid } from '../../components/cards.tsx';

export function RaceStep(props: {
  content: ContentProvider;
  catalog: PackCatalog;
  chosen: string | null;
  onChoose: (raceId: string) => void;
}): JSX.Element {
  return (
    <CardGrid>
      {props.catalog.races.map((race) => (
        <Card
          key={race.id}
          title={race.name}
          summary={race.summary === '' ? 'The pack writes no description for this race.' : race.summary}
          facts={abilityIncreaseFacts(props.content, race.id)}
          selected={props.chosen === race.id}
          onSelect={() => props.onChoose(race.id)}
        />
      ))}
      {props.catalog.races.length === 0 && (
        <p class="muted">The loaded pack has no races, so there is nothing to choose here.</p>
      )}
    </CardGrid>
  );
}

export function BackgroundStep(props: {
  content: ContentProvider;
  catalog: PackCatalog;
  chosen: string | null;
  onChoose: (backgroundId: string) => void;
}): JSX.Element {
  return (
    <CardGrid>
      {props.catalog.backgrounds.map((background) => (
        <Card
          key={background.id}
          title={background.name}
          summary={background.summary === '' ? 'The pack writes no description for this background.' : background.summary}
          facts={skillFacts(props.content, background.id)}
          selected={props.chosen === background.id}
          onSelect={() => props.onChoose(background.id)}
        />
      ))}
      {props.catalog.backgrounds.length === 0 && (
        <p class="muted">The loaded pack has no backgrounds, so there is nothing to choose here.</p>
      )}
    </CardGrid>
  );
}

/** `+1 to every ability` reads better than a column of six. */
function abilityIncreaseFacts(
  content: ContentProvider,
  raceId: string,
): readonly { readonly label: string; readonly value: string }[] {
  const race = content.race(raceId);
  if (race === null || race.abilityIncreases.length === 0) return [];
  return [{
    label: 'Ability scores',
    value: race.abilityIncreases
      .map((increase) => `${signed(increase.amount)} ${ABILITY_NAMES[increase.ability].slice(0, 3).toUpperCase()}`)
      .join(', '),
  }];
}

/** The skill proficiencies a background grants, from its own effects. */
function skillFacts(
  content: ContentProvider,
  backgroundId: string,
): readonly { readonly label: string; readonly value: string }[] {
  const background = content.background(backgroundId);
  if (background === null) return [];

  const skills = background.effects.flatMap((effect) =>
    effect.shape === 'proficiency.grant' && effect.kind === 'skill' ? effect.ids : [],
  );
  if (skills.length === 0) return [];
  return [{ label: 'Skills', value: skills.map(titleCase).join(', ') }];
}
