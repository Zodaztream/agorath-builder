/**
 * Turning values into the characters a player reads.
 *
 * Plain TS, and separate from `ui.tsx` on purpose: these are the functions the
 * tests can call. A component file cannot be imported by `node --test` — JSX is
 * not something the type stripper handles — so anything worth testing lives
 * here rather than next to the markup that uses it.
 */

/** `+2`, `-1`, `+0`: the sign a modifier is always written with. */
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

/** 1 → `1st`, 2 → `2nd`, 11 → `11th`. */
export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

/** `sleight-of-hand` reads as an id; a card should read as words. */
export function titleCase(text: string): string {
  return text
    .split(/[\s-]+/)
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
