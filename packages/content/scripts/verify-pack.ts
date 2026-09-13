/**
 * Check a content pack without opening the app.
 *
 *   npm run verify --workspace @agorath/content -- path/to/pack.json
 *
 * The same validation the browser runs on upload, with a non-zero exit code so
 * it can gate a script or a CI job. This is where "an offer naming a pool with
 * no options" is meant to be caught — before a player ever sees it.
 *
 * The path is taken relative to **where the command was typed**, not to this
 * package. `npm run` moves the working directory to the workspace, so a
 * repository-relative path would resolve against `packages/content/` and not be
 * found; `INIT_CWD` is where the caller actually was, and it is the only place a
 * path argument can sensibly mean.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPackText } from '../src/pack.ts';

const argument = process.argv[2];
if (argument === undefined) {
  console.error('usage: npm run verify --workspace @agorath/content -- <pack.json>');
  process.exit(2);
}

const path = resolve(process.env['INIT_CWD'] ?? process.cwd(), argument);
if (!existsSync(path)) {
  console.error(`no such pack: ${path}`);
  process.exit(2);
}

const result = readPackText(readFileSync(path, 'utf8'));

if (result.meta === null) {
  console.error('The pack header could not be read.');
} else {
  const { name, version, tier, id } = result.meta;
  console.log(`${name} v${version} (${tier}, ${id})`);
  const counts = Object.entries(result.catalog.counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ');
  console.log(`  ${counts}`);
}

for (const warning of result.warnings) console.log(`  warning: ${warning}`);
for (const error of result.errors) console.log(`  ERROR:   ${error}`);

console.log(
  `\n${result.errors.length} error(s), ${result.warnings.length} warning(s)`,
);
process.exit(result.errors.length === 0 && result.meta !== null ? 0 : 1);
