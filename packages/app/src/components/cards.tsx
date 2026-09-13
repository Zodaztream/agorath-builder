/**
 * The card, which is what every choice in this builder is made of.
 *
 * A dropdown says "pick one of these twelve words". A card says what the thing
 * *is* — the sentence the pack wrote about it, and the two or three facts that
 * decide it — so a player who has never read a rulebook can choose without
 * leaving the page. Everything a card shows comes from the catalogue or from a
 * derivation; none of it is written here.
 */

import type { ComponentChildren, JSX } from 'preact';

export interface CardFact {
  readonly label: string;
  readonly value: string;
}

export function Card(props: {
  title: string;
  summary?: string;
  facts?: readonly CardFact[];
  selected?: boolean;
  disabled?: boolean;
  /** Rendered inside the card, under the facts — usually a pick control. */
  children?: ComponentChildren;
  onSelect?: () => void;
}): JSX.Element {
  const selected = props.selected === true;

  return (
    <div class={`card${selected ? ' on' : ''}${props.disabled === true ? ' off' : ''}`}>
      <button
        type="button"
        class="card-head"
        disabled={props.disabled === true}
        aria-pressed={selected}
        onClick={props.onSelect}
      >
        <span class="card-title">
          <span class="card-mark" aria-hidden="true">{selected ? '✓' : ''}</span>
          {props.title}
        </span>
        {props.summary !== undefined && props.summary !== '' && (
          <span class="card-summary">{props.summary}</span>
        )}
        {props.facts !== undefined && props.facts.length > 0 && (
          <span class="card-facts">
            {props.facts.map((fact) => (
              <span class="card-fact" key={fact.label}>
                <span class="card-fact-label">{fact.label}</span>
                <span class="card-fact-value">{fact.value}</span>
              </span>
            ))}
          </span>
        )}
      </button>
      {props.children !== undefined && <div class="card-body">{props.children}</div>}
    </div>
  );
}

export function CardGrid(props: { children: ComponentChildren }): JSX.Element {
  return <div class="cards">{props.children}</div>;
}

/**
 * A compact pick, for choosing between things that need no explaining: a skill
 * is a word, and eighteen cards with nothing in them would be worse than a
 * grid of buttons.
 */
export function PickChip(props: {
  label: string;
  title?: string;
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class={`chip${props.selected ? ' on' : ''}`}
      aria-pressed={props.selected}
      disabled={props.disabled === true}
      title={props.title}
      onClick={props.onToggle}
    >
      {props.label}
    </button>
  );
}
