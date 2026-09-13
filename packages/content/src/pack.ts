/**
 * Reading a content pack — one file, every entry, loaded at runtime.
 *
 * The app ships with no book content (ADR-0002). A pack is a single JSON file a
 * player is given and uploads once; the browser parses it, keeps it, and never
 * sends it anywhere. This module is the whole of that seam: file text in, a
 * `ContentProvider` the engine can derive against, plus everything that is
 * wrong with it.
 *
 * **Nothing here throws on bad content.** A pack is assembled by hand from
 * pages of a book, so a typo is expected rather than exceptional; the useful
 * response is to load what is there and say precisely what is wrong. Errors
 * mean an entry was dropped or an effect cannot be applied. Warnings mean
 * something was understood but is not in force — a shape the catalogue names
 * that the engine has not implemented, a class whose subclass is not in this
 * pack, a citation missing.
 *
 * The check that matters most is the one for **an offer with no options**: a
 * pool is a tag, and a typo in it would otherwise silently offer an empty list.
 * That is why it is an error here and a diagnostic at the table.
 */

import {
  CLASS_RULES,
  DAMAGE_TYPES,
  EFFECT_SHAPES,
  SKILL_IDS,
  inMemoryContent,
  parseExpression,
  type Ability,
  type BackgroundEntry,
  type ClassEntry,
  type ContentProvider,
  type DamageType,
  type Effect,
  type FeatEntry,
  type FeatureEntry,
  type ItemEntry,
  type OptionEntry,
  type RaceEntry,
  type Scope,
  type SkillId,
  type SubclassEntry,
} from '@agorath/engine';

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export type PackTier = 'srd' | 'published' | 'homebrew' | 'custom';

export interface PackMeta {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly ruleset: '2014';
  readonly tier: PackTier;
  readonly requires: readonly string[];
}

/**
 * One entry, as the UI needs to list it. The engine never sees this.
 *
 * The summary is the pack's own sentence about the entry, carried through so a
 * chooser can say what it is offering. It is empty when the pack did not write
 * one, and a card must render that case rather than showing a gap.
 */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  /** The class a subclass belongs to, or the pool an option belongs to. */
  readonly group: string;
  readonly summary: string;
}

export interface PackCatalog {
  readonly classes: readonly CatalogEntry[];
  readonly subclasses: readonly CatalogEntry[];
  readonly races: readonly CatalogEntry[];
  readonly backgrounds: readonly CatalogEntry[];
  readonly feats: readonly CatalogEntry[];
  readonly items: readonly CatalogEntry[];
  readonly options: readonly CatalogEntry[];
  readonly counts: Readonly<Record<string, number>>;
}

export interface PackReadResult {
  /** Null when the envelope itself could not be read. */
  readonly meta: PackMeta | null;
  readonly provider: ContentProvider;
  readonly catalog: PackCatalog;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const TIERS: readonly PackTier[] = ['srd', 'published', 'homebrew', 'custom'];

/**
 * Shapes the catalogue names but the engine does not implement yet. Kept here
 * so a pack that uses one is *told* it is inert rather than quietly computing
 * nothing. This list shrinks as shapes land; it should never grow silently.
 */
const UNIMPLEMENTED_SHAPES: readonly string[] = [
  'damage.reroll',
  'attack.ability',
  'resource.dice',
  'ability.set-min',
  'resistance.grant',
  'immunity.grant',
  'save.advantage',
  'spell.grant',
  'spell.choose',
  'slots.table',
  'carry.multiply',
  'hitdie.set',
  'resource.dice',
  'dc.formula',
  'advancement.asi-or-feat',
];

/** Fields each entry kind may carry. Anything else is a typo until proven otherwise. */
const ALLOWED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  class: ['id', 'kind', 'name', 'source', 'tier', 'summary', 'features'],
  subclass: ['id', 'kind', 'name', 'class', 'source', 'tier', 'summary', 'features'],
  race: ['id', 'kind', 'name', 'source', 'tier', 'summary', 'abilityIncreases', 'effects'],
  background: ['id', 'kind', 'name', 'source', 'tier', 'summary', 'effects'],
  feat: ['id', 'kind', 'name', 'source', 'tier', 'summary', 'effects'],
  item: ['id', 'kind', 'name', 'source', 'tier', 'summary', 'weight', 'armor', 'weapon', 'requiresAttunement', 'effects'],
  option: ['id', 'kind', 'name', 'pool', 'source', 'tier', 'summary', 'prerequisites', 'effects'],
};

