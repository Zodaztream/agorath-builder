/**
 * The derivation pipeline.
 *
 * `derive()` is a pure function of a definition and a content provider. It
 * stores nothing and mutates nothing, so a sheet can never disagree with the
 * definition it came from — which is what makes a stale attack bonus after a
 * level-up structurally impossible rather than a bug to hunt.
 *
 * Effects are collected **first**, before abilities resolve. That order is
 * forced by choices: a feat or a picked option can raise an ability score, so
 * anything that reads a modifier has to run after collection has finished. What
 * falls out is retroactivity — raising CON moves hit points, saves and skills
 * with no special case.
 *
 * Two rules that look like details and are not:
 *
 * - A class's features are collected **once**, gated by that class's level. Not
 *   once per level entry, which would collect a 5th-level rogue's Sneak Attack
 *   five times and make entitlement arithmetic nonsense.
 * - A pool's candidates and entitlement are computed from the features the
 *   character actually has, so a subclass cannot be picked before the class
 *   offers one. See ADR-0008 and ADR-0009.
 */

import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type ArmorEntry,
  type CharacterDefinition,
  type ChoiceGrant,
  type CustomItem,
  type DerivedAbility,
  type DerivedAdvancement,
  type DerivedDice,
  type DerivedAttack,
  type DerivedDamageComponent,
  type DerivedGrantedItem,
  type DerivedNote,
  type DerivedPick,
  type DerivedResource,
  type DerivedSave,
  type DerivedSelection,
  type DerivedSheet,
  type DerivedSkill,
  type DerivedSpellcasting,
  type Dice,
  type Effect,
  type EffectShapeId,
  type ItemEntry,
  type OptionEntry,
  type SkillId,
  type SubclassEntry,
} from './types.ts';

import {
  ABILITY_CAP,
  PASSIVE_BASE,
  SKILL_ABILITY,
  SKILL_IDS,
  SKILL_NAMES,
  abilityModifier,
  attackAbility,
  averageHitPoints,
  classRules,
  fullCasterSlots,
  halfCasterSlots,
  multiclassCasterLevel,
  pactMagicSlots,
  proficiencyBonus,
  spellAttackBonus,
  spellSaveDc,
} from './rules.ts';

import {
  collectEffect,
  emptyAccumulator,
  matchesScope,
  type Accumulator,
  type OfferGrant,
  type ResourceGrant,
  type ScopedAmount,
  type ScopedDice,
  type ScopeSubject,
} from './effects.ts';

import type { ContentProvider } from './content.ts';
import { evaluate, type ExpressionContext } from './expression.ts';

/** The three skills that have a passive score. */
const PASSIVE_SKILLS = ['perception', 'investigation', 'insight'] as const;

/** A character may be attuned to at most three magic items. */
export const ATTUNEMENT_LIMIT = 3;

/** What armour costs in movement when the wearer misses its Strength (PHB 144). */
export const ARMOR_SPEED_PENALTY = 10;

/** What a pick from a pool turned out to be. */
interface PoolMember {
  readonly id: string;
  readonly name: string;
  readonly kind: 'skill' | 'tool' | 'option' | 'subclass';
  /** What the entry says about itself, for a picker. Empty when it has none. */
  readonly summary: string;
  /** The entry behind the pick, when there is one. */
  readonly option: OptionEntry | null;
  readonly subclass: SubclassEntry | null;
}

/**
 * Where a pool's members come from. It decides three things at once: whether
 * `grants` is required or forbidden, whether an empty pool is a typo, and how a
 * rejected pick is worded.
 */
type PoolKind = 'engine' | 'derived' | 'content' | 'subclass';

interface ResolvedPool {
  readonly pool: string;
  readonly label: string;
  readonly entitled: number;
  readonly members: ReadonlyMap<string, PoolMember>;
  /** The narrowed id set, from every offer's `from`. Null when unrestricted. */
  readonly allowed: ReadonlySet<string> | null;
  readonly grants: readonly ChoiceGrant[];
  readonly kind: PoolKind;
}

/** One `select` the definition makes, in level order. */
interface Selection {
  readonly pool: string;
  readonly picks: readonly string[];
  /** The class level reached at the entry that made the pick. */
  readonly classLevel: number;
  readonly classId: string;
}

