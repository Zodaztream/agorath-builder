/**
 * The character, as a history.
 *
 * Every level the character has, in the order it was taken, with what it gave —
 * replayed from the entry by the same engine call the level-up screen uses, so
 * the two can never tell a player different things. Levelling happens from here,
 * and so does undoing one, because "why is my attack bonus wrong" is nearly
 * always a level that was added by mistake.
 */

import type { JSX } from 'preact';
import {
  previewTakenLevel,
  type CharacterDefinition,
  type ContentProvider,
  type DerivedSheet,
} from '@agorath/engine';
import { picksFor, removeLevel, setLevel, setPicks } from '../../store.ts';
import { signed, titleCase } from '../../text.ts';
import { GainList } from '../../components/level-gains.tsx';
import { PoolPicker } from '../../components/pool-picker.tsx';
import { Notice, Stat } from '../../ui.tsx';
import { outstanding, type Outstanding } from '../../flow.ts';

export function CharacterStep(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  sheet: DerivedSheet;
  onAdvance: () => void;
  onChange: (definition: CharacterDefinition) => void;
  onGoToStep: (step: Outstanding['step']) => void;
}): JSX.Element {
  const { definition, content, sheet } = props;
  const open = outstanding({ definition, sheet, visited: new Set() });

  return (
    <>
      <div class="stats">
        <Stat label="Level" value={sheet.totalLevel} hint={classLine(sheet)} />
        <Stat label="Proficiency" value={signed(sheet.proficiencyBonus)} hint="By total level, not class level." />
        <Stat label="Armour class" value={sheet.armorClass} hint={sheet.armorClassBreakdown} />
        <Stat label="Hit points" value={sheet.hitPoints.maximum} />
      </div>

      {open.length > 0 && (
        <div class="notice notice-info">
          <strong>Still to decide</strong>
          <ul>
            {open.map((item, index) => (
              <li key={index}>
                <button type="button" class="link" onClick={() => props.onGoToStep(item.step)}>{item.text}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Notice
        tone="error"
        title="The rules objected to this character"
        items={sheet.diagnostics}
      />

      <div class="levels">
        {definition.levels.map((level, index) => {
          const preview = previewTakenLevel(definition, content, index);

          return (
            <details class="level-card" key={index} open={index === definition.levels.length - 1}>
              <summary>
                <span class="level-index">Level {index + 1}</span>
                <strong>{titleCase(level.class)}</strong>
                <span class="muted">{preview === null ? '' : `class level ${preview.classLevel}`}</span>
                <span class="level-hp">
                  {preview?.gains.find((gain) => gain.kind === 'hit-points')?.kind === 'hit-points'
                    ? `${signed(hitPointValue(preview))} hp`
                    : ''}
                </span>
              </summary>

              <div class="level-body">
                {/* The picks sit under the row that explains them, exactly as on
                    the level-up page — a level is reviewed the way it was taken. */}
                {preview !== null && (
                  <GainList
                    gains={preview.gains}
                    control={(gain) => {
                      if (gain.kind !== 'choice') return null;
                      const offer = preview.offers.find((candidate) => candidate.pool === gain.pool);
                      if (offer === undefined) return null;
                      return (
                        <PoolPicker
                          selection={offer.selection}
                          count={offer.selection.entitled}
                          bare
                          picks={picksFor(definition, offer.pool)}
                          onChange={(picks) => props.onChange(setPicks(definition, index, offer.pool, picks))}
                        />
                      );
                    }}
                  />
                )}

                {preview !== null && preview.problems.length > 0 && (
                  <Notice tone="warning" title="This level would not be legal now" items={preview.problems} />
                )}

                <div class="level-actions">
                  <label class="row level-hp-row">
                    <span class="muted">Hit points</span>
                    <select
                      value={level.hp.mode}
                      onChange={(event) => {
                        const mode = event.currentTarget.value;
                        props.onChange(setLevel(definition, index, {
                          hp: mode === 'rolled' ? { mode: 'rolled', value: 1 } : { mode: 'average' },
                        }));
                      }}
                    >
                      <option value="average">The average</option>
                      <option value="rolled">What I rolled</option>
                    </select>
                    {level.hp.mode === 'rolled' && (
                      <input
                        type="number"
                        min={1}
                        value={level.hp.value}
                        onInput={(event) => props.onChange(setLevel(definition, index, {
                          hp: { mode: 'rolled', value: Math.max(1, Number(event.currentTarget.value)) },
                        }))}
                      />
                    )}
                  </label>
                  <button
                    type="button"
                    class="link"
                    onClick={() => {
                      if (!window.confirm(`Remove level ${index + 1} and everything it decided?`)) return;
                      props.onChange(removeLevel(definition, index));
                    }}
                  >
                    remove this level
                  </button>
                </div>
              </div>
            </details>
          );
        })}

        {definition.levels.length === 0 && (
          <p class="muted">No levels yet. Start on the Class step.</p>
        )}
      </div>

      <div class="advance">
        {definition.levels.length === 0 ? (
          <>
            <button type="button" class="primary" onClick={() => props.onGoToStep('class')}>
              Start with a class
            </button>
            <span class="muted"> A character is a class and a level. Everything follows from there.</span>
          </>
        ) : (
          <>
            <button type="button" class="primary" onClick={props.onAdvance}>
              Advance to level {sheet.totalLevel + 1}
            </button>
            <span class="muted">
              {' '}
              Shows what the level gives you, and asks only the questions it has.
            </span>
          </>
        )}
      </div>
    </>
  );
}

function hitPointValue(preview: ReturnType<typeof previewTakenLevel>): number {
  const gain = preview?.gains.find((candidate) => candidate.kind === 'hit-points');
  return gain?.kind === 'hit-points' ? gain.total : 0;
}

function classLine(sheet: DerivedSheet): string {
  const entries = Object.entries(sheet.classLevels);
  if (entries.length === 0) return 'no class yet';
  return entries.map(([classId, count]) => `${titleCase(classId)} ${count}`).join(' / ');
}
