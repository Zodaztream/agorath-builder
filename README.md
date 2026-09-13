# Agorath Character Builder

A D&D **5e (2014 rules)** character creation, leveling and sheet tool, built for
a private home campaign.

Static and client-side, with no backend: it runs from GitHub Pages and keeps
working offline at the table once loaded.

> **Status: pilotable.** The engine, the pack format and the app are built and
> deployed; a pilot content pack covers three classes. Spell lists, the full
> library and the private pack build tool are not built yet.

## Running it

```sh
npm install
npm test                                  # the engine and pack-format suites
npm run build --workspace @agorath/app    # static output in packages/app/dist
npm run dev --workspace @agorath/app      # local dev server

# Check a content pack without opening the browser:
npm run verify --workspace @agorath/content -- path/to/pack.json
```

The app needs a content pack to do anything — it ships with no book content.
Upload one on the **Content** tab; it is kept in your browser and never sent
anywhere.

## What it does

- **Character creation and leveling for 5e 2014** — not the 2024 revision, which
  differs in ways that break things silently.
- **Derived statistics that are actually derived.** Change an ability score and
  everything downstream moves with it: modifiers, all 18 skills, saves, passives,
  initiative, AC, carrying capacity, spell save DC.
- **Attack rolls and damage, computed** — ability choice for finesse, thrown,
  ranged and versatile weapons, plus feature riders.
- **Leveling that recomputes rather than accumulating.** Nothing derived is ever
  stored, so a level-up cannot leave a stale number on the sheet.
- **Inventory, attunement and currency.**

## Architecture

```
packages/
  engine/    zero dependencies, pure TypeScript - every rule and derivation
  content/   pack schema and validator
  app/       Preact + TSX, built with Vite
```

The rules engine is a pure function: a character definition goes in, a complete
sheet comes out. The UI renders that and nothing else. Keeping the engine free of
dependencies and of the DOM is what makes it reusable and testable in isolation.

## Content and why this repository carries none of it

The tool offers the complete 2014 content library, so that nobody at the table
needs to own the books. Most of that content is **copyrighted**, and a public
repository is published material regardless of who it was built for.

So the content is split by licence:

| Tier | Example | How it ships |
|---|---|---|
| **SRD 5.1** | The 2014 SRD subset | With the app, attributed below |
| **Published non-SRD** | Xanathar's, Tasha's, the PHB | A private **content pack**, distributed to players directly and loaded at runtime |
| **Campaign homebrew** | Table-specific items | Player-authored, living in the character file |

The pack is a **single versioned JSON file** a player imports once in the
browser: one entry per class, subclass, option, feat, race, background and item,
all in one document, validated on load. It is never fetched from a server and
never committed here — this repository contains no book content of any kind, and
`.gitignore` is default-deny for exactly that reason.

To check a pack before sharing it, `npm run verify --workspace @agorath/content`
prints every error and warning without opening the app — including the check that
matters most, an offer naming a pool nobody authored options for.

Content is **data, not code**: adding a subclass means adding an entry, never
adding a branch to the engine.

## Licensing and attribution

### Code

The application code is **not licensed**, and no rights to it are granted here.
It is public because GitHub Pages requires a public repository — not to be
reused or redistributed.

This matters for reading the next part correctly: CC-BY-4.0 covers the **SRD
material only**, not this application.

### SRD 5.1 content

SRD 5.1 content is used under CC-BY-4.0. Required attribution:

> This work includes material taken from the System Reference Document 5.1
> ("SRD 5.1") by Wizards of the Coast LLC and available at
> https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
> licensed under the Creative Commons Attribution 4.0 International License
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

This work is compatible with fifth edition. It is not affiliated with, endorsed,
sponsored or specifically approved by Wizards of the Coast LLC.

## Where this repository comes from

This is the **public** half of a two-repository setup, and it is a **publication
target** rather than a workspace.

The application is developed alongside the campaign it serves, from a private
repository that also holds the campaign material, the design documentation and
the content-pack tooling. Only the publishable files land here. Nothing is
authored here directly — which is why there is no `CLAUDE.md` and no separate
working context, and why the two histories share no commits.

For a reader that means one thing: **this repository contains the application
and nothing else.** No campaign material, no design documents, no content packs,
no book content. `.gitignore` is default-deny for `*.pdf`, `packs/`, `books/`
and `*.pack.json` so such content cannot arrive here by accident, and the split
exists precisely so that publishing the app cannot publish the private material
alongside it.

Because this repository is public, anything committed here is published. Treat
every file as player-visible.
