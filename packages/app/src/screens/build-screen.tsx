/**
 * The builder.
 *
 * Everything here is an edit to the definition; nothing here computes a rule.
 * Every number on the right of the screen comes from `derive()` during render,
 * including which choices exist to be made — so the builder cannot offer
 * something the rules do not allow, and cannot hide something they do.
 *
 * The two places that look like UI decisions and are really engine decisions:
 *
 * - **Which pools exist** comes from `sheet.selections`. A level-1 fighter has
 *   no archetype pool at all, so no archetype picker is rendered.
 * - **Where a pick is recorded** comes from the engine's own view of when each
 *   pool first appears (`poolHomes`), which is why a subclass pick lands on the
 *   3rd level entry rather than wherever the cursor happened to be.
 */

import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  DAMAGE_TYPES,
  type Ability,
  type CharacterDefinition,
  type ContentProvider,
  type DamageType,
  type DerivedSheet,
  type InventoryItem,
  type LevelEntry,
} from '@agorath/engine';
import type { PackCatalog } from '@agorath/content';
import {
  ABILITY_LABELS,
  ABILITY_ORDER,
  addItem,
  addLevel,
  removeItem,
  removeLevel,
  setAbility,
  setAdvancement,
  setItem,
  setLevel,
  setPicks,
} from '../store.ts';
import { Field, Panel, signed } from '../ui.tsx';

