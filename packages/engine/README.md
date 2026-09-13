# @agorath/engine

The D&D **5e (2014)** rules engine for the character builder.

Pure TypeScript. **No runtime dependencies, and none in development either** —
Node 24 strips the types natively and ships its own test runner, so there is
nothing to install but the compiler for type-checking.

## The one idea

**A definition holds inputs. A sheet holds outputs. Nothing derived is ever
stored.**

`derive(definition, content)` is a pure function: a character definition and a
content provider go in, a complete sheet comes out. It touches no DOM, does no
I/O, and mutates nothing.

That is not a stylistic preference. It is what makes a stale attack bonus after
a level-up *structurally impossible* rather than a bug to hunt, and it is what
makes retroactivity fall out for free: raise CON and hit points, saves and
skills all move, because they were never stored anywhere to become stale.

## Running it

```sh
npm install          # the compiler and node types, nothing else
npm test             # node --test, using the built-in runner
npm run typecheck    # tsc --noEmit
```

## How content stays data

Content declares **effects** drawn from a closed catalogue of shapes. There is
code per *shape*, never per feature: `damage.dice` serves Sneak Attack, Divine
Smite and Hunter's Mark alike.

A feature that fits no shape is plain text, and that is a legitimate outcome —
the Thief archetype has five features and not one of them changes a number on
the sheet.

Formulas are **data that is evaluated, not code**. Where a value is computed
from the character, the field holds a string in a sandboxed expression language:

```
identifiers   totalLevel, profBonus
functions     abilityMod(ABBR), abilityScore(ABBR), classLevel(id), hasFeature(id),
              floor(x), ceil(x), max(...), min(...)
```

No assignment, no function definitions, no property access. An expression naming
an unknown identifier throws, so a bad pack fails at build time rather than
evaluating to zero at the table.

## The derivation pipeline

Passes run in a fixed order, and the order is what produces retroactivity:

```
1  ability increases        from race, subrace and ASI choices
2  abilities                base + increases, capped at 20
3  collect effects          features, feats, items, race, background
4  saving throws            from the engine's class table
5  equipment                armour, shield, weapons
6  armour class             every available formula, best wins
7  hit points               each level, at the current CON modifier
8  hit dice pool
9  skills, saves, passives
10 attacks                  ability choice, proficiency, riders
11 spellcasting             per class, or the multiclass rule
12 resources                maxima from expressions
```

Effects are collected before abilities resolve, and everything that reads a
modifier runs after it. Ordering is the whole mechanism.

## Verification

The class tables — hit dice, saving throws, ASI levels, subclass levels,
proficiency progression, spell slots — are **verified against the 2014 SRD**
rather than recalled. Cross-checked 2026-09-13 across all 12 classes and all 20
levels:

| | Result |
|---|---|
| Proficiency bonus | **240 / 240** match |
| Spell slots (full, half, pact) | **160 / 160** match |
| ASI counts | 233 / 240 — see below |

The seven ASI disagreements are **all rogue, levels 11 and up**, and the engine
is the correct side. The community SRD dataset's cumulative ASI column is wrong
from level 11 on: it gives a level-20 rogue 5 improvements instead of 6. Its
*increments* are right, which is why the engine declares twelve explicit
per-class level lists rather than reading a cumulative count.

`test/golden.test.ts` is the specification in executable form. Every expected
value is computed by hand from the 2014 rules and written into the assertion, so
a disagreement is the point rather than a nuisance. It covers multiclass
proficiency bonus, retroactive CON, expertise, Jack of All Trades, both
Unarmored Defense variants, all three armour DEX rules, finesse, conditional
riders, Pact Magic and multiclass caster levels.

## What is implemented, and what is not

Honest accounting, because the catalogue is deliberately larger than the code.

**Implemented** — `ability.increase`, `proficiency.grant`,
`proficiency.expertise`, `proficiency.half`, `check.floor`, `ac.formula`,
`ac.bonus`, `hp.per-level`, `hp.flat`, `speed.set`, `speed.bonus`,
`attack.bonus`, `damage.bonus`, `damage.dice`, `attack.count`, `unarmed.die`,
`spellcasting.grant`, `spell.dc.bonus`, `initiative.bonus`, `resource.pool`.

**Accepted but not yet applied** — `check.advantage`. Advantage is not a number
on a character sheet except on a passive score, and passives are not yet
per-check, so the shape is collected and ignored. It is kept because the PHB
pass will need it.

**Not yet in the engine at all** — `ability.set-min` (Belt of Giant Strength),
`resistance.grant`, `immunity.grant`, `save.advantage`, `damage.reroll`
(Great Weapon Fighting), `attack.ability` (Pact of the Blade), the spell
*choice* shapes (`spell.grant`, `spell.choose`, `slots.table`), and
`carry.multiply`. Spell **slots** are computed; spell **lists** are not.

**Known limitations**

- **Scopes are conjunctive.** A scope can require many things at once but cannot
  express "finesse *or* ranged", which is what Sneak Attack actually needs. Its
  rider is therefore declared unscoped and conditional. This is the first thing
  the PHB authoring pass should resolve.
- **Skill choices are not modelled.** Skills arrive from granted effects, so a
  fixture grants them directly. Player choice of skills needs a mechanism.
- **Advantage and disadvantage are not tracked**, so the passive-score `+5` rule
  is not applied.
- **The effect catalogue is provisional.** The 38-shape count is an estimate
  confirmed or corrected by authoring the PHB.

## Layout

```
src/
  types.ts       definition, content entries, the effect catalogue, the sheet
  rules.ts       rules of the game, and the verified class tables
  expression.ts  the sandboxed formula language
  effects.ts     the accumulator, and declarative scope matching
  content.ts     how the engine reaches content
  derive.ts      the pipeline
  index.ts       public API
```