export function derive(definition: CharacterDefinition, content: ContentProvider): DerivedSheet {
  const diagnostics: string[] = [];

  if (definition.ruleset !== '2014') {
    throw new Error(
      `This engine implements the 2014 rules. The definition declares ruleset ${JSON.stringify(definition.ruleset)}.`,
    );
  }

  const totalLevel = definition.levels.length;

  // -- class levels ---------------------------------------------------------
  const classLevels: Record<string, number> = {};
  for (const level of definition.levels) {
    classLevels[level.class] = (classLevels[level.class] ?? 0) + 1;
  }
  for (const classId of Object.keys(classLevels)) {
    if (classRules(classId) === null) {
      diagnostics.push(`Unknown class "${classId}" — no rules are defined for it.`);
    }
  }

  const prof = proficiencyBonus(totalLevel);

  // -- named content, resolved once -----------------------------------------
  const race = definition.race === null ? null : content.race(definition.race);
  if (definition.race !== null && race === null) {
    diagnostics.push(`Missing race "${definition.race}" — it is not in any loaded pack.`);
  }
  const subrace = definition.subrace === null ? null : content.race(definition.subrace);
  if (definition.subrace !== null && subrace === null) {
    diagnostics.push(`Missing subrace "${definition.subrace}" — it is not in any loaded pack.`);
  }
  const background = definition.background === null ? null : content.background(definition.background);
  if (definition.background !== null && background === null) {
    diagnostics.push(`Missing background "${definition.background}" — it is not in any loaded pack.`);
  }

  // -- pass 1: collect every effect -----------------------------------------
  const acc: Accumulator = emptyAccumulator();
  const notes: DerivedNote[] = [];
  /** Every entry id the character has, which is what `hasFeature()` resolves. */
  const featureIds = new Set<string>();
  const selections: Selection[] = [];

  for (const inc of race?.abilityIncreases ?? []) acc.abilityIncreases[inc.ability] += inc.amount;
  for (const inc of subrace?.abilityIncreases ?? []) acc.abilityIncreases[inc.ability] += inc.amount;
  for (const effect of race?.effects ?? []) collectEffect(acc, effect, race?.name ?? 'race');
  for (const effect of subrace?.effects ?? []) collectEffect(acc, effect, subrace?.name ?? 'subrace');
  for (const effect of background?.effects ?? []) collectEffect(acc, effect, background?.name ?? 'background');

  // A class's features, once, at the level that class has reached — not once
  // per level entry, which is what would give a 5th-level rogue five Sneak
  // Attack riders.
  //
  // Only the class taken at character level 1 brings its equipment. The book
  // grants a multiclass character the new class's features and prints no
  // exception for equipment; the exception is the DM's ruling, so it is applied
  // here, said out loud, rather than left for a screen to remember (ADR-0013).
  const firstClass = definition.levels[0]?.class ?? null;
  for (const classId of Object.keys(classLevels)) {
    const classLevel = classLevels[classId] ?? 0;
    const entry = content.class(classId);
    if (entry === null) {
      diagnostics.push(`Missing class "${classId}" — it is not in any loaded pack.`);
      continue;
    }
    for (const feature of entry.features) {
      if (feature.level > classLevel) continue;
      if (classId !== firstClass && grantsEquipment(feature)) {
        diagnostics.push(
          `${entry.name} starting equipment is not granted: a multiclass character takes equipment from their first class only.`,
        );
        continue;
      }
      featureIds.add(feature.id);
      notes.push({ name: feature.name, level: feature.level, summary: feature.summary });
      for (const effect of feature.effects) collectEffect(acc, effect, feature.name, feature.id);
    }
  }

  // The subclass offer is the engine's, from the class table. Content does not
  // declare it and cannot get its level wrong. This is what finally uses
  // `subclassLevel`, and why a level-1 fighter has no archetype to pick.
  for (const classId of Object.keys(classLevels)) {
    const rules = classRules(classId);
    const classLevel = classLevels[classId] ?? 0;
    if (rules === null || classLevel < rules.subclassLevel) continue;
    acc.offers.push({
      pool: `subclass:${classId}`,
      label: rules.subclassLabel ?? 'Subclass',
      count: 1,
      from: null,
      grants: [],
      origin: classId,
    });
  }

  // Choices made per level, with the class level reached at that entry.
  const runningLevels: Record<string, number> = {};
  const advancements: DerivedAdvancement[] = [];
  for (let index = 0; index < definition.levels.length; index += 1) {
    const level = definition.levels[index] as (typeof definition.levels)[number];
    const classLevelHere = (runningLevels[level.class] ?? 0) + 1;
    runningLevels[level.class] = classLevelHere;
    const rules = classRules(level.class);

    // Where the class table grants an ASI, the UI has something to offer. The
    // rule itself stays in CLASS_RULES; this is only the character's own view
    // of it, so no screen has to re-implement the level arithmetic.
    if (rules !== null && rules.asiLevels.includes(classLevelHere)) {
      advancements.push({
        level: index,
        classId: level.class,
        classLevel: classLevelHere,
        kind: 'asi-or-feat',
        taken: level.choices.some((c) => c.kind === 'asi' || c.kind === 'feat'),
      });
    }

    for (const choice of level.choices) {
      if (choice.kind === 'asi') {
        // The class table says which levels grant one. An increase at any other
        // level is reported and still applied: the sheet shows what the
        // definition says, plus the error, rather than quietly disagreeing.
        if (rules === null || !rules.asiLevels.includes(classLevelHere)) {
          diagnostics.push(
            `An ability score improvement at ${level.class} level ${classLevelHere}, which does not grant one.`,
          );
        }
        for (const inc of choice.increases) acc.abilityIncreases[inc.ability] += inc.amount;
        continue;
      }

      if (choice.kind === 'feat') {
        if (rules === null || !rules.asiLevels.includes(classLevelHere)) {
          diagnostics.push(`A feat at ${level.class} level ${classLevelHere}, which does not grant one.`);
        }
        const feat = content.feat(choice.feat);
        if (feat === null) {
          diagnostics.push(`Missing feat "${choice.feat}" — it is not in any loaded pack.`);
          continue;
        }
        featureIds.add(feat.id);
        notes.push({ name: feat.name, level: classLevelHere, summary: 'Feat.' });
        for (const effect of feat.effects) collectEffect(acc, effect, feat.name);
        continue;
      }

      if (choice.kind === 'select') {
        selections.push({
          pool: choice.pool,
          picks: choice.picks,
          classLevel: classLevelHere,
          classId: level.class,
        });
      }
    }
  }

  // Subclass features, from whatever the picks chose. Gated by the class level,
  // because an archetype grants features at 3rd, 7th, 10th, 15th and 18th — not
  // all of them the moment it is chosen.
  //
  // A pick that resolves to nothing is passed over in silence here: whether it
  // is missing from the packs or simply not a subclass of this class is a
  // *membership* question, and the pool check answers it once rather than twice.
  for (const selection of selections) {
    if (!selection.pool.startsWith('subclass:')) continue;
    const classId = selection.pool.slice('subclass:'.length);
    const classLevel = classLevels[classId] ?? 0;
    for (const pick of selection.picks) {
      const subclass = content.subclass(pick);
      if (subclass === null || subclass.class !== classId) continue;
      featureIds.add(subclass.id);
      for (const feature of subclass.features) {
        if (feature.level > classLevel) continue;
        featureIds.add(feature.id);
        notes.push({ name: feature.name, level: feature.level, summary: feature.summary });
        for (const effect of feature.effects) collectEffect(acc, effect, feature.name);
      }
    }
  }

  // -- pass 2: equipment ----------------------------------------------------
  let attuned = 0;
  let armorWorn: { name: string; armor: ArmorEntry } | null = null;
  let shieldEquipped = false;
  let shieldWorn: string | null = null;
  const weaponSources: { name: string; entry: ItemEntry | null; custom: CustomItem | null }[] = [];

  for (const carried of definition.inventory) {
    const entry: ItemEntry | null =
      carried.custom !== null
        ? customAsItem(carried.custom, content, diagnostics)
        : content.item(carried.item);

    if (entry === null) {
      diagnostics.push(`Missing item "${carried.item}" — it is not in any loaded pack.`);
      continue;
    }

    if (carried.attuned) {
      attuned += 1;
      if (!entry.requiresAttunement) {
        diagnostics.push(`"${entry.name}" is marked attuned but does not require attunement.`);
      }
    }

    if (!carried.equipped) continue;

    if (entry.armor !== null) {
      if (entry.armor.kind === 'shield') {
        shieldEquipped = true;
        shieldWorn = entry.name;
      } else {
        armorWorn = { name: entry.name, armor: entry.armor };
      }
    } else if (entry.weapon !== null) {
      weaponSources.push({ name: entry.name, entry, custom: carried.custom });
    }

    // An item's own attack and damage effects belong to that item: a +1
    // longsword must not sharpen the greataxe as well. Content overrides this
    // by stating a scope of its own.
    for (const effect of entry.effects) collectEffect(acc, scopedToItem(effect, entry), entry.name);
  }

  if (attuned > ATTUNEMENT_LIMIT) {
    diagnostics.push(`Attuned to ${attuned} items; the limit is ${ATTUNEMENT_LIMIT}.`);
  }

  // -- pass 3: resolve selections -------------------------------------------
  // Proficiencies first, derived pools second: a rogue's Expertise picks from
  // the skills the *same* level just made them proficient in, so membership has
  // to be computed after the grants that create it.
  const offersByPool = new Map<string, OfferGrant[]>();
  for (const offer of acc.offers) {
    const bucket = offersByPool.get(offer.pool);
    if (bucket === undefined) offersByPool.set(offer.pool, [offer]);
    else bucket.push(offer);
  }

  const poolFor = (pool: string): ResolvedPool => resolvePool(pool, content, acc, offersByPool, diagnostics);

  const resolved = new Map<string, ResolvedPool>();

  // Two phases, in this order, because a derived pool's membership depends on
  // the grants other picks have just made: a rogue's Expertise draws on the
  // skills the same feature made them proficient in.
  const phases = [
    selections.filter((s) => !s.pool.startsWith('proficient:')),
    selections.filter((s) => s.pool.startsWith('proficient:')),
  ];
  for (const phase of phases) {
    for (const selection of phase) {
      const pool = resolved.get(selection.pool) ?? poolFor(selection.pool);
      resolved.set(selection.pool, pool);
      validateAndApply(selection, pool, acc, featureIds, notes, diagnostics);
    }
  }

  // A pool the character has been offered but has not spent yet is resolved
  // too, so the sheet can say "1 of 2 chosen" rather than "0 of 0" — and so an
  // offer naming a pool nobody authored options for is caught even when the
  // player has not tried to pick from it.
  for (const pool of offersByPool.keys()) {
    if (!resolved.has(pool)) resolved.set(pool, poolFor(pool));
  }

  // -- pass 4: abilities ----------------------------------------------------
  const abilities = {} as Record<Ability, DerivedAbility>;
  for (const ability of ABILITIES) {
    const score = Math.min(ABILITY_CAP, definition.abilities[ability] + acc.abilityIncreases[ability]);
    abilities[ability] = { id: ability, score, modifier: abilityModifier(score) };
  }
  const mod = (ability: Ability): number => abilities[ability].modifier;

  // -- pass 4b: what the worn armour does ------------------------------------
  // PHB 144, and the whole of it. Only one of these rules is a number the sheet
  // can carry — armour you have not the Strength for costs 10 feet of movement
  // — so only that one is computed. Non-proficiency and the Stealth column are
  // conditions on a die roll; a printed sheet states them, and so does this.
  //
  // The comparison is against the Strength *score*, not the modifier, which is
  // what the rule names and what makes Str 13 legal for chain mail but not for
  // plate.
  const armorNotes: string[] = [];
  let armorSpeedPenalty = 0;

  const wornPieces: { readonly name: string; readonly armor: ArmorEntry }[] = [];
  if (armorWorn !== null) wornPieces.push({ name: armorWorn.name, armor: armorWorn.armor });
  if (shieldEquipped) {
    wornPieces.push({
      name: shieldWorn ?? 'Shield',
      armor: { kind: 'shield', baseAc: 0, maxDex: null, strength: null, stealthDisadvantage: false },
    });
  }

  for (const piece of wornPieces) {
    if (!acc.armorProficiencies.has(piece.armor.kind)) {
      armorNotes.push(
        `Not proficient with ${piece.name}: disadvantage on Strength and Dexterity checks, saves and attacks, and no spellcasting (PHB 144).`,
      );
    }
    if (piece.armor.stealthDisadvantage) {
      armorNotes.push(`${piece.name}: disadvantage on Dexterity (Stealth) checks (PHB 144).`);
    }
    if (piece.armor.strength !== null && abilities.str.score < piece.armor.strength) {
      armorSpeedPenalty += ARMOR_SPEED_PENALTY;
      armorNotes.push(
        `${piece.name} requires Strength ${piece.armor.strength}, and yours is ${abilities.str.score}: your speed is reduced by ${ARMOR_SPEED_PENALTY} feet (PHB 144).`,
      );
    }
  }

  const expressionContext: ExpressionContext = {
    totalLevel,
    profBonus: prof,
    abilityScore: (a) => abilities[a].score,
    abilityMod: (a) => abilities[a].modifier,
    classLevel: (id) => classLevels[id] ?? 0,
    hasFeature: (id) => featureIds.has(id),
  };

  // Prerequisites are checked here rather than with the picks, because they may
  // read an ability modifier — "Strength 13 or higher" is a prerequisite before
  // it is anything else.
  for (const selection of selections) {
    const pool = resolved.get(selection.pool);
    if (pool === undefined) continue;
    for (const pick of selection.picks) {
      const member = pool.members.get(pick);
      if (member?.option == null) continue;
      for (const prerequisite of member.option.prerequisites) {
        let met: number;
        try {
          met = evaluate(prerequisite, expressionContext);
        } catch (error) {
          diagnostics.push(`"${member.option.name}" prerequisite ${JSON.stringify(prerequisite)}: ${(error as Error).message}`);
          continue;
        }
        if (met === 0) {
          diagnostics.push(`"${member.option.name}" requires ${prerequisite}, which is not met.`);
        }
      }
    }
  }

  // Saving throw proficiencies are a class rule, so they are granted from the
  // engine's table rather than declared by content.
  for (const classId of Object.keys(classLevels)) {
    const rules = classRules(classId);
    if (rules === null) continue;
    for (const ability of rules.savingThrows) acc.saveProficiencies.add(ability);
  }

  // A class that casts grants its spellcasting from the engine's own table —
  // content does not have to declare it, and cannot get it wrong.
  const grantedByClass = new Set(acc.spellcasting.map((g) => g.source));
  for (const classId of Object.keys(classLevels)) {
    const rules = classRules(classId);
    if (rules === null || rules.spellcasting === null || rules.spellcastingAbility === null) continue;
    if (grantedByClass.has(classId)) continue;
    acc.spellcasting.push({
      source: classId,
      ability: rules.spellcastingAbility,
      progression: rules.spellcasting,
      preparation: rules.preparation ?? 'known',
    });
  }

  // -- pass 5: armour class -------------------------------------------------
  // Every available way of calculating AC is evaluated and the best is taken,
  // which is the rule: when more than one method is available, the player
  // chooses which to use.
  const acCandidates: { label: string; value: number }[] = [];

  if (armorWorn !== null) {
    const cap = armorWorn.armor.maxDex;
    // A cap of 0 means heavy armour: DEX is ignored entirely, penalty included.
    const dexPart = cap === null ? mod('dex') : cap === 0 ? 0 : Math.min(mod('dex'), cap);
    const dexText = cap === 0 ? 'no DEX' : `${dexPart >= 0 ? '+' : ''}${dexPart} DEX`;
    acCandidates.push({
      label: `${armorWorn.name} (${armorWorn.armor.baseAc} ${dexText})`,
      value: armorWorn.armor.baseAc + dexPart,
    });
  } else {
    acCandidates.push({ label: `Unarmoured (10 + ${mod('dex')} DEX)`, value: 10 + mod('dex') });
  }

  for (const formula of acc.acFormulas) {
    if (formula.requiresNoArmor && armorWorn !== null) continue;
    if (formula.requiresNoShield && shieldEquipped) continue;
    const parts = formula.abilities.map((a) => mod(a));
    acCandidates.push({
      label: `${formula.label} (${formula.base} + ${parts.join(' + ')})`,
      value: formula.base + parts.reduce((sum, v) => sum + v, 0),
    });
  }

  const bestAc = acCandidates.reduce((best, c) => (c.value > best.value ? c : best));
  const shieldBonus = shieldEquipped ? 2 : 0;
  const armorClass =
    bestAc.value +
    shieldBonus +
    acc.acBonuses.filter((b) => !b.conditional).reduce((sum, b) => sum + b.amount, 0);

  const acBreakdownParts = [bestAc.label];
  if (shieldBonus > 0) acBreakdownParts.push(`Shield +${shieldBonus}`);
  for (const bonus of acc.acBonuses) {
    if (bonus.conditional) continue;
    acBreakdownParts.push(`${bonus.label} ${bonus.amount >= 0 ? '+' : ''}${bonus.amount}`);
  }

  // -- pass 6: hit points ---------------------------------------------------
  // Constitution is applied *after* it is known, so a later increase moves
  // every level's hit points with it — no rerolling, no special case.
  let hp = 0;
  const hpParts: string[] = [];
  definition.levels.forEach((level, index) => {
    const rules = classRules(level.class);
    const die = rules?.hitDie ?? 8;
    const conMod = mod('con');

    let base: number;
    if (index === 0) {
      base = die; // the first level always takes the maximum
    } else if (level.hp.mode === 'rolled') {
      base = level.hp.value;
    } else {
      base = averageHitPoints(die);
    }
    const gained = Math.max(1, base + conMod);
    hp += gained;
    hpParts.push(index === 0 ? `${base} + ${conMod}` : `${base} + ${conMod}`);
  });
  hp += acc.hpPerLevel * totalLevel + acc.hpFlat;
  if (acc.hpPerLevel !== 0) hpParts.push(`+${acc.hpPerLevel} per level`);
  if (acc.hpFlat !== 0) hpParts.push(`${acc.hpFlat >= 0 ? '+' : ''}${acc.hpFlat}`);

  // -- pass 7: hit dice pool ------------------------------------------------
  const hitDice: Record<string, number> = {};
  for (const level of definition.levels) {
    const rules = classRules(level.class);
    if (rules === null) continue;
    const key = `d${rules.hitDie}`;
    hitDice[key] = (hitDice[key] ?? 0) + 1;
  }

  // -- pass 8: skills and saves --------------------------------------------
  const skills: DerivedSkill[] = SKILL_IDS.map((id) => {
    const ability = SKILL_ABILITY[id];
    const proficient = acc.skillProficiencies.has(id);
    const expertise = proficient && acc.skillExpertise.has(id);

    // Half proficiency applies only where proficiency does not, and the best
    // rounding wins: Jack of All Trades rounds down, Remarkable Athlete up.
    let half: number | null = null;
    if (!proficient) {
      const subject: ScopeSubject = {
        kind: 'check',
        id: '',
        melee: false,
        ranged: false,
        properties: [],
        skills: [id],
        ability,
      };
      for (const grant of acc.halfProficiency) {
        if (!matchesScope(grant.scope, subject)) continue;
        const value = grant.round === 'up' ? Math.ceil(prof / 2) : Math.floor(prof / 2);
        half = half === null ? value : Math.max(half, value);
      }
    }

    const training = expertise ? prof * 2 : proficient ? prof : half ?? 0;
    return {
      id,
      ability,
      proficient,
      expertise,
      halfProficiency: half !== null,
      bonus: mod(ability) + training,
    };
  });
  const skillById = new Map<SkillId, DerivedSkill>(skills.map((s) => [s.id, s]));

  const saves: DerivedSave[] = ABILITIES.map((ability) => {
    const proficient = acc.saveProficiencies.has(ability);
    return { ability, proficient, bonus: mod(ability) + (proficient ? prof : 0) };
  });

  const passive = {} as Record<'perception' | 'investigation' | 'insight', number>;
  for (const id of PASSIVE_SKILLS) {
    passive[id] = PASSIVE_BASE + (skillById.get(id)?.bonus ?? 0);
  }

  // -- pass 9: attacks ------------------------------------------------------
  const attacks: DerivedAttack[] = [];

  for (const source of weaponSources) {
    const weapon = source.entry?.weapon ?? null;
    if (weapon === null) continue;

    const ability = attackAbility(weapon, mod('str'), mod('dex'));
    const abilityScoreMod = mod(ability);
    const subject: ScopeSubject = {
      kind: 'weapon',
      id: source.entry?.id ?? '',
      melee: weapon.melee,
      ranged: weapon.ranged,
      properties: weapon.properties,
      skills: [],
      ability,
    };

    // Proficiency must be granted by something. An undeclared weapon is used
    // without the proficiency bonus, which is the correct reading.
    const proficient =
      acc.weaponProficiencies.has(weapon.category) ||
      acc.weaponProficiencies.has(source.entry?.id ?? '');

    const conditionalAttack = acc.attackBonuses.filter(
      (b) => b.conditional && matchesScope(b.scope, subject),
    );
    const flatAttack = acc.attackBonuses
      .filter((b) => !b.conditional && matchesScope(b.scope, subject))
      .reduce((sum, b) => sum + b.amount, 0);

    const toHit = abilityScoreMod + (proficient ? prof : 0) + flatAttack;

    const damage: DerivedDamageComponent[] = [
      {
        dice: resolveDice(weapon.damage, expressionContext, diagnostics, source.name),
        flat: abilityScoreMod,
        damageType: weapon.damageType,
        label: null,
        conditional: false,
      },
    ];

    for (const bonus of acc.damageBonuses) {
      if (!matchesScope(bonus.scope, subject)) continue;
      if (bonus.conditional) continue;
      const base = damage[0] as DerivedDamageComponent;
      damage[0] = { ...base, flat: base.flat + bonus.amount, label: bonus.label || base.label };
    }

    for (const rider of acc.damageDice) {
      if (!matchesScope(rider.scope, subject)) continue;
      damage.push({
        dice: resolveDice(rider.dice, expressionContext, diagnostics, rider.label),
        flat: 0,
        damageType: rider.damageType,
        label: rider.label,
        conditional: rider.conditional,
      });
    }

    const notesForAttack: string[] = [];
    for (const b of conditionalAttack) {
      notesForAttack.push(`${b.label}: ${b.amount >= 0 ? '+' : ''}${b.amount} to hit`);
    }
    for (const b of acc.damageBonuses) {
      if (!b.conditional || !matchesScope(b.scope, subject)) continue;
      notesForAttack.push(`${b.label}: ${b.amount >= 0 ? '+' : ''}${b.amount} damage`);
    }

    attacks.push({ name: source.name, ability, toHit, damage, notes: notesForAttack });
  }

  // An unarmed strike is always available.
  {
    const strMod = mod('str');
    const die = acc.unarmedDie ?? 1;
    attacks.push({
      name: 'Unarmed strike',
      ability: 'str',
      toHit: strMod + prof,
      damage: [
        {
          dice: die > 1 ? { count: 1, die } : null,
          flat: die > 1 ? strMod : 1 + strMod,
          damageType: 'bludgeoning',
          label: null,
          conditional: false,
        },
      ],
      notes: acc.unarmedDie !== null ? [`Martial Arts die: d${acc.unarmedDie}`] : [],
    });
  }

  // -- pass 10: spellcasting -----------------------------------------------
  const spellcasting: DerivedSpellcasting[] = [];
  const pactGrants = acc.spellcasting.filter((g) => g.progression === 'pact');
  const normalGrants = acc.spellcasting.filter((g) => g.progression !== 'pact');

  for (const grant of pactGrants) {
    const level = classLevels[grant.source] ?? 0;
    const abilityMod = mod(grant.ability);
    spellcasting.push({
      source: grant.source,
      ability: grant.ability,
      saveDc: spellSaveDc(prof, abilityMod) + acc.spellDcBonus,
      attackBonus: spellAttackBonus(prof, abilityMod),
      slots: pactMagicSlots(level),
    });
  }

  if (normalGrants.length === 1) {
    // A single class uses its own table. A lone paladin of level 5 has [4,2],
    // which the multiclass formula would not produce.
    const grant = normalGrants[0] as (typeof normalGrants)[number];
    const level = classLevels[grant.source] ?? 0;
    const abilityMod = mod(grant.ability);
    const slots =
      grant.progression === 'full'
        ? fullCasterSlots(level)
        : grant.progression === 'half'
          ? halfCasterSlots(level)
          : fullCasterSlots(Math.floor(level / 3));
    spellcasting.push({
      source: grant.source,
      ability: grant.ability,
      saveDc: spellSaveDc(prof, abilityMod) + acc.spellDcBonus,
      attackBonus: spellAttackBonus(prof, abilityMod),
      slots,
    });
  } else if (normalGrants.length > 1) {
    // More than one class: the 2014 multiclass rule, with Pact Magic excluded.
    const contributors = normalGrants
      .filter((g) => g.progression !== 'pact')
      .map((g) => ({
        progression: g.progression as 'full' | 'half' | 'third',
        level: classLevels[g.source] ?? 0,
      }));
    const casterLevel = multiclassCasterLevel(contributors);
    for (const grant of normalGrants) {
      const abilityMod = mod(grant.ability);
      spellcasting.push({
        source: grant.source,
        ability: grant.ability,
        saveDc: spellSaveDc(prof, abilityMod) + acc.spellDcBonus,
        attackBonus: spellAttackBonus(prof, abilityMod),
        slots: fullCasterSlots(casterLevel),
      });
    }
  }

  // -- pass 11: resources ---------------------------------------------------
  // A pool declared more than once under the same id takes the maximum, which
  // is how Greater Portent raises Portent's dice from two to three. The maximum
  // is taken *after* evaluation, because `max` is an expression and two of them
  // cannot be compared as text.
  const resourcesById = new Map<string, ResourceGrant[]>();
  for (const grant of acc.resources) {
    const bucket = resourcesById.get(grant.id);
    if (bucket === undefined) resourcesById.set(grant.id, [grant]);
    else bucket.push(grant);
  }

  const resources: DerivedResource[] = [];
  for (const [id, grants] of resourcesById) {
    let max = 0;
    for (const grant of grants) {
      try {
        max = Math.max(max, evaluate(grant.max, expressionContext));
      } catch (error) {
        diagnostics.push(`Resource "${id}": ${(error as Error).message}`);
      }
    }
    resources.push({ id, max, recharge: grants[0]?.recharge ?? 'long' });
  }

  // -- what the class and the background hand over --------------------------
  // Grants are collected, never applied here: the definition's inventory is the
  // player's, so the builder reads this list and reconciles the inventory
  // against it (ADR-0013). A grant naming an item no pack defines is a pack
  // defect, said once here rather than item by item when it reaches the
  // inventory.
  const startingItems: DerivedGrantedItem[] = [];
  for (const granted of acc.itemGrants) {
    if (content.item(granted.item) === null) {
      diagnostics.push(
        `Granted item "${granted.item}" is not in any loaded pack, so "${granted.grantedBy}" grants nothing.`,
      );
      continue;
    }
    startingItems.push(granted);
  }

  // -- finish ---------------------------------------------------------------
  // Armour that the wearer has not the Strength for is the one thing that
  // lowers speed rather than raising it, so it is subtracted rather than folded
  // into the bonus — a "bonus" of −10 would be a lie in the breakdown.
  const speed = Math.max(0, (acc.speed ?? 30) + acc.speedBonus - armorSpeedPenalty);

  return {
    name: definition.name,
    totalLevel,
    classLevels,
    proficiencyBonus: prof,
    abilities,
    skills,
    saves,
    passive,
    armorClass,
    armorClassBreakdown: acBreakdownParts.join(', '),
    initiative: mod('dex') + acc.initiativeBonus,
    speed,
    hitPoints: {
      maximum: hp,
      breakdown: `${hpParts.join(' + ')}${hpParts.length > 0 ? ' = ' : ''}${hp}`,
    },
    checkFloor: acc.checkFloor,
    hitDice,
    attacks,
    attacksPerAction: 1 + acc.extraAttacks,
    critRange: acc.critMinimum,
    spellcasting,
    resources,
    selections: describeSelections(resolved, acc.offers, selections),
    startingItems,
    armorNotes,
    advancements,
    notes,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Whether a feature is a class's starting-equipment feature.
 *
 * Recognised by shape rather than by name: a feature that hands out items is
 * one, and nothing else in the catalogue does. Naming it by id or by pool
 * prefix would be the magic-string rule ADR-0009 rejected — and this rule needs
 * to hold for a class authored next year.
 */
export function grantsEquipment(feature: {
  readonly effects: readonly { readonly shape: string }[];
}): boolean {
  return feature.effects.some((effect) => effect.shape === 'inventory.grant');
}

/**
 * Resolve a dice pool. A number passes through; an expression is evaluated
 * against the finished character, which is what lets one feature carry a pool
 * that grows — Sneak Attack, a monk's Martial Arts die, Bardic Inspiration.
 * A bad expression is a diagnostic with the pool at zero rather than a crash.
 */
function resolveDice(
  dice: Dice,
  context: ExpressionContext,
  diagnostics: string[],
  label: string,
): DerivedDice {
  if (typeof dice.count === 'number') return { count: dice.count, die: dice.die };
  try {
    return { count: Math.max(0, Math.round(evaluate(dice.count, context))), die: dice.die };
  } catch (error) {
    diagnostics.push(`Dice for "${label}": ${(error as Error).message}`);
    return { count: 0, die: dice.die };
  }
}

/** Shapes that describe one weapon's own line, not the whole character. */
const WEAPON_LINE_SHAPES: readonly EffectShapeId[] = ['attack.bonus', 'damage.bonus', 'damage.dice'];

/**
 * Scope an item's line effects to the item itself, unless the content already
 * said something. `scope` was written for features — Archery applies to every
 * ranged weapon — but an item's bonus is a property of the item.
 */
function scopedToItem(effect: Effect, entry: ItemEntry): Effect {
  if (effect.scope !== undefined || entry.weapon === null) return effect;
  if (!WEAPON_LINE_SHAPES.includes(effect.shape)) return effect;
  return { ...effect, scope: { kind: 'weapon', id: entry.id } };
}

/**
 * A player-authored item, built on a real base.
 *
 * The base supplies the mundane statistics — damage die, weight, armour
 * formula, attunement — so they are never hand-typed and never wrong. The
 * custom effects are laid on top, and the base's own effects come with it, so
 * a `+1` longsword made from a `+1` longsword is not a way to lose the +1.
 */
function customAsItem(custom: CustomItem, content: ContentProvider, diagnostics: string[]): ItemEntry {
  const base = custom.base === null ? null : content.item(custom.base);
  if (custom.base !== null && base === null) {
    diagnostics.push(
      `Custom item "${custom.name}" is built on "${custom.base}", which is not in any loaded pack.`,
    );
  }
  return {
    id: custom.id,
    name: custom.name,
    // A custom item describes itself: the base's sentence would be about the
    // base, and the player is the only one who knows what this one is.
    summary: base === null ? 'A custom item.' : `${custom.name} is built on a ${base.name}.`,
    weight: base?.weight ?? 0,
    armor: base?.armor ?? null,
    weapon: base?.weapon ?? null,
    requiresAttunement: base?.requiresAttunement ?? false,
    effects: [...(base?.effects ?? []), ...custom.effects],
  };
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/** A pool's members, its entitlement, and what a pick from it confers. */
function resolvePool(
  pool: string,
  content: ContentProvider,
  acc: Accumulator,
  offersByPool: ReadonlyMap<string, readonly OfferGrant[]>,
  diagnostics: string[],
): ResolvedPool {
  const offers = offersByPool.get(pool) ?? [];
  const entitled = offers.reduce((sum, offer) => sum + offer.count, 0);

  const members = new Map<string, PoolMember>();

  const skillMember = (id: SkillId): PoolMember => ({
    id,
    name: SKILL_NAMES[id],
    kind: 'skill',
    summary: '',
    option: null,
    subclass: null,
  });

  // A pool name is `<family>[:<qualifier>]`. The family picks the resolver; the
  // qualifier either filters membership (`proficient:skill+tool`) or, for
  // `skill`, only separates one offer from another — a fighter's skill list and
  // a rogue's are the same list of eighteen narrowed by different `from`, and
  // two classes must be able to offer them as two pools rather than one.
  const separator = pool.indexOf(':');
  const family = separator === -1 ? pool : pool.slice(0, separator);
  const qualifier = separator === -1 ? '' : pool.slice(separator + 1);

  let kind: PoolKind;
  if (family === 'skill') {
    kind = 'engine';
    for (const id of SKILL_IDS) members.set(id, skillMember(id));
  } else if (family === 'proficient') {
    // The character's own proficiencies, which is the eligibility rule for
    // expertise expressed as membership rather than as a check that could be
    // forgotten. An empty one is legitimate: a character with no tools has no
    // tool proficiencies to be expert in.
    kind = 'derived';
    const kinds = qualifier.split('+');
    if (kinds.includes('skill')) {
      for (const id of acc.skillProficiencies) members.set(id, skillMember(id));
    }
    if (kinds.includes('tool')) {
      for (const id of acc.toolProficiencies) {
        members.set(id, { id, name: id, kind: 'tool', summary: '', option: null, subclass: null });
      }
    }
  } else if (family === 'subclass') {
    kind = 'subclass';
    for (const entry of content.subclassesOf(qualifier)) {
      // The entry's own sentence travels with the candidate: a chooser that
      // offers three archetype names and no descriptions is a list, and the
      // pack already wrote what each one is.
      members.set(entry.id, {
        id: entry.id,
        name: entry.name,
        kind: 'subclass',
        summary: entry.summary !== '' ? entry.summary : openingFeature(entry),
        option: null,
        subclass: entry,
      });
    }
  } else {
    // A content pool is matched on its exact tag, qualifier included.
    kind = 'content';
    for (const entry of content.options(pool)) {
      members.set(entry.id, { id: entry.id, name: entry.name, kind: 'option', summary: entry.summary, option: entry, subclass: null });
    }
  }

  // `from` narrows a pool. Two offers for one pool that narrow it differently
  // cannot be told apart at pick time, so the union is taken and the pack is
  // told to give them distinct pool names rather than being quietly permissive.
  const narrower = offers.map((offer) => offer.from).filter((from): from is readonly string[] => from !== null);
  const unrestricted = offers.some((offer) => offer.from === null);
  const distinct = new Set(narrower.map((from) => [...from].sort().join(',')));
  if (!unrestricted && distinct.size > 1) {
    diagnostics.push(
      `Pool "${pool}" is offered with different \`from\` lists by different features — give them distinct pool names.`,
    );
  }
  const allowed = unrestricted || distinct.size === 0 ? null : new Set(narrower.flat());

  // A `from` naming something the pool does not contain is a typo, and it would
  // otherwise show up only as an option the player cannot see or select.
  if (members.size > 0) {
    for (const id of allowed ?? []) {
      if (!members.has(id)) {
        diagnostics.push(`Pool "${pool}" narrows to "${id}", which is not in the pool.`);
      }
    }
  }

  const grants = offers[0]?.grants ?? [];
  const grantShapes = new Set(offers.map((offer) => offer.grants.map((g) => g.shape).sort().join(',')));
  if (grantShapes.size > 1) {
    diagnostics.push(`Pool "${pool}" is offered with different \`grants\` — they must agree.`);
  }

  // A content pool with no members is a typo, and nothing else would notice it:
  // a tag-based pool is only as safe as this check.
  if (kind === 'content' && entitled > 0 && members.size === 0) {
    diagnostics.push(`Pool "${pool}" has no options in the loaded packs.`);
  }

  // A built-in pool whose offer forgot `grants` would confer nothing at all,
  // which is the failure the whole mechanism exists to remove. Checked on the
  // offer rather than on a pick, so it is reported even if nobody has chosen.
  if ((kind === 'engine' || kind === 'derived') && entitled > 0 && grants.length === 0) {
    diagnostics.push(`Pool "${pool}" declares no \`grants\`, so its picks confer nothing.`);
  }

  // A content pool carrying `grants` is a pack mistake: the entries already say
  // what they confer, and two answers would disagree silently.
  if (kind === 'content' && grants.length > 0) {
    diagnostics.push(`Pool "${pool}" is content-backed, so its options must not declare \`grants\`.`);
  }

  return {
    pool,
    label: offers[0]?.label ?? pool,
    entitled,
    members,
    allowed,
    grants,
    kind,
  };
}

/**
 * What to say about an archetype the pack did not write a sentence for.
 *
 * A subclass's features *are* its description, and the first one is the one
 * that answers "what is this?" — the champion's Improved Critical, a thief's
 * Fast Hands. Taking the pack's own text is the only honest fallback: writing a
 * summary here would be authoring book content from recall, which ADR-0004
 * forbids, and inventing a blurb for a subclass nobody has read is worse than
 * showing the feature that defines it.
 */
function openingFeature(entry: SubclassEntry): string {
  const first = [...entry.features].sort((a, b) => a.level - b.level)[0];
  if (first === undefined) return '';
  return first.summary === '' ? first.name : `${first.name} — ${first.summary}`;
}

/**
 * Check one `select` against its pool, and give the picks their reward.
 *
 * Every failure here is a diagnostic rather than a throw: a character that
 * cannot be built is exactly the thing the sheet has to be able to say.
 */
function validateAndApply(
  selection: Selection,
  pool: ResolvedPool,
  acc: Accumulator,
  featureIds: Set<string>,
  notes: DerivedNote[],
  diagnostics: string[],
): void {
  if (pool.entitled === 0) {
    diagnostics.push(`Picks for pool "${selection.pool}", which no feature offers.`);
    return;
  }

  if (selection.picks.length > pool.entitled) {
    diagnostics.push(
      `Pool "${selection.pool}" allows ${pool.entitled} pick${pool.entitled === 1 ? '' : 's'}, but ${selection.picks.length} were taken.`,
    );
  }

  const seen = new Set<string>();
  for (const pick of selection.picks) {
    if (seen.has(pick)) {
      diagnostics.push(`"${pick}" is picked twice from pool "${selection.pool}".`);
      continue;
    }
    seen.add(pick);

    const member = pool.members.get(pick);
    if (member === undefined) {
      // For a derived pool this is the expertise rule: you cannot have
      // expertise in something you are not proficient in. It is reported
      // rather than skipped, which is what the engine used to do.
      diagnostics.push(
        pool.kind === 'derived'
          ? `"${pick}" is not something the character is proficient in, so it cannot be picked from "${selection.pool}".`
          : `"${pick}" is not in pool "${selection.pool}".`,
      );
      continue;
    }
    if (pool.allowed !== null && !pool.allowed.has(pick)) {
      diagnostics.push(`"${pick}" is not one of the options offered by pool "${selection.pool}".`);
      continue;
    }

    if (member.option !== null) {
      // A content pool: the entry carries its own reward.
      featureIds.add(member.option.id);
      notes.push({ name: member.option.name, level: selection.classLevel, summary: member.option.summary });
      for (const effect of member.option.effects) collectEffect(acc, effect, member.option.name, member.option.id);
      continue;
    }

    // A built-in pool: the offer says what the pick confers.
    for (const grant of pool.grants) {
      if (grant.shape === 'proficiency.grant') {
        if (member.kind === 'skill') acc.skillProficiencies.add(member.id as SkillId);
        else if (member.kind === 'tool') acc.toolProficiencies.add(member.id);
      } else {
        if (member.kind === 'skill') acc.skillExpertise.add(member.id as SkillId);
        else if (member.kind === 'tool') acc.toolExpertise.add(member.id);
      }
    }
  }

}

/** Every pool the character was offered or picked from, resolved for display. */
function describeSelections(
  resolved: ReadonlyMap<string, ResolvedPool>,
  offers: readonly OfferGrant[],
  selections: readonly Selection[],
): readonly DerivedSelection[] {
  const pools = new Set<string>();
  for (const offer of offers) pools.add(offer.pool);
  for (const selection of selections) pools.add(selection.pool);

  const picksByPool = new Map<string, DerivedPick[]>();
  for (const selection of selections) {
    const bucket = picksByPool.get(selection.pool) ?? [];
    for (const pick of selection.picks) {
      const member = resolved.get(selection.pool)?.members.get(pick);
      bucket.push({ id: pick, name: member?.name ?? pick, pool: selection.pool, summary: member?.summary ?? '' });
    }
    picksByPool.set(selection.pool, bucket);
  }

  const out: DerivedSelection[] = [];
  for (const pool of pools) {
    const entry = resolved.get(pool);
    const members = entry === undefined ? [] : [...entry.members.values()];
    // The candidates are what the offers *allow*, not the pool's whole
    // membership: a fighter chooses between eight skills, not eighteen, and a
    // picker that showed all eighteen would only reject ten of them later.
    const candidates = members
      .filter((member) => entry?.allowed === null || entry?.allowed?.has(member.id) === true)
      .map((member) => ({ id: member.id, name: member.name, pool, summary: member.summary }));
    out.push({
      pool,
      label: entry?.label ?? pool,
      entitled: entry?.entitled ?? 0,
      candidates,
      picks: picksByPool.get(pool) ?? [],
    });
  }
  return out;
}

/** A short human summary of a derived ability, for tests and the UI. */
export function describeAbility(ability: DerivedAbility): string {
  const sign = ability.modifier >= 0 ? '+' : '';
  return `${ABILITY_NAMES[ability.id]} ${ability.score} (${sign}${ability.modifier})`;
}

/** Re-exported so callers can render conditional riders without importing rules. */
export type { ScopedAmount, ScopedDice };
