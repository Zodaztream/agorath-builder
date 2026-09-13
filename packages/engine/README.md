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
comparisons   == != < <= > >=     and a conditional,   test ? a : b
```

No assignment, no function definitions, no property access. An expression naming
an unknown identifier throws, so a bad pack fails at build time rather than
evaluating to zero at the table. Comparisons yield 1 or 0, which is what lets a
growing pool be written as `classLevel(fighter) >= 15 ? 6 : classLevel(fighter)
>= 7 ? 5 : 4` rather than as arithmetic nobody can find.

## Choices

Every "choose N from a list" is one shape — subclass, class skills, Expertise,
Fighting Style, manoeuvres, invocations, metamagic, the Pact Boon. A feature
declares an offer; the picks live in the character definition.

```json
{ "shape": "choice.offer", "pool": "skill:fighter", "label": "Skills",
  "count": 2, "from": ["acrobatics", "…"], "grants": [ { "shape": "proficiency.grant" } ] }
```

**Entitlement is computed, never stored.** A pool allows as many picks as the
features the character actually has offer, which is why a level-1 fighter has no
archetype to choose and why a Champion's second Fighting Style at 10th level
needs no level arithmetic: it is a second feature making a second offer.

A pick's reward comes from the picked **entry** when the pool's members are
entries (an `option` pool, `subclass:<classId>`), and from the offer's `grants`
when the pool is the engine's own (`skill`, `proficient:<kinds>`). An offer that
forgot `grants` is diagnosed, because its picks would otherwise confer nothing.

Pools resolve four ways, by `family[:qualifier]`:

| Pool | Members |
|---|---|
| `skill`, `skill:<label>` | the eighteen skills; the label only separates two offers, as a fighter's and a rogue's list must be |
| `proficient:<kinds>` | the character's own proficiencies of those kinds |
| `subclass:<classId>` | subclasses whose `class` is that class |
| anything else | options tagged with that pool |

`proficient:` is what Expertise draws from, and PHB 96 makes it necessary: a
rogue chooses "two of your skill proficiencies, or one of your skill
proficiencies and your proficiency with thieves' tools." Membership *is* the
eligibility rule — the engine used to skip a non-proficient expertise silently,
and now reports it.

## The derivation pipeline

Passes run in a fixed order, and the order is what produces retroactivity:

```
1  collect effects          race, background, class features, subclass features,
                            feats, items, and the rewards of every pick
2  resolve selections       pools, entitlement, prerequisites, grants
3  abilities                base + every increase from step 1, capped at 20
4  saving throws            from the engine's class table
5  armour class             every available formula, best wins
6  hit points               each level, at the current CON modifier
7  hit dice pool
8  skills, saves, passives
9  attacks                  ability choice, proficiency, riders
10 spellcasting             per class, or the multiclass rule
11 resources                maxima from expressions, duplicates by id
```

**Effects are collected before abilities resolve**, because a feat or a picked
option can raise a score — Tavern Brawler's `+1 STR` has to have somewhere to
go. Then everything that reads a modifier runs after. Ordering is the whole
mechanism.

Two rules in this loop are load-bearing rather than incidental:

- **A class's features are collected once**, gated by that class's level. The
  earlier per-level loop collected a 5th-level rogue's Sneak Attack five times.
- **Pools are validated in two phases**, because a derived pool's membership
  depends on grants other picks have just made.

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
riders, Pact Magic and multiclass caster levels — and the entitlement checks,
which are the point of the whole mechanism: an archetype before 3rd level, an
ASI at a level the class does not grant one, an over-subscribed pool, a pick
outside the offered list, expertise in a skill the character lacks, an unmet
prerequisite, and an offer naming a pool nobody authored. Each produces a
specific diagnostic, and an incomplete character produces none.

## What is implemented, and what is not

Honest accounting, because the catalogue is deliberately larger than the code.

**Implemented** — `ability.increase`, `choice.offer`, `proficiency.grant`,
`proficiency.expertise`, `proficiency.half` (with its rounding and scope),
`check.floor`, `ac.formula`, `ac.bonus`, `hp.per-level`, `hp.flat`, `speed.set`,
`speed.bonus`, `attack.bonus`, `damage.bonus`, `damage.dice`, `attack.count`,
`attack.crit-range`, `unarmed.die`, `spellcasting.grant`, `spell.dc.bonus`,
`initiative.bonus`, `resource.pool`.

**Accepted but not yet applied** — `check.advantage`. Advantage is not a number
on a character sheet except on a passive score, and passives are not yet
per-check, so the shape is collected and ignored. It is kept because the PHB
pass will need it.

**Not yet in the engine at all** — `ability.set-min` (Belt of Giant Strength),
`resistance.grant`, `immunity.grant`, `save.advantage`, `damage.reroll`
(Great Weapon Fighting), `attack.ability` (Pact of the Blade), the spell
*choice* shapes (`spell.grant`, `spell.choose`, `slots.table`), and
`carry.multiply`. Spell **slots** are computed; spell **lists** are not.

Until `ability.set-min` exists, note that **every** source of an ability increase
is capped at 20 — which is right for the sources that exist (race, ASI, class
features, where PHB 72 says "you can't increase an ability score above 20") and
wrong for the ones that are missing: a *manual of gainful exercise* or a belt of
giant strength raises the ceiling with the score, and would be silently clamped.

**Known limitations**

- **Scopes are conjunctive.** A scope can require many things at once but cannot
  express "finesse *or* ranged", which is what Sneak Attack actually needs. Its
  rider is therefore declared unscoped and conditional. This is the first thing
  the PHB authoring pass should resolve.
- **Two offers of one pool that narrow it with different `from` lists cannot be
  told apart at pick time**, so the union is taken and a diagnostic asks the pack
  for distinct pool names. Two classes with their own skill lists should offer
  `skill:fighter` and `skill:rogue` rather than both claiming `skill`.
- **Advantage and disadvantage are not tracked**, so the passive-score `+5` rule
  is not applied.
- **An unpicked pool is not prompted for.** `selections` reports `entitled`
  against the picks taken, so the UI can say "1 of 2 chosen", but ASI-or-feat is
  not a pool and has no such count on the sheet.
- **`subclassLabel` is null on all twelve classes.** The label is book content —
  "Martial Archetype", "Divine Domain" — so it is read off the class table in the
  authoring pass rather than written from recall, and the offer falls back to
  "Subclass" until then (ADR-0004).
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