const ALLOWED_FEATURE_FIELDS: readonly string[] = ['id', 'name', 'level', 'summary', 'source', 'effects'];

const SCOPE_FIELDS: readonly string[] = ['kind', 'id', 'melee', 'ranged', 'properties', 'skills', 'abilities', 'or'];

const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

// ---------------------------------------------------------------------------
// Reading the whole file
// ---------------------------------------------------------------------------

/** Parse and validate a pack file's text. A syntax error is an error, not a throw. */
export function readPackText(text: string): PackReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      meta: null,
      provider: inMemoryContent({}),
      catalog: emptyCatalog(),
      errors: [`The pack file is not valid JSON: ${(error as Error).message}`],
      warnings: [],
    };
  }
  return readPack(parsed);
}

export function readPack(document: unknown): PackReadResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(document)) {
    return {
      meta: null,
      provider: inMemoryContent({}),
      catalog: emptyCatalog(),
      errors: ['The pack file is not a JSON object — expected { "pack": { … }, "entries": [ … ] }.'],
      warnings,
    };
  }

  const meta = readMeta(document['pack'], errors);
  const rawEntries = asArray(document['entries']);
  if (!Array.isArray(document['entries'])) {
    errors.push('The pack has no "entries" array. Nothing can be loaded from it.');
  }

  const classes: ClassEntry[] = [];
  const subclasses: SubclassEntry[] = [];
  const races: RaceEntry[] = [];
  const backgrounds: BackgroundEntry[] = [];
  const feats: FeatEntry[] = [];
  const items: ItemEntry[] = [];
  const options: OptionEntry[] = [];
  const seen = new Map<string, string>();

  rawEntries.forEach((raw, index) => {
    if (!isObject(raw)) {
      errors.push(`Entry ${index + 1} is not an object.`);
      return;
    }
    const kind = asString(raw['kind']);
    const id = asString(raw['id']);
    const where = `Entry ${index + 1} (${kind || 'no kind'}${id === '' ? '' : ` "${id}"`})`;

    if (kind === '') {
      errors.push(`${where}: missing "kind".`);
      return;
    }
    const allowed = ALLOWED_FIELDS[kind];
    if (allowed === undefined) {
      errors.push(`${where}: "${kind}" is not a kind of entry this engine knows.`);
      return;
    }
    if (id === '') {
      errors.push(`${where}: missing "id".`);
      return;
    }
    const firstSeen = seen.get(id);
    if (firstSeen !== undefined) {
      errors.push(`${where}: the id "${id}" is already used by a ${firstSeen}. Ids must be unique.`);
      return;
    }
    seen.set(id, kind);
    warnUnknownFields(raw, allowed, where, warnings);

    const name = asString(raw['name'], id);
    // Every entry carries the sentence the pack wrote about it, so a card can
    // describe what it is offering. See `CatalogEntry`.
    const summary = asString(raw['summary']);
    switch (kind) {
      case 'class':
        classes.push({ id, name, summary, source: readSource(raw['source']), features: readFeatures(raw['features'], `${name} features`, errors, warnings) });
        break;
      case 'subclass': {
        const parent = asString(raw['class']);
        if (parent === '') errors.push(`${where}: a subclass must name the class it belongs to ("class").`);
        subclasses.push({ id, name, summary, class: parent, features: readFeatures(raw['features'], `${name} features`, errors, warnings) });
        break;
      }
      case 'race':
        races.push({ id, name, summary, abilityIncreases: readIncreases(raw['abilityIncreases'], where, errors), effects: readEffects(raw['effects'], where, errors, warnings) });
        break;
      case 'background':
        backgrounds.push({ id, name, summary, effects: readEffects(raw['effects'], where, errors, warnings) });
        break;
      case 'feat':
        if (raw['prerequisites'] !== undefined) {
          warnings.push(`${where}: the engine does not read a feat's prerequisites yet, so they are inert.`);
        }
        feats.push({ id, name, summary, effects: readEffects(raw['effects'], where, errors, warnings) });
        break;
      case 'item': {
        const item = readItem(raw, id, name, where, errors, warnings);
        if (item !== null) items.push(item);
        break;
      }
      case 'option': {
        const pool = asString(raw['pool']);
        if (pool === '') errors.push(`${where}: an option must name its "pool".`);
        options.push({
          id,
          name,
          pool,
          summary: asString(raw['summary']),
          prerequisites: readPrerequisites(raw['prerequisites'], where, errors),
          effects: readEffects(raw['effects'], where, errors, warnings),
        });
        break;
      }
    }
  });

  checkPools(classes, subclasses, options, errors, warnings);

  const provider = inMemoryContent({ classes, subclasses, races, backgrounds, feats, items, options });
  return {
    meta,
    provider,
    catalog: {
      classes: catalogue(classes),
      subclasses: catalogue(subclasses, (s) => s.class),
      races: catalogue(races),
      backgrounds: catalogue(backgrounds),
      feats: catalogue(feats),
      items: catalogue(items),
      options: catalogue(options, (o) => o.pool),
      counts: {
        classes: classes.length,
        subclasses: subclasses.length,
        races: races.length,
        backgrounds: backgrounds.length,
        feats: feats.length,
        items: items.length,
        options: options.length,
      },
    },
    errors,
    warnings,
  };
}

