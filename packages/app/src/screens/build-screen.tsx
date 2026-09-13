/**
 * The builder: seven steps, one decision each.
 *
 * The steps are `flow.ts` — what they are and whether each is settled is a rule
 * you can read and a test can call. This file is the frame around them: the
 * rail, the header, the two buttons, and the one piece of state the flow does
 * not keep, which is which steps the player has already been through. That state
 * is deliberately not in the character: it is a fact about this sitting, and it
 * should not travel in an exported file.
 *
 * Steps are not gates. A player can jump anywhere from the rail, and the rail's
 * job is to say what is still open rather than to refuse to move.
 */

import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { classRules, type CharacterDefinition, type ContentProvider, type DerivedSheet } from '@agorath/engine';
import type { PackCatalog } from '@agorath/content';
import {
  firstOpenStep,
  stepAfter,
  stepBefore,
  stepDefinition,
  stepStatuses,
  type StepId,
} from '../flow.ts';
import {
  addLevel,
  setAbilities,
  setAbilityMethod,
  setBackground,
  setName,
  setRace,
  setLevel,
} from '../store.ts';
import { ClassStep } from './steps/class-step.tsx';
import { BackgroundStep, RaceStep } from './steps/origin-steps.tsx';
import { AbilityStep } from './steps/ability-step.tsx';
import { ChoicesStep } from './steps/choices-step.tsx';
import { EquipmentStep } from './steps/equipment-step.tsx';
import { CharacterStep } from './steps/character-step.tsx';

export function BuildScreen(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  catalog: PackCatalog;
  sheet: DerivedSheet;
  homes: ReadonlyMap<string, number>;
  onChange: (definition: CharacterDefinition) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  /** Leave the wizard for the level-up page. */
  onAdvance: () => void;
}): JSX.Element {
  const { definition, content, catalog, sheet, homes, onChange } = props;

  const [visited, setVisited] = useState<ReadonlySet<StepId>>(() => new Set());
  const [step, setStep] = useState<StepId>(() =>
    firstOpenStep({ definition, sheet, visited: new Set() }),
  );

  const context = { definition, sheet, visited };
  const statuses = stepStatuses(context);
  const current = stepDefinition(step);

  const go = (next: StepId): void => {
    setVisited((previous) => new Set([...previous, step]));
    setStep(next);
  };

  const firstClass = definition.levels[0]?.class ?? null;
  const savingThrows = firstClass === null ? [] : classRules(firstClass)?.savingThrows ?? [];

  return (
    <div class="build">
      <nav class="rail" aria-label="Steps">
        <label class="name-field">
          <span class="muted">Name</span>
          <input
            type="text"
            value={definition.name}
            placeholder="Unnamed character"
            onInput={(event) => onChange(setName(definition, event.currentTarget.value))}
          />
        </label>

        <ol>
          {statuses.map((status, index) => (
            <li key={status.step.id}>
              <button
                type="button"
                class={`step${status.step.id === step ? ' now' : ''}${status.settled ? ' done' : ''}`}
                onClick={() => go(status.step.id)}
              >
                <span class="step-number">{status.settled ? '✓' : index + 1}</span>
                <span class="step-text">
                  <span class="step-name">{status.step.short}</span>
                  <span class="step-note">{status.note}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div class="rail-foot">
          <button type="button" onClick={props.onExport}>Export character</button>
          <label class="upload small">
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file !== undefined) props.onImport(file);
                event.currentTarget.value = '';
              }}
            />
            <span>Import…</span>
          </label>
        </div>
      </nav>

      <section class="step-body">
        <header class="step-head">
          <h2>{current.title}</h2>
          <p>{current.blurb}</p>
        </header>

        {step === 'class' && (
          <ClassStep
            definition={definition}
            content={content}
            catalog={catalog}
            canChange={definition.levels.length <= 1}
            onTake={(classId) => {
              // Taking a class is taking a first level: the definition's levels
              // are the character, and a class is not stored anywhere else.
              const next =
                definition.levels.length === 1
                  ? setLevel(definition, 0, { class: classId })
                  : addLevel(definition, classId);
              onChange(next);
            }}
          />
        )}

        {step === 'race' && (
          <RaceStep
            content={content}
            catalog={catalog}
            chosen={definition.race}
            onChoose={(raceId) => onChange(setRace(definition, raceId))}
          />
        )}

        {step === 'background' && (
          <BackgroundStep
            content={content}
            catalog={catalog}
            chosen={definition.background}
            onChoose={(backgroundId) => onChange(setBackground(definition, backgroundId))}
          />
        )}

        {step === 'abilities' && (
          <AbilityStep
            sheet={sheet}
            method={definition.abilityMethod ?? 'manual'}
            scores={definition.abilities}
            classId={firstClass}
            onMethod={(method) => onChange(setAbilityMethod(definition, method, savingThrows))}
            onScores={(scores) => onChange(setAbilities(definition, scores))}
          />
        )}

        {step === 'choices' && (
          <ChoicesStep
            definition={definition}
            sheet={sheet}
            homes={homes}
            onChange={onChange}
          />
        )}

        {step === 'equipment' && (
          <EquipmentStep
            definition={definition}
            content={content}
            catalog={catalog}
            sheet={sheet}
            onChange={onChange}
          />
        )}

        {step === 'character' && (
          <CharacterStep
            definition={definition}
            content={content}
            sheet={sheet}
            onAdvance={props.onAdvance}
            onChange={onChange}
            onGoToStep={go}
          />
        )}

        <footer class="step-foot">
          {stepBefore(step) !== null && (
            <button type="button" onClick={() => go(stepBefore(step) as StepId)}>← Back</button>
          )}
          <span class="spacer" />
          {step === 'character'
            ? null
            : (
              <>
                {!statuses.find((status) => status.step.id === step)?.settled && (
                  <span class="muted">Not settled yet — you can move on and come back.</span>
                )}
                <button
                  type="button"
                  class="primary"
                  onClick={() => {
                    const next = stepAfter(step);
                    if (next !== null) go(next);
                  }}
                >
                  {stepAfter(step) === 'character' ? 'Finish' : 'Next'}
                </button>
              </>
            )}
        </footer>
      </section>
    </div>
  );
}
