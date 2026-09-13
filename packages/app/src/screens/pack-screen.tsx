/**
 * The content pack screen.
 *
 * The app ships with no book content, so this screen is the difference between
 * a working tool and an empty one. It has to answer three questions without
 * being asked: is a pack loaded, which version, and is anything wrong with it.
 */

import type { JSX } from 'preact';
import type { PackReadResult } from '@agorath/content';
import { Notice, Panel } from '../ui.tsx';

export function PackScreen(props: {
  pack: PackReadResult | null;
  remembered: boolean;
  onUpload: (file: File) => void;
  onClear: () => void;
}): JSX.Element {
  const choose = (event: JSX.TargetedEvent<HTMLInputElement, Event>): void => {
    const file = event.currentTarget.files?.[0];
    if (file !== undefined) props.onUpload(file);
    event.currentTarget.value = '';
  };

  if (props.pack === null) {
    return (
      <Panel title="Content pack" hint="The tool has no rules content of its own.">
        <p>
          Every rule the builder shows comes from a content pack — one JSON file holding the
          classes, races, feats, items and options you want available. Nothing is bundled with this
          site, and the file never leaves your browser.
        </p>
        <p class="muted">
          Load a pack to begin. It is remembered in this browser, so this is a once-per-browser
          step; if you clear your browser data, upload it again.
        </p>
        <label class="upload">
          <input type="file" accept=".json,application/json" onChange={choose} />
          <span>Choose a pack file…</span>
        </label>
      </Panel>
    );
  }

  const { meta, catalog, errors, warnings } = props.pack;

  return (
    <>
      <Panel
        title="Content pack"
        hint={props.remembered ? 'Remembered in this browser.' : 'Not remembered — this browser refused to store it.'}
      >
        <div class="pack-head">
          <div>
            <strong>{meta?.name ?? 'Unreadable pack'}</strong>
            <span class="muted">
              {meta === null ? '' : ` v${meta.version} · ${meta.tier} · ${meta.id}`}
            </span>
          </div>
          <div class="row">
            <label class="upload small">
              <input type="file" accept=".json,application/json" onChange={choose} />
              <span>Replace…</span>
            </label>
            <button type="button" onClick={props.onClear}>Forget</button>
          </div>
        </div>

        <div class="counts">
          {Object.entries(catalog.counts).map(([kind, count]) => (
            <span class="count" key={kind}>
              <b>{count}</b> {kind}
            </span>
          ))}
        </div>
      </Panel>

      <Notice
        tone="error"
        title="This pack has problems that change what it can do"
        items={errors}
      />
      <Notice
        tone="warning"
        title="Worth knowing, but not fatal"
        items={warnings}
      />
      {errors.length === 0 && warnings.length === 0 && (
        <p class="ok">This pack loaded cleanly.</p>
      )}
    </>
  );
}