function emptyCatalog(): PackCatalog {
  return {
    classes: [], subclasses: [], races: [], backgrounds: [], feats: [], items: [], options: [],
    counts: {},
  };
}

function catalogue<T extends { id: string; name: string; summary: string }>(
  entries: readonly T[],
  group?: (entry: T) => string,
): readonly CatalogEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    group: group?.(entry) ?? '',
    summary: entry.summary,
  }));
}

function readMeta(raw: unknown, errors: string[]): PackMeta | null {
  if (!isObject(raw)) {
    errors.push('The pack has no "pack" header — expected an object with id, name, version and ruleset.');
    return null;
  }
  const ruleset = asString(raw['ruleset']);
  if (ruleset !== '2014') {
    errors.push(
      `The pack declares ruleset ${JSON.stringify(ruleset || null)}; this engine implements 2014 only.`,
    );
  }
  const tier = asString(raw['tier'], 'published');
  if (!TIERS.includes(tier as PackTier)) {
    errors.push(`The pack's tier "${tier}" is not one of: ${TIERS.join(', ')}.`);
  }
  return {
    id: asString(raw['id'], 'unnamed'),
    name: asString(raw['name'], 'Unnamed pack'),
    version: asString(raw['version'], '0.0.0'),
    ruleset: '2014',
    tier: tier as PackTier,
    requires: asArray(raw['requires']).map((r) => asString(r)).filter((r) => r !== ''),
  };
}

function warnUnknownFields(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  warnings: string[],
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      warnings.push(`${where}: "${key}" is not a field the engine reads — a typo here does nothing.`);
    }
  }
}

function readSource(raw: unknown): { book: string; page: number } {
  if (!isObject(raw)) return { book: '', page: 0 };
  return { book: asString(raw['book']), page: asNumber(raw['page']) };
}

function readFeatures(
  raw: unknown,
  where: string,
  errors: string[],
  warnings: string[],
): readonly FeatureEntry[] {
  return asArray(raw).map((value, index) => {
    if (!isObject(value)) {
      errors.push(`${where}: feature ${index + 1} is not an object.`);
      return { id: '', name: '', level: 0, summary: '', effects: [] };
    }
    const id = asString(value['id']);
    const name = asString(value['name']);
    const label = `${where} → "${name || id || `feature ${index + 1}`}"`;
    if (id === '') errors.push(`${label}: missing "id" (expressions reference features by id).`);
    if (name === '') errors.push(`${label}: missing "name".`);
    warnUnknownFields(value, ALLOWED_FEATURE_FIELDS, label, warnings);
    return {
      id,
      name,
      level: asNumber(value['level'], 1),
      summary: asString(value['summary']),
      effects: readEffects(value['effects'], label, errors, warnings),
    };
  });
}

