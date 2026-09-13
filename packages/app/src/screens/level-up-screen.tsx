/**
 * Levelling up, as a page rather than a dropdown.
 *
 * The old builder's "Add a level of…" asked for the hardest decision first —
 * which class — and then said nothing about what the level would give, which is
 * why it read as arbitrary. This asks the same question, but the second half of
 * the page answers "*what does this level actually do?*" from the engine's own
 * derivation, and puts each decision under the sentence that explains it.
 *
 * Two steps, because there are genuinely two questions: which class advances,
 * and what the level gives you. A level that asks for nothing — a fighter's
 * second level — is two clicks and a confirmation.
 */

import type { JSX } from 'preact';
import {
  classRules,
  previewLevel,
  type CharacterDefinition,
  type ContentProvider,
  type DerivedSheet,
  type HitPointRoll,
} from '@agorath/engine';
import type { PackCatalog } from '@agorath/content';
import {
  applyLevel,
  draftOutstanding,
  draftPicks,
  emptyDraft,
  withAdvancement,
  withPicks,
  type LevelDraft,
} from '../level-up.ts';
import { ABILITY_LABELS } from '../store.ts';
import { titleCase } from '../text.ts';
import { Card, CardGrid, PickChip } from '../components/cards.tsx';
import { PoolPicker } from '../components/pool-picker.tsx';
import { AdvancementPicker } from '../components/advancement-picker.tsx';
import { GainList } from '../components/level-gains.tsx';
import { Notice } from '../ui.tsx';

