/**
 * How the engine reaches content.
 *
 * The engine never knows where content came from — a pack file, a test fixture,
 * or a player's own item. It asks a provider by id and gets an entry or
 * nothing. That is what keeps the rules independent of the pack format.
 */

import type {
  BackgroundEntry,
  ClassEntry,
  FeatEntry,
  ItemEntry,
  RaceEntry,
  SubclassEntry,
} from './types.ts';

export interface ContentProvider {
  readonly class: (id: string) => ClassEntry | null;
  readonly subclass: (id: string) => SubclassEntry | null;
  readonly race: (id: string) => RaceEntry | null;
  readonly background: (id: string) => BackgroundEntry | null;
  readonly feat: (id: string) => FeatEntry | null;
  readonly item: (id: string) => ItemEntry | null;
}

/**
 * An in-memory provider. Used by tests, and by the app once a pack is loaded.
 *
 * Lookups return null rather than throwing, because a missing entry is a
 * *diagnostic* the sheet must report — a character built against a pack the
 * player no longer has must fail loudly and legibly, not crash.
 */
export function inMemoryContent(source: {
  readonly classes?: readonly ClassEntry[];
  readonly subclasses?: readonly SubclassEntry[];
  readonly races?: readonly RaceEntry[];
  readonly backgrounds?: readonly BackgroundEntry[];
  readonly feats?: readonly FeatEntry[];
  readonly items?: readonly ItemEntry[];
}): ContentProvider {
  const byId = <T extends { readonly id: string }>(list: readonly T[] | undefined) => {
    const map = new Map<string, T>();
    for (const entry of list ?? []) map.set(entry.id, entry);
    return (id: string): T | null => map.get(id) ?? null;
  };
  const classes = byId(source.classes);
  const subclasses = byId(source.subclasses);
  const races = byId(source.races);
  const backgrounds = byId(source.backgrounds);
  const feats = byId(source.feats);
  const items = byId(source.items);
  return { class: classes, subclass: subclasses, race: races, background: backgrounds, feat: feats, item: items };
}
