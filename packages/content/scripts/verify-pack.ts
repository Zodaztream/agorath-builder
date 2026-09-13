/**
 * Check a content pack without opening the app.
 *
 *   npm run verify --workspace @agorath/content -- /path/to/pack.json
 *
 * The same validation the browser runs on upload, with a non-zero exit code so
 * it can gate a script or a CI job. This is where "an offer naming a pool with
 * no options" is meant to be caught — before a player ever sees it.
 */

import { readFileSync } from 'node:fs';
import { readPackText } from '../src/pack.ts';

const path = process.argv[2];
if (path === undefined) {
  console.error('usage: npm run verify --workspace @agorath/content -- <pack.json>');
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
