/**
 * Collecting and applying effects.
 *
 * Content declares effects; this module folds them into an accumulator that the
 * derivation pipeline reads. One shape serves many features — `damage.dice` is
 * Sneak Attack, Divine Smite and Hunter's Mark alike — which is what keeps
 * content as data instead of a branch per feature.
 */

import type {
  Ability,
  ChoiceGrant,
  DamageType,
  DerivedGrantedItem,
  Dice,
  Effect,
  Scope,
  SkillId,
} from './types.ts';

// ---------------------------------------------------------------------------
// Scope matching
// ---------------------------------------------------------------------------

/** What a scope is tested against. */
export interface ScopeSubject {
  readonly kind: 'weapon' | 'check' | 'save';
  /** The id of the thing itself — the weapon a line belongs to, or ''. */
  readonly id: string;
  readonly melee: boolean;
  readonly ranged: boolean;
  readonly properties: readonly string[];
  readonly skills: readonly SkillId[];
  readonly ability: Ability | null;
}

/** The broadest subject: matches any scope that does not narrow by kind. */
export function anySubject(kind: ScopeSubject['kind']): ScopeSubject {
  return { kind, id: '', melee: false, ranged: false, properties: [], skills: [], ability: null };
}

/**
 * A declarative filter, never a predicate. Every constraint a scope states must
 * hold; an absent constraint places no requirement. `or` relaxes that for the
 * one case a conjunction cannot express — "finesse or ranged".
 */
