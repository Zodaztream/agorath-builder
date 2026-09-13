/**
 * @agorath/engine — D&D 5e (2014) rules.
 *
 * A pure, dependency-free rules engine. Give it a character definition and a
 * content provider; it returns a complete sheet. It touches no DOM, performs no
 * I/O, and knows nothing about where its content came from.
 *
 * The engine is the value; the UI is replaceable.
 */

export type {
  Ability,
  AbilityScores,
  AbilityIncrease,
  BackgroundEntry,
  CharacterDefinition,
  ChoiceGrant,
  ClassEntry,
  Condition,
  Currency,
  CustomItem,
  DamageType,
  DerivedAbility,
  DerivedAdvancement,
  DerivedAttack,
  DerivedDamageComponent,
  DerivedDice,
  DerivedNote,
  DerivedPick,
  DerivedResource,
  DerivedSave,
  DerivedSelection,
  DerivedSheet,
  DerivedSkill,
  DerivedSpellcasting,
  Dice,
  Effect,
  EffectShape,
  EffectShapeId,
  FeatEntry,
  FeatureEntry,
  HitPointRoll,
  InventoryItem,
  ItemEntry,
  LevelChoice,
  LevelEntry,
  OptionEntry,
  PackRef,
  RaceEntry,
  Scope,
  SkillId,
  Source,
  SpellcastingProfile,
  SubclassEntry,
  WeaponEntry,
} from './types.ts';

export { ABILITIES, ABILITY_NAMES, DAMAGE_TYPES, EFFECT_SHAPES, EFFECT_SHAPE_IDS, EMPTY_CURRENCY } from './types.ts';

export {
  ABILITY_CAP,
  CLASS_RULES,
  PASSIVE_ADVANTAGE_BONUS,
  PASSIVE_BASE,
  SKILL_ABILITY,
  SKILL_IDS,
  SKILL_NAMES,
  abilityModifier,
  asiCount,
  attackAbility,
  averageHitPoints,
  classRules,
  dice,
  fullCasterSlots,
  halfCasterSlots,
  multiclassCasterLevel,
  pactMagicSlots,
  proficiencyBonus,
  spellAttackBonus,
  spellSaveDc,
} from './rules.ts';

export type { ClassRules } from './rules.ts';

export {
  ExpressionError,
  KNOWN_FUNCTIONS,
  KNOWN_IDENTIFIERS,
  evaluate,
  evaluateExpression,
  parseExpression,
} from './expression.ts';
export type { ExprNode, ExpressionContext } from './expression.ts';

export { anySubject, collectEffect, emptyAccumulator, matchesScope } from './effects.ts';
export type {
  Accumulator,
  AcFormulaSource,
  HalfProficiencyGrant,
  OfferGrant,
  ResourceGrant,
  ScopeSubject,
  ScopedAmount,
  ScopedDice,
} from './effects.ts';

export { inMemoryContent } from './content.ts';
export type { ContentProvider } from './content.ts';

export { ATTUNEMENT_LIMIT, derive, describeAbility } from './derive.ts';