export function BuildScreen(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  catalog: PackCatalog;
  sheet: DerivedSheet;
  homes: ReadonlyMap<string, number>;
  onChange: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const { definition, content, catalog, sheet, homes, onChange } = props;

  const classLevelsSoFar = (upto: number): number => {
    const cls = definition.levels[upto]?.class;
    return definition.levels.slice(0, upto + 1).filter((level) => level.class === cls).length;
  };

  return (
    <>
      <Panel title="The character" hint="Every number below is recomputed from these inputs, never stored.">
        <div class="grid">
          <Field label="Name">
            <input
              type="text"
              value={definition.name}
              onInput={(event) => onChange({ ...definition, name: event.currentTarget.value })}
            />
          </Field>
          <Field label="Race">
            <select
              value={definition.race ?? ''}
              onChange={(event) => onChange({ ...definition, race: event.currentTarget.value || null })}
            >
              <option value="">— none —</option>
              {catalog.races.map((race) => (
                <option value={race.id} key={race.id}>{race.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Background">
            <select
              value={definition.background ?? ''}
              onChange={(event) => onChange({ ...definition, background: event.currentTarget.value || null })}
            >
              <option value="">— none —</option>
              {catalog.backgrounds.map((background) => (
                <option value={background.id} key={background.id}>{background.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <h3>Ability scores</h3>
        <p class="muted">
          Typed in, for now: point-buy and rolling are their own small projects. What matters is
          that everything downstream moves when these change.
        </p>
        <div class="abilities">
          {ABILITY_ORDER.map((ability) => (
            <label class="ability" key={ability}>
              <span>{ABILITY_LABELS[ability]}</span>
              <input
                type="number"
                min={1}
                max={30}
                value={definition.abilities[ability]}
                onInput={(event) => onChange(setAbility(definition, ability, Number(event.currentTarget.value)))}
              />
              <em>{signed(sheet.abilities[ability].modifier)}</em>
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="Levels" hint="The order matters: it decides multiclass entry, hit points and class levels.">
        {definition.levels.length === 0 && <p class="muted">No levels yet — take one to begin.</p>}

        {definition.levels.map((level, index) => (
          <LevelRow
            key={index}
            index={index}
            level={level}
            classLevel={classLevelsSoFar(index)}
            catalog={catalog}
            sheet={sheet}
            definition={definition}
            onChange={onChange}
          />
        ))}

        <div class="row">
          <ClassPicker
            catalog={catalog}
            onPick={(classId) => onChange(addLevel(definition, classId))}
            label="Add a level of…"
          />
        </div>
      </Panel>

      {sheet.selections.length > 0 && (
        <Panel title="Choices" hint="Offered by the features you have. Nothing here is free-form.">
          {sheet.selections.map((selection) => {
            const picked = selection.picks.map((pick) => pick.id);
            const full = picked.length >= selection.entitled;
            const home = homes.get(selection.pool);
            const offered = selection.entitled > 0;

            return (
              <div class="pool" key={selection.pool}>
                <h3>
                  {selection.label}{' '}
                  <span class={full ? 'badge done' : 'badge'}>
                    {picked.length} of {selection.entitled}
                  </span>
                  {!offered && <span class="badge bad">not offered</span>}
                </h3>
                <div class="candidates">
                  {selection.candidates.map((candidate) => {
                    const isPicked = picked.includes(candidate.id);
                    return (
                      <label class={isPicked ? 'candidate picked' : 'candidate'} key={candidate.id}>
                        <input
                          type="checkbox"
                          checked={isPicked}
                          disabled={!isPicked && full}
                          onChange={(event) => {
                            if (home === undefined) return;
                            const next = event.currentTarget.checked
                              ? [...picked, candidate.id]
                              : picked.filter((id) => id !== candidate.id);
                            onChange(setPicks(definition, home, selection.pool, next));
                          }}
                        />
                        <span class="candidate-name">{candidate.name}</span>
                        {candidate.summary !== '' && <em class="candidate-summary">{candidate.summary}</em>}
                      </label>
                    );
                  })}
                  {selection.candidates.length === 0 && (
                    <p class="muted">Nothing to choose from — the pack offers no candidates here.</p>
                  )}
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      <InventoryPanel
        definition={definition}
        content={content}
        catalog={catalog}
        onChange={onChange}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function ClassPicker(props: {
  catalog: PackCatalog;
  onPick: (classId: string) => void;
  label: string;
}): JSX.Element {
  return (
    <select
      value=""
      onChange={(event) => {
        const value = event.currentTarget.value;
        if (value !== '') props.onPick(value);
        event.currentTarget.value = '';
      }}
    >
      <option value="">{props.label}</option>
      {props.catalog.classes.map((entry) => (
        <option value={entry.id} key={entry.id}>{entry.name}</option>
      ))}
    </select>
  );
}

function LevelRow(props: {
  index: number;
  level: LevelEntry;
  classLevel: number;
  catalog: PackCatalog;
  sheet: DerivedSheet;
  definition: CharacterDefinition;
  onChange: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const { index, level, classLevel, sheet, definition, onChange } = props;
  const advancement = sheet.advancements.find((a) => a.level === index);
  const chosen = level.choices.find((choice) => choice.kind === 'asi' || choice.kind === 'feat');

  return (
    <div class="level">
      <div class="level-row">
        <span class="level-index">L{index + 1}</span>
        <select
          value={level.class}
          onChange={(event) => onChange(setLevel(definition, index, { class: event.currentTarget.value }))}
        >
          {props.catalog.classes.map((entry) => (
            <option value={entry.id} key={entry.id}>{entry.name}</option>
          ))}
        </select>
        <span class="muted">{level.class} {classLevel}</span>
        <select
          value={level.hp.mode}
          onChange={(event) => onChange(setLevel(definition, index, {
            hp: event.currentTarget.value === 'rolled' ? { mode: 'rolled', value: 1 } : { mode: 'average' },
          }))}
        >
          <option value="average">Average HP</option>
          <option value="rolled">Rolled…</option>
        </select>
        {level.hp.mode === 'rolled' && (
          <input
            type="number"
            min={1}
            value={level.hp.value}
            onInput={(event) => onChange(setLevel(definition, index, {
              hp: { mode: 'rolled', value: Math.max(1, Number(event.currentTarget.value)) },
            }))}
          />
        )}
        <button type="button" class="link" onClick={() => onChange(removeLevel(definition, index))}>remove</button>
      </div>

      {advancement !== undefined && (
        <div class={`advancement ${advancement.taken ? 'taken' : ''}`}>
          <span class="muted">
            {classLevel}th level grants an Ability Score Improvement or a feat
            {advancement.taken ? ' — taken' : ''}.
          </span>
          {chosen !== undefined && (
            <button type="button" class="link" onClick={() => onChange(setAdvancement(definition, index, null))}>
              clear
            </button>
          )}
          <div class="row">
            <select
              value=""
              onChange={(event) => {
                const ability = event.currentTarget.value;
                if (ability === '') return;
                onChange(setAdvancement(definition, index, { kind: 'asi', increases: [{ ability: ability as Ability, amount: 2 }] }));
                event.currentTarget.value = '';
              }}
            >
              <option value="">+2 to…</option>
              {ABILITY_ORDER.map((ability) => (
                <option value={ability} key={ability}>{ABILITY_LABELS[ability]}</option>
              ))}
            </select>

            {[0, 1].map((slot) => {
              const increases = chosen?.kind === 'asi' ? chosen.increases : [];
              const other = increases[slot === 0 ? 1 : 0];
              return (
                <select
                  key={slot}
                  value=""
                  onChange={(event) => {
                    const ability = event.currentTarget.value;
                    if (ability === '') return;
                    const next = [
                      ...(slot === 0
                        ? [{ ability: ability as Ability, amount: 1 }]
                        : other !== undefined ? [other] : []),
                      ...(slot === 0
                        ? other !== undefined ? [other] : []
                        : [{ ability: ability as Ability, amount: 1 }]),
                    ];
                    onChange(setAdvancement(definition, index, { kind: 'asi', increases: next }));
                    event.currentTarget.value = '';
                  }}
                >
                  <option value="">+1 to…</option>
                  {ABILITY_ORDER.map((ability) => (
                    <option value={ability} key={ability}>{ABILITY_LABELS[ability]}</option>
                  ))}
                </select>
              );
            })}

            <select
              value=""
              onChange={(event) => {
                const feat = event.currentTarget.value;
                if (feat === '') return;
                onChange(setAdvancement(definition, index, { kind: 'feat', feat }));
                event.currentTarget.value = '';
              }}
            >
              <option value="">or a feat…</option>
              {props.catalog.feats.map((feat) => (
                <option value={feat.id} key={feat.id}>{feat.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryPanel(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  catalog: PackCatalog;
  onChange: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const { definition, content, catalog, onChange } = props;

  const addById = (id: string): void => {
    const item: InventoryItem = { item: id, quantity: 1, equipped: true, attuned: false, custom: null };
    onChange(addItem(definition, item));
  };

  return (
    <Panel title="Inventory" hint="Equipping feeds armour class and the attack list. Attunement is capped at three.">
      <div class="row">
        <select
          value=""
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value !== '') addById(value);
            event.currentTarget.value = '';
          }}
        >
          <option value="">Add an item…</option>
          {catalog.items.map((item) => (
            <option value={item.id} key={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      <table class="items">
        <thead>
          <tr><th>Item</th><th>Qty</th><th>Equipped</th><th>Attuned</th><th /></tr>
        </thead>
        <tbody>
          {definition.inventory.map((held, index) => {
            const name = held.custom?.name ?? content.item(held.item)?.name ?? held.item;
            return (
              <tr key={index}>
                <td>{name}{held.custom !== null && <span class="badge">custom</span>}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={held.quantity}
                    onInput={(event) => onChange(setItem(definition, index, { quantity: Number(event.currentTarget.value) }))}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={held.equipped}
                    onChange={(event) => onChange(setItem(definition, index, { equipped: event.currentTarget.checked }))}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={held.attuned}
                    onChange={(event) => onChange(setItem(definition, index, { attuned: event.currentTarget.checked }))}
                  />
                </td>
                <td>
                  <button type="button" class="link" onClick={() => onChange(removeItem(definition, index))}>remove</button>
                </td>
              </tr>
            );
          })}
          {definition.inventory.length === 0 && (
            <tr><td colSpan={5} class="muted">Nothing carried yet.</td></tr>
          )}
        </tbody>
      </table>

      <CustomItemForm content={content} catalog={catalog} definition={definition} onChange={onChange} />
    </Panel>
  );
}

/**
 * A player-authored item, built on a real base.
 *
 * The base is what makes this safe: choosing a longsword supplies the damage
 * die, weight and properties, so the mundane half of the item can never be
 * wrong. Only the parts a player invents are typed.
 */
function CustomItemForm(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  catalog: PackCatalog;
  onChange: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const { content, catalog, definition, onChange } = props;
  const [name, setName] = useState('');
  const [base, setBase] = useState('longsword');
  const [hit, setHit] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [count, setCount] = useState(0);
  const [die, setDie] = useState(6);
  const [damageType, setDamageType] = useState<DamageType>('fire');

  // Only something with mundane statistics to inherit can be a base.
  const bases = catalog.items.filter((item) => {
    const entry = content.item(item.id);
    return entry !== null && (entry.weapon !== null || entry.armor !== null);
  });

  return (
    <details class="custom">
      <summary>Make a custom item</summary>
      <p class="muted">
        Built on a real base item, so the mundane statistics come from the pack rather than from
        typing. Balance is your table's business; the tool computes.
      </p>
      <div class="grid">
        <Field label="Item name">
          <input type="text" value={name} placeholder="Vesaria's Fang"
            onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Field label="Base">
          <select value={base} onChange={(event) => setBase(event.currentTarget.value)}>
            {bases.map((item) => (
              <option value={item.id} key={item.id}>{item.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Bonus to hit">
          <input type="number" value={hit} onInput={(event) => setHit(Number(event.currentTarget.value))} />
        </Field>
        <Field label="Bonus to damage">
          <input type="number" value={bonus} onInput={(event) => setBonus(Number(event.currentTarget.value))} />
        </Field>
        <Field label="Extra damage dice">
          <input type="number" min={0} max={10} value={count} onInput={(event) => setCount(Number(event.currentTarget.value))} />
        </Field>
        <Field label="Die">
          <select value={die} onChange={(event) => setDie(Number(event.currentTarget.value))}>
            {[4, 6, 8, 10, 12].map((size) => (
              <option value={size} key={size}>d{size}</option>
            ))}
          </select>
        </Field>
        <Field label="Damage type">
          <select value={damageType} onChange={(event) => setDamageType(event.currentTarget.value as DamageType)}>
            {DAMAGE_TYPES.map((type) => (
              <option value={type} key={type}>{type}</option>
            ))}
          </select>
        </Field>
      </div>
      <button
        type="button"
        onClick={() => {
          const id = `custom-${Date.now().toString(36)}`;
          const label = name.trim() === '' ? 'Custom item' : name.trim();
          const item: InventoryItem = {
            item: id,
            quantity: 1,
            equipped: true,
            attuned: false,
            custom: {
              id,
              name: label,
              tier: 'custom',
              base: base === '' ? null : base,
              effects: [
                ...(hit === 0 ? [] : [{ shape: 'attack.bonus' as const, amount: hit }]),
                ...(bonus === 0 ? [] : [{ shape: 'damage.bonus' as const, amount: bonus }]),
                ...(count === 0 ? [] : [{
                  shape: 'damage.dice' as const,
                  dice: { count, die },
                  damageType,
                  label,
                }]),
              ],
            },
          };
          onChange(addItem(definition, item));
          setName('');
          setHit(0);
          setBonus(0);
          setCount(0);
        }}
      >
        Add to inventory
      </button>
    </details>
  );
}

