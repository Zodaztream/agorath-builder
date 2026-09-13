/**
 * Choose a class.
 *
 * First, because everything else follows from it: the hit die decides what a
 * level is worth in hit points, the saving throws suggest where the two best
 * ability scores belong, and the class's features are what the later steps ask
 * about.
 *
 * Each card says what the class gives at **1st level**, derived by asking the
 * engine what taking that level would do — so a card cannot claim something the
 * sheet will not honour, and a class added to a pack describes itself here
 * without a line of code being written.
 */

import type { JSX } from 'preact';
import {
  classRules,
  previewLevel,
  type CharacterDefinition,
  type ContentProvider,
  type LevelUpPreview,
} from '@agorath/engine';
import type { PackCatalog } from '@agorath/content';
import { ABILITY_LABELS } from '../../store.ts';
import { Card, CardGrid } from '../../components/cards.tsx';

export function ClassStep(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  catalog: PackCatalog;
  /**
   * Take this class as the character's first level. Offered again after a
   * choice was made, so the class can be changed while it is still the only
   * level — which is the common case for someone reading the cards twice.
   */
  onTake: (classId: string) => void;
  /** False once the character is more than a first level, when swapping would rewrite history. */
  canChange: boolean;
}): JSX.Element {
  const { definition, content, catalog } = props;
  const first = definition.levels[0];

  return (
    <>
      <CardGrid>
        {catalog.classes.map((entry) => {
          const rules = classRules(entry.id);
          const preview = previewLevel(definition, content, { classId: entry.id });

          const facts = [
            { label: 'Hit die', value: `d${preview.hitDie}` },
            ...(rules === null
              ? []
              : [{ label: 'Saves', value: rules.savingThrows.map((a) => ABILITY_LABELS[a]).join(' & ') }]),
          ];

          return (
            <Card
              key={entry.id}
              title={entry.name}
              summary={entry.summary === '' ? 'The pack writes no description for this class.' : entry.summary}
              facts={facts}
              selected={first?.class === entry.id}
              disabled={!props.canChange && first?.class !== entry.id}
              onSelect={() => props.onTake(entry.id)}
            >
              <FirstLevel preview={preview} />
            </Card>
          );
        })}
      </CardGrid>

      {!props.canChange && (
        <p class="notice notice-info">
          The character is past 1st level, so the class is no longer swappable here — changing it
          would rewrite levels that were built on it. Remove the levels below 1st on the Character
          step if you want to start the class over.
        </p>
      )}
    </>
  );
}

/** What the class gives the moment it is taken. Read off the derivation. */
function FirstLevel(props: { preview: LevelUpPreview }): JSX.Element {
  const { preview } = props;
  return (
    <div class="preview">
      <span class="preview-label">At 1st level you gain</span>
      <ul class="preview-list">
        {preview.features.map((feature) => (
          <li key={feature.name}>
            <strong>{feature.name}</strong>
            {feature.summary !== '' && <span class="muted"> — {feature.summary}</span>}
          </li>
        ))}
        {preview.features.length === 0 && (
          <li class="muted">Nothing — this pack writes no features for this class.</li>
        )}
      </ul>
      {preview.offers.length > 0 && (
        <p class="muted">
          Then you choose: {preview.offers.map((offer) => `${offer.label} (${offer.count})`).join(', ')}.
        </p>
      )}
    </div>
  );
}
