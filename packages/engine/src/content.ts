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
  OptionEntry,
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
  readonly option: (id: string) => OptionEntry | null;
  /**
   * Membership of a content-backed pool. The engine asks by tag rather than
   * holding a list, which is why an offer naming a pool nobody has authored
   * options for has to be *diagnosed* — nothing else would notice.
   */
  readonly options: (pool: string) => readonly OptionEntry[];
  /** Membership of `subclass:<classId>`, from `SubclassEntry.class`. */
  readonly subclassesOf: (classId: string) => readonly SubclassEntry[];
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
  readonly options?: readonly OptionEntry[];
}): ContentProvider {
  const byId = <T extends { readonly id: string }>(list: readonly T[] | undefined) => {
    const map = new Map<string, T>();
    for (const entry of list ?? []) map.set(entry.id, entry);
    return (id: string): T | null => map.get(id) ?? null;
  };
  const byTag = <T extends { readonly id: string }>(
    list: readonly T[] | undefined,
    tagOf: (entry: T) => string,
  ) => {
    const map = new Map<string, T[]>();
    for (const entry of list ?? []) {
      const tag = tagOf(entry);
      const bucket = map.get(tag);
      if (bucket === undefined) map.set(tag, [entry]);
      else bucket.push(entry);
    }
    return (tag: string): readonly T[] => map.get(tag) ?? [];
  };

  const classes = byId(source.classes);
  const subclasses = byId(source.subclasses);
  const races = byId(source.races);
  const backgrounds = byId(source.backgrounds);
  const feats = byId(source.feats);
  const items = byId(source.items);
  const options = byId(source.options);
  const optionsByPool = byTag(source.options, (entry) => entry.pool);
  const subclassesByClass = byTag(source.subclasses, (entry) => entry.class);

  return {
    class: classes,
    subclass: subclasses,
    race: races,
    background: backgrounds,
    feat: feats,
    item: items,
    option: options,
    options: optionsByPool,
    subclassesOf: subclassesByClass,
  };
}
