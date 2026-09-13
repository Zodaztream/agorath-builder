/**
 * The few pieces every screen shares.
 *
 * Deliberately plain: the engine holds the value, and the UI is replaceable
 * (ADR-0003). Anything clever here would be a thing to port later.
 */

import type { ComponentChildren, JSX } from 'preact';

export function Panel(props: { title: string; hint?: string; children: ComponentChildren }): JSX.Element {
  return (
    <section class="panel">
      <header>
        <h2>{props.title}</h2>
        {props.hint !== undefined && <p class="hint">{props.hint}</p>}
      </header>
      {props.children}
    </section>
  );
}

export function Field(props: { label: string; children: ComponentChildren }): JSX.Element {
  return (
    <label class="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function Notice(props: {
  tone: 'error' | 'warning' | 'info';
  title: string;
  items: readonly string[];
}): JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <div class={`notice notice-${props.tone}`}>
      <strong>
        {props.title} ({props.items.length})
      </strong>
      <ul>
        {props.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function Stat(props: { label: string; value: string | number; hint?: string }): JSX.Element {
  return (
    <div class="stat">
      <span class="stat-label">{props.label}</span>
      <span class="stat-value">{props.value}</span>
      {props.hint !== undefined && <span class="stat-hint">{props.hint}</span>}
    </div>
  );
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/** `{ count: 2, die: 6 }` → `2d6`; a null dice is a flat number. */
export function diceText(dice: { count: number; die: number } | null, flat: number): string {
  const dicePart = dice === null ? '' : `${dice.count}d${dice.die}`;
  if (dicePart === '') return `${flat}`;
  if (flat === 0) return dicePart;
  return `${dicePart} ${flat >= 0 ? '+' : '-'} ${Math.abs(flat)}`;
}
