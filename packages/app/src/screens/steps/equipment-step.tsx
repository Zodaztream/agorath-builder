/**
 * Choose your equipment.
 *
 * The step where the character starts producing numbers. Every card states what
 * the item *does* — a weapon's damage and properties, armour's base AC and how
 * much DEX it allows — and the panel at the top moves as things are added, so
 * the connection between "I picked chain mail" and "my Armour Class is 18" is
 * visible rather than inferred.
 *
 * Starting-equipment packages ("a longsword, a shield, and one of the following")
 * are **not** in the pack format yet, so this offers the list and says so rather
 * than inventing the packages.
 */

import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  DAMAGE_TYPES,
  type CharacterDefinition,
  type ContentProvider,
  type DamageType,
  type DerivedSheet,
  type InventoryItem,
  type ItemEntry,
} from '@agorath/engine';
import type { PackCatalog } from '@agorath/content';
import { addItem, removeItem, setItem } from '../../store.ts';
import { signed, titleCase } from '../../text.ts';
import { Card, CardGrid } from '../../components/cards.tsx';
import { Field, Stat } from '../../ui.tsx';

export function EquipmentStep(props: {
  definition: CharacterDefinition;
  content: ContentProvider;
  catalog: PackCatalog;
  sheet: DerivedSheet;
  onChange: (definition: CharacterDefinition) => void;
}): JSX.Element {
  const { definition, content, catalog, sheet, onChange } = props;

  const held = new Map<string, number>();
  definition.inventory.forEach((item, index) => held.set(item.item, index));

  const toggle = (itemId: string): void => {
    const index = held.get(itemId);
    if (index === undefined) {
      const item: InventoryItem = { item: itemId, quantity: 1, equipped: true, attuned: false, custom: null };
      onChange(addItem(definition, item));
    } else {
      onChange(removeItem(definition, index));
    }
  };

  const groups = groupItems(catalog, content);

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

      <p class="muted">
        Click an item to take it; click it again to put it down. Equipped weapons become attack lines
        on the sheet and worn armour sets your Armour Class. Starting-equipment packages are not in
        the pack format yet, so there is nothing here that says what a class starts with — take what
        your table agrees on.
      </p>

      {groups.map((group) => (
        <section class="equip-group" key={group.title}>
          <h3>{group.title}</h3>
          <CardGrid>
            {group.entries.map(({ entry, item }) => (
              <Card
                key={entry.id}
                title={entry.name}
                summary={item.summary}
                facts={itemFacts(item)}
                selected={held.has(entry.id)}
                onSelect={() => toggle(entry.id)}
              />
            ))}
            {group.entries.length === 0 && <p class="muted">Nothing of this kind in the loaded pack.</p>}
          </CardGrid>
        </section>
      ))}

      <section class="equip-group">
        <h3>Carrying</h3>
        <table class="items">
          <thead>
            <tr><th>Item</th><th class="num">Qty</th><th>Equipped</th><th>Attuned</th><th /></tr>
          </thead>
          <tbody>
            {definition.inventory.map((carried, index) => {
              const name = carried.custom?.name ?? content.item(carried.item)?.name ?? carried.item;
              const needsAttunement = content.item(carried.item)?.requiresAttunement ?? false;
              return (
                <tr key={index}>
                  <td>
                    {name}
                    {carried.custom !== null && <span class="badge">custom</span>}
                    {needsAttunement && <span class="badge">attunement</span>}
                  </td>
                  <td class="num">
                    <input
                      type="number"
                      min={0}
                      value={carried.quantity}
                      onInput={(event) => onChange(setItem(definition, index, { quantity: Number(event.currentTarget.value) }))}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={carried.equipped}
                      onChange={(event) => onChange(setItem(definition, index, { equipped: event.currentTarget.checked }))}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={carried.attuned}
                      onChange={(event) => onChange(setItem(definition, index, { attuned: event.currentTarget.checked }))}
                    />
                  </td>
                  <td>
                    <button type="button" class="link" onClick={() => onChange(removeItem(definition, index))}>put down</button>
                  </td>
                </tr>
              );
            })}
            {definition.inventory.length === 0 && (
              <tr><td colSpan={5} class="muted">Carrying nothing yet.</td></tr>
            )}
          </tbody>
        </table>
        <p class="muted">
          Attunement is capped at three items by the rules, and the sheet says so if you go past it.
        </p>
      </section>

      <CustomItemForm definition={definition} content={content} catalog={catalog} onChange={onChange} />
    </>
  );
}