function readIncreases(
  raw: unknown,
  where: string,
  errors: string[],
): readonly { ability: Ability; amount: number }[] {
  return asArray(raw).flatMap((value) => {
    if (!isObject(value)) {
      errors.push(`${where}: an ability increase is not an object.`);
      return [];
    }
    const ability = asString(value['ability']) as Ability;
    if (!ABILITIES.includes(ability)) {
      errors.push(`${where}: "${ability}" is not an ability abbreviation.`);
      return [];
    }
    return [{ ability, amount: asNumber(value['amount']) }];
  });
}

function readPrerequisites(raw: unknown, where: string, errors: string[]): readonly string[] {
  return asArray(raw).flatMap((value) => {
    if (typeof value !== 'string') {
      errors.push(`${where}: a prerequisite must be a string expression.`);
      return [];
    }
    try {
      parseExpression(value);
    } catch (error) {
      errors.push(`${where}: prerequisite ${JSON.stringify(value)} — ${(error as Error).message}`);
    }
    return [value];
  });
}

function readEffects(raw: unknown, where: string, errors: string[], warnings: string[]): readonly Effect[] {
  return asArray(raw).flatMap((value) => {
    if (!isObject(value)) {
      errors.push(`${where}: an effect is not an object.`);
      return [];
    }
    const shape = asString(value['shape']);
    if (shape === '') {
      errors.push(`${where}: an effect has no "shape".`);
      return [];
    }
    if (!Object.prototype.hasOwnProperty.call(EFFECT_SHAPES, shape)) {
      if (UNIMPLEMENTED_SHAPES.includes(shape)) {
        warnings.push(`${where}: "${shape}" is in the catalogue but not implemented yet — this effect does nothing.`);
        return [value as unknown as Effect];
      }
      errors.push(`${where}: "${shape}" is not an effect shape this engine knows.`);
      return [];
    }
    checkEffectFields(value, shape, where, errors, warnings);
    return [value as unknown as Effect];
  });
}

function checkEffectFields(
  effect: Record<string, unknown>,
  shape: string,
  where: string,
  errors: string[],
  warnings: string[],
): void {
  if (effect['scope'] !== undefined) checkScope(effect['scope'], `${where} → ${shape}`, warnings);
  if (effect['condition'] !== undefined && !isObject(effect['condition'])) {
    errors.push(`${where}: "${shape}" has a condition that is not an object.`);
  }

  switch (shape) {
    case 'resource.pool': {
      // The only expression the engine evaluates outside prerequisites.
      const max = effect['max'];
      if (typeof max !== 'string') {
        errors.push(`${where}: resource.pool "max" must be an expression string, e.g. "1" or "classLevel(fighter)".`);
      } else {
        try {
          parseExpression(max);
        } catch (error) {
          errors.push(`${where}: resource.pool max ${JSON.stringify(max)} — ${(error as Error).message}`);
        }
      }
      break;
    }
    case 'damage.dice': {
      const type = asString(effect['damageType']);
      if (!DAMAGE_TYPES.includes(type as DamageType)) {
        errors.push(`${where}: "${type}" is not a damage type.`);
      }
      const dice = effect['dice'];
      if (!isObject(dice) || asNumber(dice['die']) === 0) {
        errors.push(`${where}: damage.dice needs "dice": { "count": 1, "die": 6 }.`);
      } else if (typeof dice['count'] === 'string') {
        // A pool that grows with level, e.g. Sneak Attack.
        try {
          parseExpression(dice['count']);
        } catch (error) {
          errors.push(`${where}: damage.dice count ${JSON.stringify(dice['count'])} — ${(error as Error).message}`);
        }
      }
      break;
    }
    case 'proficiency.grant':
    case 'proficiency.expertise': {
      if (asArray(effect['ids']).length === 0) {
        errors.push(`${where}: ${shape} names no ids.`);
      }
      break;
    }
    case 'choice.offer': {
      const pool = asString(effect['pool']);
      if (pool === '') errors.push(`${where}: choice.offer has no "pool".`);
      const count = effect['count'];
      if (typeof count !== 'number' || count < 1) {
        errors.push(`${where}: choice.offer needs a "count" of at least 1.`);
      }

      // Where a pick's reward comes from depends on the pool, and getting this
      // backwards is silent in both directions: a built-in pool with no grants
      // confers nothing, and a content pool with grants has two answers.
      const grants = asArray(effect['grants']);
      if (ENGINE_POOL_FAMILIES.includes(poolFamily(pool))) {
        if (grants.length === 0) {
          errors.push(
            `${where}: pool "${pool}" is one of the engine's own, so choice.offer must declare "grants" — without them its picks confer nothing.`,
          );
        }
        for (const grant of grants) {
          const shape = isObject(grant) ? asString(grant['shape']) : '';
          if (shape !== 'proficiency.grant' && shape !== 'proficiency.expertise') {
            errors.push(`${where}: "${shape || 'a grant'}" cannot be a grant — only proficiency.grant and proficiency.expertise take their ids from the picks.`);
          }
        }
      } else if (grants.length > 0) {
        errors.push(
          `${where}: pool "${pool}" holds entries, so its options carry their own effects and must not declare "grants".`,
        );
      }
      break;
    }
    default:
      break;
  }
}