export function LevelUpScreen(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  catalog: PackCatalog;
  /** The character as it stands, for the cap shown on each ability. */
  sheet: DerivedSheet;
  draft: LevelDraft;
  onDraft: (draft: LevelDraft) => void;
  onCancel: () => void;
  onCommit: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const { definition, content, catalog, draft } = props;

  const preview = previewLevel(definition, content, {
    classId: draft.classId,
    hp: draft.hp,
    choices: draft.choices,
  });

  const outstanding = draftOutstanding(preview, draft);

  return (
    <div class="wizard">
      <header class="wizard-head">
        <div>
          <h2>Level {definition.levels.length + 1}</h2>
          <p class="hint">
            {preview.firstLevel
              ? 'The first level of a class is the one that gives its proficiencies, its hit points and its place in the party.'
              : `Advancing ${titleCase(draft.classId)} to class level ${preview.classLevel}.`}
          </p>
        </div>
        <button type="button" class="link" onClick={props.onCancel}>cancel</button>
      </header>

      <section class="panel">
        <header>
          <h2>Which class advances?</h2>
        </header>
        <ClassChoice
          definition={definition}
          content={content}
          catalog={catalog}
          current={draft.classId}
          onPick={(classId) => props.onDraft(emptyDraft(classId))}
        />
      </section>

      <section class="panel">
        <header>
          <h2>What this level gives you</h2>
          <p class="hint">
            Every line below is computed from your character as it stands — nothing here is a
            general description that might not apply to you.
          </p>
        </header>

        <GainList
          gains={preview.gains}
          control={(gain) => {
            switch (gain.kind) {
              case 'hit-points':
                return (
                  <HitPointControl
                    draft={draft}
                    average={gain.base}
                    firstLevel={gain.firstLevel}
                    onChoose={(hp) => props.onDraft({ ...draft, hp })}
                  />
                );
              case 'choice': {
                const offer = preview.offers.find((candidate) => candidate.pool === gain.pool);
                if (offer === undefined) return null;
                return (
                  <PoolPicker
                    selection={offer.selection}
                    count={offer.count}
                    bare
                    picks={draftPicks(draft, offer.pool)}
                    onChange={(picks) => props.onDraft(withPicks(draft, offer.pool, picks))}
                  />
                );
              }
              case 'advancement':
                return (
                  <AdvancementPicker
                    choice={draft.choices.find((c) => c.kind === 'asi' || c.kind === 'feat') ?? null}
                    abilities={props.sheet.abilities}
                    feats={catalog.feats}
                    onChange={(choice) => props.onDraft(withAdvancement(draft, choice))}
                  />
                );
              default:
                return null;
            }
          }}
        />

        {preview.gains.length === 1 && (
          <p class="muted">
            A quiet level: hit points and nothing else. That is a real level, not a missing feature
            list — every class has them.
          </p>
        )}

        {preview.problems.length > 0 && (
          <Notice tone="warning" title="This level would not be legal" items={preview.problems} />
        )}
      </section>

      <div class="wizard-foot">
        {outstanding.length > 0 ? (
          <div class="notice notice-info">
            <strong>Decide, or take the level as it is</strong>
            <ul>
              {outstanding.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </div>
        ) : (
          <p class="ok">Nothing left to decide on this level.</p>
        )}

        <div class="row">
          <button
            type="button"
            class="primary"
            onClick={() => props.onCommit(applyLevel(definition, draft))}
          >
            Take level {definition.levels.length + 1}
          </button>
          <button type="button" onClick={props.onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ClassChoice(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  catalog: PackCatalog;
  current: string;
  onPick: (classId: string) => void;
}): JSX.Element {
  const { definition, content, catalog, current } = props;

  const held = Object.entries(
    definition.levels.reduce<Record<string, number>>((counts, level) => {
      counts[level.class] = (counts[level.class] ?? 0) + 1;
      return counts;
    }, {}),
  );

  const newClasses = catalog.classes.filter((entry) => !held.some(([classId]) => classId === entry.id));

  return (
    <>
      <h3>Advance a class you have</h3>
      <CardGrid>
        {held.map(([classId, count]) => {
          const rules = classRules(classId);
          const preview = previewLevel(definition, content, { classId });
          return (
            <Card
              key={classId}
              title={titleCase(classId)}
              summary={`Class level ${count} → ${count + 1}`}
              facts={rules === null ? [] : [{ label: 'Hit die', value: `d${rules.hitDie}` }]}
              selected={current === classId}
              onSelect={() => props.onPick(classId)}
            >
              <p class="muted">Level {preview.totalLevel} overall.</p>
            </Card>
          );
        })}
        {held.length === 0 && <p class="muted">No class yet — take a first level below.</p>}
      </CardGrid>

      {newClasses.length > 0 && (
        <>
          <h3>Take a level in a new class</h3>
          <p class="muted">
            Multiclassing. The 2014 rule for it is not implemented yet: the engine grants a new
            class's level-1 features as written, without checking the ability prerequisites, and
            without the reduced proficiencies the rule gives on entry. Your table's call until it is.
          </p>
          <CardGrid>
            {newClasses.map((entry) => {
              const rules = classRules(entry.id);
              const preview = previewLevel(definition, content, { classId: entry.id });
              return (
                <Card
                  key={entry.id}
                  title={entry.name}
                  summary={entry.summary}
                  facts={[
                    { label: 'Hit die', value: `d${preview.hitDie}` },
                    ...(rules === null
                      ? []
                      : [{ label: 'Saves', value: rules.savingThrows.map((a) => ABILITY_LABELS[a]).join(' & ') }]),
                  ]}
                  selected={current === entry.id}
                  onSelect={() => props.onPick(entry.id)}
                />
              );
            })}
          </CardGrid>
        </>
      )}
    </>
  );
}

/** The average or what you rolled. The one number a level cannot compute. */
function HitPointControl(props: {
  draft: LevelDraft;
  average: number;
  firstLevel: boolean;
  onChoose: (hp: HitPointRoll) => void;
}): JSX.Element | null {
  if (props.firstLevel) return null;

  const rolled = props.draft.hp.mode === 'rolled' ? props.draft.hp.value : null;

  return (
    <div class="chips">
      <PickChip
        label={`The average (${props.average})`}
        selected={props.draft.hp.mode === 'average'}
        onToggle={() => props.onChoose({ mode: 'average' })}
      />
      <PickChip
        label="What I rolled"
        selected={props.draft.hp.mode === 'rolled'}
        onToggle={() => props.onChoose({ mode: 'rolled', value: rolled ?? props.average })}
      />
      {rolled !== null && (
        <label class="row">
          <span class="muted">Rolled</span>
          <input
            type="number"
            min={1}
            value={rolled}
            onInput={(event) => props.onChoose({ mode: 'rolled', value: Math.max(1, Number(event.currentTarget.value)) })}
          />
        </label>
      )}
    </div>
  );
}
