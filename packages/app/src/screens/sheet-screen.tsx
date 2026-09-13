/**
 * The sheet.
 *
 * Nothing here is stored and nothing here is editable: it is the definition,
 * derived, printed. Which is the whole point — a level-up cannot leave a stale
 * number behind, because there is no number to leave behind.
 *
 * The diagnostics panel is deliberately part of the sheet rather than a debug
 * corner. "Leveling that refuses to be wrong" is only true if it says so where
 * the player is looking.
 */

import type { JSX } from 'preact';
import { ABILITY_NAMES, type CharacterDefinition, type DerivedSheet } from '@agorath/engine';
import { Notice, Panel, Stat, diceText, signed } from '../ui.tsx';

export function SheetScreen(props: {
  definition: CharacterDefinition;
  sheet: DerivedSheet;
  packLabel: string;
  onExport: () => void;
  onImport: (file: File) => void;
}): JSX.Element {
  const { definition, sheet } = props;

  const choose = (event: JSX.TargetedEvent<HTMLInputElement, Event>): void => {
    const file = event.currentTarget.files?.[0];
    if (file !== undefined) props.onImport(file);
    event.currentTarget.value = '';
  };

  const classes = Object.entries(sheet.classLevels)
    .map(([id, count]) => `${id} ${count}`)
    .join(' / ');

  const pickedSubclasses = sheet.selections
    .filter((selection) => selection.pool.startsWith('subclass:'))
    .flatMap((selection) => selection.picks.map((pick) => pick.name));

  return (
    <>
      <Panel
        title={sheet.name}
        hint={`${classes === '' ? 'no levels yet' : classes} · level ${sheet.totalLevel} · proficiency ${signed(sheet.proficiencyBonus)}${pickedSubclasses.length === 0 ? '' : ` · ${pickedSubclasses.join(', ')}`}`}
      >
        <div class="stats">
          <Stat label="Armour class" value={sheet.armorClass} hint={sheet.armorClassBreakdown} />
          <Stat label="Hit points" value={sheet.hitPoints.maximum} hint={sheet.hitPoints.breakdown} />
          <Stat label="Initiative" value={signed(sheet.initiative)} />
          <Stat label="Speed" value={`${sheet.speed} ft`} />
          <Stat label="Hit dice" value={Object.entries(sheet.hitDice).map(([die, n]) => `${n}${die}`).join(' ') || '—'} />
          <Stat label="Attacks per action" value={sheet.attacksPerAction} hint={`crit on ${sheet.critRange}+`} />
        </div>

        <div class="abilities readout">
          {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((ability) => (
            <div class="ability" key={ability}>
              <span>{ABILITY_NAMES[ability]}</span>
              <b>{sheet.abilities[ability].score}</b>
              <em>{signed(sheet.abilities[ability].modifier)}</em>
            </div>
          ))}
        </div>
      </Panel>

      <Notice tone="error" title="The rules objected to this character" items={sheet.diagnostics} />

      <Panel title="Saving throws">
        <div class="inline-list">
          {sheet.saves.map((save) => (
            <span class={save.proficient ? 'pill on' : 'pill'} key={save.ability}>
              {ABILITY_NAMES[save.ability]} {signed(save.bonus)}
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="Skills" hint="Passive Perception, Investigation and Insight follow from these.">
        <table class="skills">
          <tbody>
            {sheet.skills.map((skill) => (
              <tr key={skill.id} class={skill.proficient || skill.halfProficiency ? 'on' : ''}>
                <td>{skill.id.replace(/-/g, ' ')}</td>
                <td class="muted">{ABILITY_NAMES[skill.ability].slice(0, 3).toUpperCase()}</td>
                <td class="num">{signed(skill.bonus)}</td>
                <td class="marks">
                  {skill.expertise ? 'expertise' : skill.proficient ? 'proficient' : skill.halfProficiency ? 'half' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="inline-list">
          {Object.entries(sheet.passive).map(([skill, value]) => (
            <span class="pill" key={skill}>passive {skill} {value}</span>
          ))}
          {sheet.checkFloor !== null && <span class="pill">d20 floor {sheet.checkFloor}</span>}
        </div>
      </Panel>

      <Panel title="Attacks">
        <table class="attacks">
          <thead>
            <tr><th>Attack</th><th>Ability</th><th>To hit</th><th>Damage</th></tr>
          </thead>
          <tbody>
            {sheet.attacks.map((attack) => (
              <tr key={attack.name}>
                <td>
                  {attack.name}
                  {attack.notes.map((note, index) => (
                    <span class="note" key={index}>{note}</span>
                  ))}
                </td>
                <td class="muted">{attack.ability.toUpperCase()}</td>
                <td class="num">{signed(attack.toHit)}</td>
                <td>
                  {attack.damage.map((part, index) => (
                    <span class={part.conditional ? 'damage conditional' : 'damage'} key={index}>
                      {diceText(part.dice, part.flat)} {part.damageType}
                      {part.label !== null && part.label !== '' && <em> ({part.label})</em>}
                      {part.conditional && <em> — if the player opts in</em>}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {sheet.spellcasting.length > 0 && (
        <Panel title="Spellcasting">
          {sheet.spellcasting.map((casting) => (
            <div class="casting" key={casting.source}>
              <h3>{casting.source}</h3>
              <div class="stats">
                <Stat label="Save DC" value={casting.saveDc} hint={`${casting.ability.toUpperCase()} based`} />
                <Stat label="Attack bonus" value={signed(casting.attackBonus)} />
              </div>
              <div class="inline-list">
                {casting.slots.map((count, index) =>
                  count === 0 ? null : (
                    <span class="pill" key={index}>level {index + 1}: {count} slots</span>
                  ),
                )}
              </div>
              <p class="muted">Spell lists are not implemented yet — slots and DC are.</p>
            </div>
          ))}
        </Panel>
      )}

      {sheet.resources.length > 0 && (
        <Panel title="Resources">
          <div class="inline-list">
            {sheet.resources.map((resource) => (
              <span class="pill" key={resource.id}>
                {resource.id} {resource.max} <em>({resource.recharge} rest)</em>
              </span>
            ))}
          </div>
        </Panel>
      )}

      {sheet.selections.length > 0 && (
        <Panel title="Choices made">
          {sheet.selections.map((selection) => (
            <div class="chosen" key={selection.pool}>
              <strong>{selection.label}</strong>{' '}
              <span class="muted">
                {selection.picks.length} of {selection.entitled}
              </span>
              <div class="inline-list">
                {selection.picks.map((pick) => (
                  <span class="pill on" key={pick.id}>{pick.name}</span>
                ))}
                {selection.picks.length === 0 && <span class="muted">nothing chosen</span>}
              </div>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Features" hint="What the sheet cannot compute, printed so it can be read.">
        <ul class="notes">
          {sheet.notes.map((note, index) => (
            <li key={index}>
              <strong>{note.name}</strong> <span class="muted">(level {note.level})</span>
              <p>{note.summary}</p>
            </li>
          ))}
          {sheet.notes.length === 0 && <li class="muted">No features yet.</li>}
        </ul>
      </Panel>

      <Panel title="Save this character" hint="Export is the real save: the browser's copy can be cleared, a file cannot.">
        <div class="row">
          <button type="button" onClick={props.onExport}>Export character file</button>
          <label class="upload small">
            <input type="file" accept=".json,application/json" onChange={choose} />
            <span>Import a character…</span>
          </label>
        </div>
        <p class="muted">
          Packs this character was built against: {definition.packs.length === 0 ? 'none recorded' : definition.packs.map((pack) => `${pack.id} v${pack.version}`).join(', ')}
          {props.packLabel === '' ? '' : ` · loaded now: ${props.packLabel}`}
        </p>
      </Panel>
    </>
  );
}
