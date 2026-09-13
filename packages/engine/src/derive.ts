/**
 * The derivation pipeline.
 *
 * `derive()` is a pure function of a definition and a content provider. It
 * stores nothing and mutates nothing, so a sheet can never disagree with the
 * definition it came from — which is what makes a stale attack bonus after a
 * level-up structurally impossible rather than a bug to hunt.
 *
 * Passes run in a fixed order, and the order is what makes retroactivity fall
 * out for free: effects are collected first, abilities are resolved second, and
 * everything that reads a modifier runs after. So raising CON moves hit points,
 * saves and skills with no special case.
 */

import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type CharacterDefinition,
  type CustomItem,
  type DerivedAbility,
  type DerivedAttack,
  type DerivedDamageComponent,
  type DerivedResource,
  type DerivedSave,
  type DerivedSheet,
  type DerivedSkill,
  type DerivedSpellcasting,
  type DerivedNote,
  type ItemEntry,
  type SkillId,
} from './types.ts';

import {
  ABILITY_CAP,
  PASSIVE_BASE,
  SKILL_ABILITY,
  SKILL_IDS,
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

  // -- pass 1: ability increases, from every source that grants one ---------
  const increases: Record<Ability, number> = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

  const race = definition.race === null ? null : content.race(definition.race);
  if (definition.race !== null && race === null) {
    diagnostics.push(`Missing race "${definition.race}" — it is not in any loaded pack.`);
  }
  for (const inc of race?.abilityIncreases ?? []) increases[inc.ability] += inc.amount;

  const subrace = definition.subrace === null ? null : content.race(definition.subrace);
  if (definition.subrace !== null && subrace === null) {
    diagnostics.push(`Missing subrace "${definition.subrace}" — it is not in any loaded pack.`);
  }
  for (const inc of subrace?.abilityIncreases ?? []) increases[inc.ability] += inc.amount;

  for (const level of definition.levels) {
    for (const choice of level.choices) {
      if (choice.kind === 'asi') {
        for (const inc of choice.increases) increases[inc.ability] += inc.amount;
      }
    }
  }

  // -- pass 2: abilities and their modifiers --------------------------------
  const abilities = {} as Record<Ability, DerivedAbility>;
  for (const ability of ABILITIES) {
    const score = Math.min(ABILITY_CAP, definition.abilities[ability] + increases[ability]);
    abilities[ability] = { id: ability, score, modifier: abilityModifier(score) };
  }
  const mod = (ability: Ability): number => abilities[ability].modifier;

  // -- pass 3: collect effects ---------------------------------------------
  const acc: Accumulator = emptyAccumulator();
  const notes: DerivedNote[] = [];

  for (const effect of race?.effects ?? []) collectEffect(acc, effect, race?.name ?? 'race');
  for (const effect of subrace?.effects ?? []) collectEffect(acc, effect, subrace?.name ?? 'subrace');

  const background = definition.background === null ? null : content.background(definition.background);
  if (definition.background !== null && background === null) {
    diagnostics.push(`Missing background "${definition.background}" — it is not in any loaded pack.`);
  }
  for (const effect of background?.effects ?? []) collectEffect(acc, effect, background?.name ?? 'background');

  for (const level of definition.levels) {
    const classLevel = classLevels[level.class] ?? 0;
    const entry = content.class(level.class);
    if (entry === null) continue;

    for (const feature of entry.features) {
      if (feature.level > classLevel) continue;
      notes.push({ name: feature.name, level: feature.level, summary: feature.summary });
      for (const effect of feature.effects) collectEffect(acc, effect, feature.name);
    }

    if (level.subclass !== null) {
      const subclass = content.subclass(level.subclass);
      if (subclass === null) {
        diagnostics.push(`Missing subclass "${level.subclass}" — it is not in any loaded pack.`);
      } else {
        for (const feature of subclass.features) {
          if (feature.level > classLevel) continue;
          notes.push({ name: feature.name, level: feature.level, summary: feature.summary });
          for (const effect of feature.effects) collectEffect(acc, effect, feature.name);
        }
      }
    }

    for (const choice of level.choices) {
      if (choice.kind === 'expertise') {
        for (const skill of choice.skills) acc.skillExpertise.add(skill);
        continue;
      }
      if (choice.kind !== 'feat') continue;
      const feat = content.feat(choice.feat);
      if (feat === null) {
        diagnostics.push(`Missing feat "${choice.feat}" — it is not in any loaded pack.`);
        continue;
      }
      notes.push({ name: feat.name, level: classLevel, summary: 'Feat.' });
      for (const effect of feat.effects) collectEffect(acc, effect, feat.name);
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

  // -- pass 4: equipment ----------------------------------------------------
  let attuned = 0;
  let armorWorn: { name: string; baseAc: number; maxDex: number | null } | null = null;
  let shieldEquipped = false;
  const weaponSources: { name: string; entry: ItemEntry | null; custom: CustomItem | null }[] = [];

  for (const carried of definition.inventory) {
    const entry: ItemEntry | null =
      carried.custom !== null
        ? {
            id: carried.custom.id,
            name: carried.custom.name,
            weight: 0,
            armor: null,
            weapon: null,
            requiresAttunement: false,
            effects: carried.custom.effects,
          }
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
      if (entry.armor.kind === 'shield') shieldEquipped = true;
      else armorWorn = { name: entry.name, baseAc: entry.armor.baseAc, maxDex: entry.armor.maxDex };
    } else if (entry.weapon !== null) {
      weaponSources.push({ name: entry.name, entry, custom: carried.custom });
    }

    for (const effect of entry.effects) collectEffect(acc, effect, entry.name);
  }

  if (attuned > ATTUNEMENT_LIMIT) {
    diagnostics.push(`Attuned to ${attuned} items; the limit is ${ATTUNEMENT_LIMIT}.`);
  }

  // -- pass 5: armour class -------------------------------------------------
  // Every available way of calculating AC is evaluated and the best is taken,
  // which is the rule: when more than one method is available, the player
  // chooses which to use.
  const acCandidates: { label: string; value: number }[] = [];

  if (armorWorn !== null) {
    const cap = armorWorn.maxDex;
    // A cap of 0 means heavy armour: DEX is ignored entirely, penalty included.
    const dexPart = cap === null ? mod('dex') : cap === 0 ? 0 : Math.min(mod('dex'), cap);
    const dexText = cap === 0 ? 'no DEX' : `${dexPart >= 0 ? '+' : ''}${dexPart} DEX`;
    acCandidates.push({
      label: `${armorWorn.name} (${armorWorn.baseAc} ${dexText})`,
      value: armorWorn.baseAc + dexPart,
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
    const halfProficiency = !proficient && acc.halfProficiencySkills;
    const training = expertise ? prof * 2 : proficient ? prof : halfProficiency ? Math.floor(prof / 2) : 0;
    return { id, ability, proficient, expertise, halfProficiency, bonus: mod(ability) + training };
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
        dice: weapon.damage,
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
        dice: rider.dice,
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
  const expressionContext: ExpressionContext = {
    totalLevel,
    profBonus: prof,
    abilityScore: (a) => abilities[a].score,
    abilityMod: (a) => abilities[a].modifier,
    classLevel: (id) => classLevels[id] ?? 0,
    hasFeature: (id) => notes.some((n) => n.name.toLowerCase().replace(/\s+/g, '-') === id),
  };

  const resources: DerivedResource[] = acc.resources.map((r) => {
    let max: number;
    try {
      max = evaluate(r.max, expressionContext);
    } catch (error) {
      diagnostics.push(`Resource "${r.id}": ${(error as Error).message}`);
      max = 0;
    }
    return { id: r.id, max, recharge: r.recharge };
  });

  // -- finish ---------------------------------------------------------------
  const speed = (acc.speed ?? 30) + acc.speedBonus;

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
    spellcasting,
    resources,
    notes,
    diagnostics,
  };
}

/** A short human summary of a derived ability, for tests and the UI. */
export function describeAbility(ability: DerivedAbility): string {
  const sign = ability.modifier >= 0 ? '+' : '';
  return `${ABILITY_NAMES[ability.id]} ${ability.score} (${sign}${ability.modifier})`;
}

/** Re-exported so callers can render conditional riders without importing rules. */
export type { ScopedAmount, ScopedDice };