function checkScope(raw: unknown, where: string, warnings: string[]): void {
  if (!isObject(raw)) {
    warnings.push(`${where}: the scope is not an object and is ignored.`);
    return;
  }
  for (const key of Object.keys(raw)) {
    if (!SCOPE_FIELDS.includes(key)) {
      warnings.push(`${where}: scope field "${key}" is not read — a typo here never matches.`);
    }
  }
  for (const branch of asArray(raw['or'])) checkScope(branch, `${where} (or)`, warnings);
  const kind = raw['kind'];
  if (kind !== undefined && kind !== 'weapon' && kind !== 'check' && kind !== 'save') {
    warnings.push(`${where}: scope kind ${JSON.stringify(kind)} is not one the engine matches against anything yet.`);
  }
}

function readItem(
  raw: Record<string, unknown>,
  id: string,
  name: string,
  where: string,
  errors: string[],
  warnings: string[],
): ItemEntry | null {
  const armorRaw = raw['armor'];
  const weaponRaw = raw['weapon'];

  const armor =
    isObject(armorRaw)
      ? {
          kind: asString(armorRaw['kind'], 'light') as 'light' | 'medium' | 'heavy' | 'shield',
          baseAc: asNumber(armorRaw['baseAc']),
          maxDex: typeof armorRaw['maxDex'] === 'number' ? asNumber(armorRaw['maxDex']) : null,
          // The Armor table's Strength and Stealth columns (PHB 145). Absent
          // means "the table prints a dash", which is what a pack authored
          // before these fields existed also means — so an old pack loads and
          // behaves as it did, and `verify-pack` is what insists a new one says
          // so explicitly.
          strength: typeof armorRaw['strength'] === 'number' ? asNumber(armorRaw['strength']) : null,
          stealthDisadvantage: asBoolean(armorRaw['stealthDisadvantage'], false),
        }
      : null;

  // The two columns are read with defaults so that a pack authored before they
  // existed still loads and behaves as it did. That defaulting is exactly why
  // an omission has to be said out loud: "the table prints a dash" and "nobody
  // looked" would otherwise be the same pack.
  if (
    isObject(armorRaw) &&
    (armorRaw['strength'] === undefined || armorRaw['stealthDisadvantage'] === undefined)
  ) {
    warnings.push(
      `${where}: armour should declare both "strength" and "stealthDisadvantage" — write null and false where the Armor table prints a dash (PHB 145).`,
    );
  }

  const weapon =
    isObject(weaponRaw)
      ? {
          category: asString(weaponRaw['category'], 'simple') as 'simple' | 'martial',
          damage: {
            count: asNumber((weaponRaw['damage'] as Record<string, unknown> | undefined)?.['count'], 1),
            die: asNumber((weaponRaw['damage'] as Record<string, unknown> | undefined)?.['die'], 4),
          },
          versatile: isObject(weaponRaw['versatile'])
            ? { count: asNumber(weaponRaw['versatile']['count'], 1), die: asNumber(weaponRaw['versatile']['die'], 6) }
            : null,
          damageType: asString(weaponRaw['damageType'], 'slashing') as DamageType,
          melee: asBoolean(weaponRaw['melee'], true),
          ranged: asBoolean(weaponRaw['ranged'], false),
          properties: asArray(weaponRaw['properties']).map((p) => asString(p)).filter((p) => p !== ''),
        }
      : null;

  if (weapon !== null && !DAMAGE_TYPES.includes(weapon.damageType)) {
    errors.push(`${where}: "${weapon.damageType}" is not a damage type.`);
  }
  if (weapon !== null && weapon.damage.die === 0) {
    errors.push(`${where}: the weapon has no damage die.`);
  }
  if (armor === null && weapon === null && raw['effects'] === undefined) {
    warnings.push(`${where}: an item with no armour, no weapon and no effects does nothing on a sheet.`);
  }

  return {
    id,
    name,
    summary: asString(raw['summary']),
    weight: asNumber(raw['weight']),
    armor,
    weapon,
    requiresAttunement: asBoolean(raw['requiresAttunement']),
    effects: readEffects(raw['effects'], where, errors, warnings),
  };
}

