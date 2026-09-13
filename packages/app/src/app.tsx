/**
 * The shell: pack state, the character, and three screens.
 *
 * State here is deliberately thin — a pack, a definition, and which tab is
 * showing. Everything else is `derive(definition, pack)` during render, which
 * is the sanctioned architecture (ADR-0003): full re-render on every change,
 * no state library, and nothing cached that could disagree with the input.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { derive, inMemoryContent, type CharacterDefinition } from '@agorath/engine';
import { readPackText, type PackReadResult } from '@agorath/content';
import { clearPack, loadPack, savePack } from './pack-store.ts';
import { emptyDefinition, poolHomes } from './store.ts';
import { PackScreen } from './screens/pack-screen.tsx';
import { BuildScreen } from './screens/build-screen.tsx';
import { SheetScreen } from './screens/sheet-screen.tsx';

const CHARACTER_KEY = 'agorath.character';

type Tab = 'pack' | 'build' | 'sheet';

export function App(): JSX.Element {
  const [packText, setPackText] = useState<string | null>(null);
  const [packResult, setPackResult] = useState<PackReadResult | null>(null);
  const [remembered, setRemembered] = useState(false);
  const [definition, setDefinition] = useState<CharacterDefinition>(() => loadCharacter());
  const [tab, setTab] = useState<Tab>('pack');

  // A remembered pack is what makes this a tool rather than a chore: the
  // upload is once per browser, not once per visit.
  useEffect(() => {
    void loadPack().then((text) => {
      if (text === null) return;
      setPackText(text);
      setPackResult(readPackText(text));
      setRemembered(true);
    });
  }, []);

  // Autosave to localStorage (ADR-0001). The exported file is still the real
  // artefact; this only survives a refresh.
  useEffect(() => {
    try {
      localStorage.setItem(CHARACTER_KEY, JSON.stringify(definition));
    } catch {
      // A full or blocked store costs a convenience, not the character.
    }
  }, [definition]);

  const content = useMemo(
    () => packResult?.provider ?? inMemoryContent({}),
    [packResult],
  );

  const sheet = useMemo(() => derive(definition, content), [definition, content]);
  const homes = useMemo(() => poolHomes(definition, content), [definition, content]);

  const handleUpload = (file: File): void => {
    void file.text().then((text) => {
      const result = readPackText(text);
      setPackText(text);
      setPackResult(result);
      if (result.meta !== null) {
        void savePack(text).then(setRemembered);
        setTab('build');
      } else {
        setRemembered(false);
      }
    });
  };

  const handleClearPack = (): void => {
    void clearPack();
    setPackText(null);
    setPackResult(null);
    setRemembered(false);
  };

  const exportCharacter = (): void => {
    // ADR-0006: the file carries the definition, and a `session` seam a later
    // version fills in. Nothing derived is ever written.
    const payload = JSON.stringify({ definition, session: null }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${definition.name.replace(/[^\w -]+/g, '') || 'character'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importCharacter = (file: File): void => {
    void file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as { definition?: unknown };
        const incoming = (parsed.definition ?? parsed) as CharacterDefinition;
        if (incoming.ruleset !== '2014') {
          window.alert('That file is not a 2014 character.');
          return;
        }
        setDefinition(incoming);
        setTab('build');
      } catch {
        window.alert('That file is not a character this tool wrote.');
      }
    });
  };

  const errorCount = packResult?.errors.length ?? 0;
  const diagnosticCount = sheet.diagnostics.length;
  const packLoaded = packResult?.meta !== null && packResult !== null;

  return (
    <div class="app">
      <header class="top">
        <h1>Agorath <span>character builder</span></h1>
        <nav>
          <button type="button" class={tab === 'pack' ? 'on' : ''} onClick={() => setTab('pack')}>
            Content{errorCount > 0 ? ` (${errorCount})` : ''}
          </button>
          <button type="button" class={tab === 'build' ? 'on' : ''} onClick={() => setTab('build')}>
            Build
          </button>
          <button type="button" class={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
            Sheet{diagnosticCount > 0 ? ` (${diagnosticCount})` : ''}
          </button>
        </nav>
      </header>

      <main>
        {tab === 'pack' && (
          <PackScreen
            pack={packResult}
            remembered={remembered}
            onUpload={handleUpload}
            onClear={handleClearPack}
          />
        )}

        {tab === 'build' && !packLoaded && (
          <p class="notice notice-info">
            No content pack is loaded, so there is nothing to build with. Load one on the
            <button type="button" class="link" onClick={() => setTab('pack')}> Content</button> tab.
          </p>
        )}

        {tab === 'build' && packLoaded && packResult !== null && (
          <BuildScreen
            definition={definition}
            content={content}
            catalog={packResult.catalog}
            sheet={sheet}
            homes={homes}
            onChange={setDefinition}
          />
        )}

        {tab === 'sheet' && (
          <SheetScreen
            definition={definition}
            sheet={sheet}
            packLabel={packResult?.meta === null || packResult === null ? '' : `${packResult.meta.name} v${packResult.meta.version}`}
            onExport={exportCharacter}
            onImport={importCharacter}
          />
        )}
      </main>

      <footer>
        <p>
          D&amp;D 5e (2014) character builder for a private campaign.
          {' '}
          The game rules referenced here are the 2014 SRD, released by Wizards of the Coast under
          CC-BY-4.0; this site carries no book content of its own, and the content pack you load is
          yours to keep and not part of this site.
        </p>
        <p class="muted">
          Nothing you type or upload leaves this browser. {packText === null ? '' : 'A pack is loaded.'}
        </p>
      </footer>
    </div>
  );
}

function loadCharacter(): CharacterDefinition {
  try {
    const raw = localStorage.getItem(CHARACTER_KEY);
    if (raw === null) return emptyDefinition();
    const parsed = JSON.parse(raw) as CharacterDefinition;
    return parsed.ruleset === '2014' ? parsed : emptyDefinition();
  } catch {
    return emptyDefinition();
  }
}
