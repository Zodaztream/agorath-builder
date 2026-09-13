/**
 * "Here is what this level gives you", and — while the level is still being
 * decided — the control that decides it, right under the sentence that explains
 * it.
 *
 * That adjacency is the whole design. A page that lists the gains and then, at
 * the bottom, asks four questions in a row is a form; a page where the question
 * sits under the answer is a level-up screen.
 */

import type { ComponentChildren, JSX } from 'preact';
import type { LevelGain } from '@agorath/engine';
import { gainLine, mergeGains } from '../level-up.ts';

export function GainList(props: {
  gains: readonly LevelGain[];
  /** The control for a gain, when there is still something to decide. */
  control?: (gain: LevelGain) => ComponentChildren;
}): JSX.Element | null {
  if (props.gains.length === 0) return null;

  return (
    <ol class="gains">
      {mergeGains(props.gains).map((gain, index) => {
        const line = gainLine(gain);
        return (
          <li class={`gain gain-${gain.kind}`} key={index}>
            <div class="gain-row">
              <span class="gain-title">
                {line.title}
                {line.detail !== '' && <span class="gain-detail">{line.detail}</span>}
              </span>
              {line.value !== '' && <span class="gain-value">{line.value}</span>}
            </div>
            {props.control === undefined ? null : <div class="gain-control">{props.control(gain)}</div>}
          </li>
        );
      })}
    </ol>
  );
}