type GroupedEntry = { readonly entry: { readonly id: string; readonly name: string }; readonly item: ItemEntry };

interface Grouped {
  readonly title: string;
  readonly entries: readonly GroupedEntry[];
}

/**
 * The packs are long — twenty-six weapons in the pilot slice alone — and a
 * single wall of cards is not a choice anybody can weigh. So they are split by
 * what the entries *say they are*: a weapon's own `category`, an armour's own
 * `kind`. That is derived, not authored, and a pack that adds a category shows
 * up as its own group.
 */
function groupItems(catalog: PackCatalog, content: ContentProvider): readonly Grouped[] {
  const groups = new Map<string, GroupedEntry[]>();
  const add = (title: string, entry: GroupedEntry): void => {
    const bucket = groups.get(title);
    if (bucket === undefined) groups.set(title, [entry]);
    else bucket.push(entry);
  };

  for (const entry of catalog.items) {
    const item = content.item(entry.id);
    if (item === null) continue;
    const grouped = { entry, item };

    if (item.weapon !== null) {
      add(item.weapon.category === 'martial' ? 'Martial weapons' : 'Simple weapons', grouped);
    } else if (item.armor !== null) {
      const kind = item.armor.kind;
      add(kind === 'shield' ? 'Shields' : `${titleCase(kind)} armour`, grouped);
    } else {
      add('Other gear', grouped);
    }
  }

  // Weapons first, then armour by weight, then the rest: the order a character
  // is actually equipped in.
  const ORDER = ['Simple weapons', 'Martial weapons', 'Light armour', 'Medium armour', 'Heavy armour', 'Shields', 'Other gear'];
  return ORDER.filter((title) => groups.has(title)).map((title) => ({ title, entries: groups.get(title) ?? [] }));
}

/** What an item does, as facts on its card. */
function itemFacts(item: ItemEntry): readonly { readonly label: string; readonly value: string }[] {
  if (item.weapon !== null) {
    const weapon = item.weapon;
    const damage = `${weapon.damage.count}d${weapon.damage.die}${weapon.versatile === null ? '' : ` (${weapon.versatile.count}d${weapon.versatile.die} two-handed)`}`;
    const reach = weapon.melee && weapon.ranged ? 'melee or thrown' : weapon.ranged ? 'ranged' : 'melee';
    return [
      { label: 'Damage', value: `${damage} ${weapon.damageType}` },
      { label: 'Used', value: reach },
      ...(weapon.properties.length === 0 ? [] : [{ label: 'Properties', value: weapon.properties.join(', ') }]),
    ];
  }

  if (item.armor !== null) {
    const armor = item.armor;
    const dex = armor.kind === 'shield' ? 'held, +2 AC' : armor.maxDex === null ? 'DEX added in full' : armor.maxDex === 0 ? 'DEX ignored' : `DEX up to ${signed(armor.maxDex)}`;
    return [
      { label: 'Armour class', value: `${armor.baseAc}` },
      { label: 'Dexterity', value: dex },
    ];
  }

  return item.requiresAttunement ? [{ label: 'Requires', value: 'attunement' }] : [];
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
  const [base, setBase] = useState('');
  const [hit, setHit] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [count, setCount] = useState(0);
  const [die, setDie] = useState(6);
  const [damageType, setDamageType] = useState<DamageType>('fire');

  // Only something with mundane statistics to inherit can be a base.
  const bases = catalog.items.filter((entry) => {
    const item = content.item(entry.id);
    return item !== null && (item.weapon !== null || item.armor !== null);
  });

  const chosenBase = base === '' ? bases[0]?.id ?? '' : base;

  return (
    <details class="custom">
      <summary>Make a custom item</summary>
      <p class="muted">
        The tool's answer to "the DM handed me a +2 flaming longsword". Built on a real base item, so
        the mundane statistics come from the pack rather than from typing. Balance is your table's
        business; the tool computes.
      </p>
      <div class="grid">
        <Field label="Item name">
          <input
            type="text"
            value={name}
            placeholder="Vesaria's Fang"
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        <Field label="Base">
          <select value={chosenBase} onChange={(event) => setBase(event.currentTarget.value)}>
            {bases.map((entry) => (
              <option value={entry.id} key={entry.id}>{entry.name}</option>
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
        disabled={chosenBase === ''}
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
              base: chosenBase === '' ? null : chosenBase,
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