export function matchesScope(scope: Scope | undefined, subject: ScopeSubject): boolean {
  if (scope === undefined) return true;

  if (scope.or !== undefined && !scope.or.some((branch) => matchesScope(branch, subject))) {
    return false;
  }

  if (scope.kind !== undefined && scope.kind !== subject.kind) return false;

  if (scope.id !== undefined && scope.id !== subject.id) return false;

  if (scope.melee !== undefined && scope.melee !== subject.melee) return false;
  if (scope.ranged !== undefined && scope.ranged !== subject.ranged) return false;

  if (scope.properties !== undefined) {
    const owned = new Set(subject.properties);
    if (!scope.properties.every((p) => owned.has(p))) return false;
  }

  if (scope.skills !== undefined) {
    if (!scope.skills.some((s) => subject.skills.includes(s))) return false;
  }

  if (scope.abilities !== undefined) {
    if (subject.ability === null) return false;
    if (!scope.abilities.includes(subject.ability)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------

export interface AcFormulaSource {
  readonly label: string;
  readonly base: number;
  readonly abilities: readonly Ability[];
  readonly allowShield: boolean;
  readonly requiresNoArmor: boolean;
  readonly requiresNoShield: boolean;
}

export interface ScopedAmount {
  readonly amount: number;
  readonly scope: Scope | undefined;
  /** True when the effect only applies if the player opts in at the table. */
  readonly conditional: boolean;
  readonly label: string;
}

export interface ScopedDice {
  readonly dice: Dice;
  readonly damageType: DamageType;
  readonly label: string;
  readonly scope: Scope | undefined;
  readonly conditional: boolean;
}

export interface SpellcastingGrant {
  readonly source: string;
  readonly ability: Ability;
  readonly progression: 'full' | 'half' | 'third' | 'pact';
  readonly preparation: 'prepared' | 'known';
}

export interface ResourceGrant {
  readonly id: string;
  readonly max: string;
  readonly recharge: 'short' | 'long';
}

/**
 * Half proficiency on checks you are not proficient in. A *list* rather than a
 * flag, because the roundings differ: Jack of All Trades rounds down (PHB 54)
 * and Remarkable Athlete rounds up (PHB 72), and at proficiency +3 the two
 * disagree.
 */
export interface HalfProficiencyGrant {
  readonly round: 'up' | 'down';
  readonly scope: Scope | undefined;
  readonly label: string;
}

/**
 * One feature's "choose N from a pool". Entitlement is the sum of `count`
 * across every offer for a pool, which is why a second Fighting Style at 10th
 * level needs no arithmetic — it is a second feature making a second offer.
 */
export interface OfferGrant {
  readonly pool: string;
  readonly label: string;
  readonly count: number;
  readonly from: readonly string[] | null;
  readonly grants: readonly ChoiceGrant[];
  readonly origin: string;
}

export interface FeatureNote {
  readonly name: string;
  readonly level: number;
  readonly summary: string;
}

export interface Accumulator {
  /**
   * Ability increases from content, not from race or an ASI choice. They are
   * collected *before* abilities resolve, because a feat or a picked option can
   * raise a score and everything downstream has to see it.
   */
  readonly abilityIncreases: Record<Ability, number>;
  readonly skillProficiencies: Set<SkillId>;
  readonly skillExpertise: Set<SkillId>;
  readonly toolExpertise: Set<string>;
  readonly saveProficiencies: Set<Ability>;
  readonly toolProficiencies: Set<string>;
  readonly armorProficiencies: Set<string>;
  readonly weaponProficiencies: Set<string>;
  /** Every half-proficiency rule the character has, keeping its rounding. */
  readonly halfProficiency: HalfProficiencyGrant[];
  /** Reliable Talent and kin: a floor on the d20 result of a proficient check. */
  checkFloor: number | null;

  readonly acFormulas: AcFormulaSource[];
  readonly acBonuses: ScopedAmount[];

  hpPerLevel: number;
  hpFlat: number;

  speed: number | null;
  speedBonus: number;

  readonly attackBonuses: ScopedAmount[];
  readonly damageBonuses: ScopedAmount[];
  readonly damageDice: ScopedDice[];
  extraAttacks: number;
  /** The lowest d20 roll that crits. 20, unless a feature lowers it. */
  critMinimum: number;
  unarmedDie: number | null;

  initiativeBonus: number;
  spellDcBonus: number;

  readonly spellcasting: SpellcastingGrant[];
  readonly resources: ResourceGrant[];
  /** Every "choose N from a pool" the character's features offer. */
  readonly offers: OfferGrant[];
  /**
   * Items the character's content says they carry. Collected here rather than
   * written to the definition, because the definition is the player's: the
   * builder reads this list and reconciles the inventory against it.
   */
  readonly itemGrants: DerivedGrantedItem[];
  readonly notes: FeatureNote[];
}

export function emptyAccumulator(): Accumulator {
  return {
    abilityIncreases: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skillProficiencies: new Set(),
    skillExpertise: new Set(),
    toolExpertise: new Set(),
    saveProficiencies: new Set(),
    toolProficiencies: new Set(),
    armorProficiencies: new Set(),
    weaponProficiencies: new Set(),
    halfProficiency: [],
    checkFloor: null,
    acFormulas: [],
    acBonuses: [],
    hpPerLevel: 0,
    hpFlat: 0,
    speed: null,
    speedBonus: 0,
    attackBonuses: [],
    damageBonuses: [],
    damageDice: [],
    extraAttacks: 0,
    critMinimum: 20,
    unarmedDie: null,
    initiativeBonus: 0,
    spellDcBonus: 0,
    spellcasting: [],
    resources: [],
    offers: [],
    itemGrants: [],
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Applying one effect
// ---------------------------------------------------------------------------

function scoped(effect: Effect): { scope: Scope | undefined; conditional: boolean; label: string } {
  return {
    scope: effect.scope,
    conditional: effect.condition?.optional ?? false,
    label: effect.condition?.label ?? '',
  };
}

/**
 * Fold one effect into the accumulator.
 *
 * `origin` names where the effect came from, for diagnostics and for the
 * breakdown shown on the sheet.
 */
export function collectEffect(
  acc: Accumulator,
  effect: Effect,
  origin: string,
  /**
   * The *id* of the entry the effect came from. Diagnostics and breakdowns use
   * the display name, but a granted item records the id, because the inventory
   * keeps it and a renamed feature must not orphan what it gave.
   */
  originId: string = origin,
): void {
  switch (effect.shape) {
    case 'ability.increase':
      // Collected, not applied here: the ability pass reads this before it
      // computes a modifier. Collection therefore has to run first.
      acc.abilityIncreases[effect.ability] += effect.amount;
      break;

    case 'proficiency.grant':
      for (const id of effect.ids) {
        if (effect.kind === 'skill') acc.skillProficiencies.add(id as SkillId);
        else if (effect.kind === 'save') acc.saveProficiencies.add(id as Ability);
        else if (effect.kind === 'tool') acc.toolProficiencies.add(id);
        else if (effect.kind === 'armor') acc.armorProficiencies.add(id);
        else acc.weaponProficiencies.add(id);
      }
      break;

    case 'proficiency.expertise':
      // Expertise in a tool is a real choice, not a curiosity: PHB 96 offers a
      // rogue thieves' tools as an alternative to a second skill.
      for (const id of effect.ids) {
        if (effect.kind === 'skill') acc.skillExpertise.add(id as SkillId);
        else acc.toolExpertise.add(id);
      }
      break;

    case 'proficiency.half': {
      const s = scoped(effect);
      acc.halfProficiency.push({ round: effect.round, scope: s.scope, label: s.label || origin });
      break;
    }

    case 'check.floor':
      acc.checkFloor = acc.checkFloor === null ? effect.value : Math.max(acc.checkFloor, effect.value);
      break;

    case 'check.advantage':
      // Advantage is not a number on the sheet. It matters only for passive
      // scores, which the derivation pass handles.
      break;

    case 'ac.formula':
      acc.acFormulas.push({
        label: effect.label,
        base: effect.base,
        abilities: effect.abilities,
        allowShield: effect.allowShield,
        requiresNoArmor: effect.requiresNoArmor,
        requiresNoShield: effect.requiresNoShield,
      });
      break;

    case 'ac.bonus': {
      const s = scoped(effect);
      acc.acBonuses.push({ amount: effect.amount, scope: s.scope, conditional: s.conditional, label: s.label || origin });
      break;
    }

    case 'hp.per-level':
      acc.hpPerLevel += effect.amount;
      break;

    case 'hp.flat':
      acc.hpFlat += effect.amount;
      break;

    case 'speed.set':
      acc.speed = acc.speed === null ? effect.amount : Math.max(acc.speed, effect.amount);
      break;

    case 'speed.bonus':
      acc.speedBonus += effect.amount;
      break;

    case 'attack.bonus': {
      const s = scoped(effect);
      acc.attackBonuses.push({ amount: effect.amount, scope: s.scope, conditional: s.conditional, label: s.label || origin });
      break;
    }

    case 'damage.bonus': {
      const s = scoped(effect);
      acc.damageBonuses.push({ amount: effect.amount, scope: s.scope, conditional: s.conditional, label: s.label || origin });
      break;
    }

    case 'damage.dice': {
      const s = scoped(effect);
      acc.damageDice.push({
        dice: effect.dice,
        damageType: effect.damageType,
        label: effect.label,
        scope: s.scope,
        conditional: s.conditional,
      });
      break;
    }

    case 'attack.count':
      // Extra Attack does not stack across classes: take the best, not the sum.
      acc.extraAttacks = Math.max(acc.extraAttacks, effect.value);
      break;

    case 'attack.crit-range':
      // Improved Critical (19) and Superior Critical (18) do not add up: the
      // wider range wins, so take the lowest.
      acc.critMinimum = Math.min(acc.critMinimum, effect.minimum);
      break;

    case 'unarmed.die':
      acc.unarmedDie = acc.unarmedDie === null ? effect.die : Math.max(acc.unarmedDie, effect.die);
      break;

    case 'spellcasting.grant':
      acc.spellcasting.push({
        source: effect.classId,
        ability: effect.ability,
        progression: effect.progression,
        preparation: effect.preparation,
      });
      break;

    case 'spell.dc.bonus':
      acc.spellDcBonus += effect.amount;
      break;

    case 'initiative.bonus':
      acc.initiativeBonus += effect.amount;
      break;

    case 'resource.pool':
      // Duplicate ids are kept here rather than merged: `max` is an expression,
      // so taking the maximum means evaluating both, which the pipeline does.
      acc.resources.push({ id: effect.id, max: effect.max, recharge: effect.recharge });
      break;

    case 'choice.offer':
      acc.offers.push({
        pool: effect.pool,
        label: effect.label,
        count: effect.count,
        from: effect.from,
        grants: effect.grants,
        origin,
      });
      break;

    case 'inventory.grant':
      for (const granted of effect.items) {
        acc.itemGrants.push({
          item: granted.item,
          quantity: granted.quantity,
          grantedBy: originId,
        });
      }
      break;
  }
}