// ---------------------------------------------------------------------------
// Cross-entry checks — the ones a single entry cannot make
// ---------------------------------------------------------------------------

/** Pool families the engine provides itself, so the pack need not author them. */
const ENGINE_POOL_FAMILIES: readonly string[] = ['skill', 'proficient', 'subclass'];

/** `skill:fighter` → `skill`; `fighting-style` → `fighting-style`. */
function poolFamily(pool: string): string {
  const separator = pool.indexOf(':');
  return separator === -1 ? pool : pool.slice(0, separator);
}

/**
 * An offer naming a pool with no options is the failure a tag-based pool is
 * exposed to: nothing else would notice, and the player would simply see an
 * empty list. Checked here so it is caught on upload rather than at the table.
 */
function checkPools(
  classes: readonly ClassEntry[],
  subclasses: readonly SubclassEntry[],
  options: readonly OptionEntry[],
  errors: string[],
  warnings: string[],
): void {
  const authoredPools = new Set(options.map((option) => option.pool));
  const subclassClasses = new Set(subclasses.map((subclass) => subclass.class));

  const offerOf = (effects: readonly Effect[], source: string): void => {
    for (const effect of effects) {
      if (effect.shape !== 'choice.offer') continue;
      if (ENGINE_POOL_FAMILIES.includes(poolFamily(effect.pool))) continue;
      if (!authoredPools.has(effect.pool)) {
        errors.push(
          `${source} offers pool "${effect.pool}", which has no options in this pack — most likely a typo, and it would offer an empty list.`,
        );
      }
    }
  };

  for (const entry of classes) {
    for (const feature of entry.features) offerOf(feature.effects, `${entry.name} → ${feature.name}`);
    // The engine emits the subclass offer itself, from the class table, so a
    // pack with a class and no subclass of it has an offer nothing can fill.
    const rules = CLASS_RULES[entry.id];
    if (rules !== undefined && !subclassClasses.has(entry.id)) {
      warnings.push(
        `${entry.name} chooses a subclass at ${rules.subclassLevel} level, but this pack has no ${entry.name} subclass. The sheet will report it as an unsupported choice.`,
      );
    }
  }
  for (const entry of subclasses) {
    for (const feature of entry.features) offerOf(feature.effects, `${entry.name} → ${feature.name}`);
    if (!classes.some((c) => c.id === entry.class)) {
      warnings.push(`${entry.name} is a ${entry.class} subclass, but this pack has no ${entry.class} class.`);
    }
  }
  for (const option of options) offerOf(option.effects, option.name);
}

/** Re-exported so callers can label a scope without importing the engine. */
export type { Scope, SkillId };
export { SKILL_IDS };
