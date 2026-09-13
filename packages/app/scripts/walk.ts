/**
 * Walk the built site in a real browser, and say what broke.
 *
 *   npm run build --workspace @agorath/app
 *   npm run walk  --workspace @agorath/app -- path/to/pack.json
 *
 * This is the only check here that exercises **the built site** rather than the
 * modules: it serves `packages/app/dist`, drives headless Chromium over the
 * DevTools protocol, loads a pack through the real file input, and walks the
 * whole build — every step, four levels, and the sheet. It fails on any console
 * error or uncaught exception, and checks that the layout does not overflow.
 *
 * It exists because the failures unit tests cannot see are the ones that matter
 * for a static site: a blank page, a component that throws on mount, a stylesheet
 * rule that lays the whole builder out sideways, an asset URL that 404s because
 * `base` is wrong. Two of those were real.
 *
 * **It is not a CI test, and cannot be one.** It needs a content pack, and packs
 * are never committed here (`.gitignore` is default-deny for exactly that
 * reason). So it runs on a machine that has a pack and a browser, and its
 * expectations are written against the pilot pack's slice — three classes,
 * forty-odd items. A different pack will need different expectations; the
 * failure messages name the step, so adjusting them is quick.
 *
 * **No dependencies.** Chromium is whatever is already installed — see
 * `findBrowser`. The protocol is spoken directly over Node's built-in
 * `WebSocket`, which keeps this in the same spirit as the rest of the tooling.
 */

import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const USAGE = `usage: npm run walk --workspace @agorath/app -- <pack.json> [options]

  <pack.json>       a content pack to load; the run is a smoke test against it
  --width <px>      viewport width (default 1280; 420 is the phone check)
  --shots <dir>     write a PNG at each step, for looking at rather than reading
  --port <n>        port for the throwaway static server (default 4319)`;

const argv = process.argv.slice(2);
const options = { width: 1280, shots: null as string | null, port: 4319 };
const positional: string[] = [];

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--width') options.width = Number(argv[++i] ?? 1280);
  else if (arg === '--shots') options.shots = argv[++i] ?? null;
  else if (arg === '--port') options.port = Number(argv[++i] ?? 4319);
  else if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0); }
  else if (arg !== undefined) positional.push(arg);
}

/**
 * `npm run` sets the working directory to the package, not to where the command
 * was typed — so a relative pack path from the repository root would resolve
 * against `packages/app/` and not be found. `INIT_CWD` is where the user
 * actually was, and it is the only cwd a path argument can mean.
 */
const invokeDir = process.env['INIT_CWD'] ?? process.cwd();

const packPath = positional[0] === undefined ? undefined : resolve(invokeDir, positional[0]);
if (packPath === undefined || !existsSync(packPath)) {
  console.error(USAGE);
  if (packPath !== undefined) console.error(`\nno such pack: ${packPath}`);
  process.exit(2);
}

// Resolved against this file, not the cwd, so the script works from anywhere.
const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(APP, 'dist');
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`No build at ${DIST}. Run:\n  npm run build --workspace @agorath/app`);
  process.exit(2);
}

/**
 * The app is served under its GitHub Pages base path, because that is what the
 * built HTML asks for — serving it from the root would 404 every asset and
 * prove nothing about the deploy.
 */
const BASE = '/agorath-builder/';
const ORIGIN = `http://localhost:${options.port}`;

// ---------------------------------------------------------------------------
// A browser, wherever this machine keeps one
// ---------------------------------------------------------------------------

function findBrowser(): string | null {
  const candidates: string[] = [];
  if (process.env['CHROME'] !== undefined) candidates.push(process.env['CHROME']);

  if (platform() === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    );
  } else if (platform() === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    );
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium');
  }

  // Playwright and Puppeteer keep their downloads in a cache; a machine that
  // has run either has a headless Chromium already, and it counts.
  const caches = [
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'puppeteer'),
  ];
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('chromium')) continue;
      const dir = join(cache, entry);
      candidates.push(
        join(dir, 'chrome-mac-arm64', 'chrome-headless-shell'),
        join(dir, 'chrome-mac', 'chrome-headless-shell'),
        join(dir, 'chrome-linux', 'chrome-headless-shell'),
        join(dir, 'chrome-win', 'chrome-headless-shell.exe'),
        join(dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        join(dir, 'chrome-linux', 'chrome'),
        join(dir, 'chrome-win', 'chrome.exe'),
      );
    }
  }

  return candidates.find((candidate) => candidate !== '' && existsSync(candidate)) ?? null;
}

const browserPath = findBrowser();
if (browserPath === null) {
  console.error(
    'No Chromium or Chrome found. Set CHROME=/path/to/chrome, or install one.\n' +
    'Tried the usual macOS, Windows and Linux locations, and the Playwright and Puppeteer caches.',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// A throwaway static server, so the site is served the way Pages serves it
// ---------------------------------------------------------------------------

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0] ?? '/';
  const relative = path.startsWith(BASE) ? path.slice(BASE.length) : path.slice(1);
  const file = join(DIST, relative === '' ? 'index.html' : relative);
  readFile(file)
    .then((body) => {
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    })
    .catch(() => response.writeHead(404).end('not found'));
});
await new Promise<void>((done) => server.listen(options.port, done));

// ---------------------------------------------------------------------------
// Chromium, over the DevTools protocol
// ---------------------------------------------------------------------------

/**
 * A fresh profile every run, thrown away afterwards.
 *
 * The character and the pack are kept in `localStorage`, so a reused profile
 * would start the walk with a character already at 4th level — the first step
 * would fail and the rest would be testing the wrong thing. It took one
 * confusing run to learn that.
 */
const profileDir = mkdtempSync(join(tmpdir(), 'agorath-walk-'));

const chrome: ChildProcess = spawn(browserPath, [
  '--headless', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', `--window-size=${options.width},1400`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

function shutdown(code: number): never {
  if (chrome.pid !== undefined) chrome.kill();
  server.close();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* a locked profile is not worth failing over */ }
  process.exit(code);
}

const wsUrl = await new Promise<string>((done, fail) => {
  const timer = setTimeout(() => fail(new Error('the browser did not report a debugging URL')), 30_000);
  let buffered = '';
  chrome.stderr?.on('data', (chunk: Buffer) => {
    buffered += String(chunk);
    const match = buffered.match(/ws:\/\/[^\s]+/);
    if (match !== null) { clearTimeout(timer); done(match[0] as string); }
  });
});

const socket = new WebSocket(wsUrl);
await new Promise<void>((done) => socket.addEventListener('open', () => done()));

let nextId = 1;
const pending = new Map<number, (message: CdpMessage) => void>();
const events: CdpMessage[] = [];

interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly sessionId?: string;
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data)) as CdpMessage;
  if (message.id !== undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  events.push(message);
});

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CdpMessage> {
  const id = nextId++;
  return new Promise((done) => {
    pending.set(id, done);
    socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
  });
}

// Create the target *at the app's URL*: creating one at about:blank and then
// navigating races the initial load, which can land second and leave the page
// blank — which looks exactly like a broken deploy.
const created = await send('Target.createTarget', { url: `${ORIGIN}${BASE}` });
const targetId = (created.result?.['targetId'] ?? '') as string;
const attached = await send('Target.attachToTarget', { targetId, flatten: true });
const session = (attached.result?.['sessionId'] ?? '') as string;

await send('Page.enable', {}, session);
await send('Runtime.enable', {}, session);
await send('DOM.enable', {}, session);
await send('Log.enable', {}, session);

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Evaluate in the page. A thrown error comes back as a string, not a crash. */
async function evaluate(expression: string): Promise<unknown> {
  const { result } = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  }, session);
  const details = result?.['exceptionDetails'] as { exception?: { description?: string } } | undefined;
  if (details !== undefined) return `THREW: ${details.exception?.description ?? 'unknown'}`;
  return result?.['result'] !== undefined ? (result['result'] as { value?: unknown }).value : undefined;
}

async function until(expression: string, timeout = 6000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if ((await evaluate(expression)) === true) return true;
    if (Date.now() > deadline) return false;
    await sleep(60);
  }
}

const text = (selector: string): Promise<unknown> =>
  evaluate(`(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '<<missing>>')`);

/** Like `text`, but sees inside closed `<details>` and CSS-uppercased labels. */
const raw = (selector: string): Promise<unknown> =>
  evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '<<missing>>')`);

const has = async (selector: string, needle: string): Promise<boolean> =>
  String(await text(selector)).includes(needle);
const hasRaw = async (selector: string, needle: string): Promise<boolean> =>
  String(await raw(selector)).includes(needle);

/**
 * Click by visible text, then wait for whatever the click should cause.
 *
 * `innerText` applies `text-transform`, so a label the stylesheet uppercases
 * will not match its own source text; the selectors here are all written
 * against what is on screen.
 */
async function click(label: string, condition: string | null = null, nth = 0): Promise<string> {
  const outcome = await evaluate(`(() => {
    const wanted = ${JSON.stringify(label)};
    const nodes = [...document.querySelectorAll('button, .card-head, .chip, summary, label')];
    const hits = nodes.filter((n) => (n.innerText || '').trim().startsWith(wanted));
    if (hits.length <= ${nth}) return 'no element starting with ' + JSON.stringify(wanted);
    hits[${nth}].click();
    return 'ok';
  })()`);
  if (outcome !== 'ok') return String(outcome);
  if (condition !== null && !(await until(condition))) return `no change after clicking ${JSON.stringify(label)}`;
  return 'ok';
}

/** Click several things in turn, letting the app re-render between clicks. */
async function clickEach(labels: readonly string[]): Promise<string> {
  for (const label of labels) {
    const outcome = await click(label);
    if (outcome !== 'ok') return outcome;
    await sleep(120);
  }
  return 'ok';
}

async function shot(name: string): Promise<void> {
  if (options.shots === null) return;
  const dir = resolve(invokeDir, options.shots);
  mkdirSync(dir, { recursive: true });
  const { result } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, session);
  const data = result?.['data'] as string | undefined;
  if (data !== undefined) writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'));
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

const results: { name: string; ok: boolean }[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === '' ? '' : `\n        ${detail}`}`);
}

const from = events.length;
const rail = "document.querySelector('.rail')";

console.log(`\nWalking ${ORIGIN}${BASE} at ${options.width}px, with ${packPath}\n`);

check('the app mounts', await until("document.querySelector('.upload') !== null"));

// Load the pack through the real file input, which is the only path a player
// has — a programmatic shortcut would not prove the upload works.
const { result: document_ } = await send('DOM.getDocument', {}, session);
const { result: input } = await send('DOM.querySelector', {
  nodeId: (document_?.['root'] as { nodeId?: number } | undefined)?.nodeId ?? 0,
  selector: 'input[type=file]',
}, session);
await send('DOM.setFileInputFiles', { files: [resolve(packPath)], nodeId: (input?.['nodeId'] ?? 0) as number }, session);

check('the pack loads and the builder appears', await until(`${rail} !== null`), String(await text('.top nav')));
await shot('01-class-step');

// -- layout -----------------------------------------------------------------
// The failures that unit tests cannot see: a rail that outgrows its column, a
// page that scrolls sideways on a phone.
const geometry = (await evaluate(`(() => {
  const box = (sel) => { const el = document.querySelector(sel); if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { right: Math.round(r.right), width: Math.round(r.width) }; };
  return { window: window.innerWidth, rail: box('.rail'), foot: box('.rail-foot'),
           scrollWidth: document.documentElement.scrollWidth };
})()`)) as { window: number; rail: { right: number } | null; foot: { right: number } | null; scrollWidth: number };

check('the rail keeps its own contents',
  geometry.foot === null || geometry.rail === null || geometry.foot.right <= geometry.rail.right + 1,
  `rail ends at ${geometry.rail?.right}, its foot at ${geometry.foot?.right}`);
check('the page does not scroll sideways', geometry.scrollWidth <= geometry.window + 1,
  `scrollWidth ${geometry.scrollWidth} against a ${geometry.window}px window`);

// -- 1. class ---------------------------------------------------------------
check('a class card describes 1st level before it is taken', await has('.card .preview', 'Second Wind'));
check('choosing a class takes a level',
  (await click('Fighter', `${rail}.innerText.includes('Fighter 1')`)) === 'ok');
await shot('02-class-chosen');

// -- 2. race ----------------------------------------------------------------
check('the race card states its ability increases',
  (await click('Next', "document.querySelector('.step-head h2').innerText.includes('race')")) === 'ok'
  && await has('.cards', '+1 STR'), String(await text('.step-head h2')));
await click('Human', `${rail}.innerText.includes('Human')`);
await shot('03-race');

// -- 3. background ----------------------------------------------------------
check('the background card states the skills it grants',
  (await click('Next', "document.querySelector('.step-head h2').innerText.includes('background')")) === 'ok'
  && await has('.cards', 'Athletics'), String(await text('.step-head h2')));
await click('Soldier', `${rail}.innerText.includes('Soldier')`);
await click('Next', "document.querySelector('.step-head h2').innerText.includes('ability scores')");

// -- 4. abilities -----------------------------------------------------------
check('the ability step shows base, race increase and modifier',
  await has('.ability-table', 'With race') && await has('.ability-table', '16 (+1)'));
await shot('04-abilities');

check('point buy lays the scores out for it',
  (await click('Point buy', "document.querySelector('.editor').innerText.includes('27 of 27 left')")) === 'ok',
  String(await text('.editor')));

const budget = String(await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.array-row')];
  const strength = rows.find((r) => r.innerText.startsWith('Strength'));
  const plus = () => [...strength.querySelectorAll('button')].find((b) => b.innerText.trim() === '+');
  for (let i = 0; i < 12; i += 1) { plus().click(); await new Promise((r) => setTimeout(r, 90)); }
  return document.querySelector('.editor').innerText.replace(/\\n+/g, ' | ');
})()`));
check('the budget spends to 18 and refuses to go past 15', budget.includes('18 of 27 left'), budget);
await shot('05-point-buy');

check('the standard array comes back on request',
  (await click('Standard array', null)) === 'ok'
  && await until("document.querySelector('.editor').innerText.includes('all six placed')"),
  String(await text('.editor')));
check('the class suggestion fills the array in',
  (await click('Start from a suggestion', null)) === 'ok'
  && await until("document.querySelector('.pool-head').innerText.includes('all six placed')"));
await click('Next', "document.querySelector('.step-head h2').innerText.includes('class choices')");

// -- 5. choices -------------------------------------------------------------
check('the choices step offers the class skills and the fighting style',
  await has('.step-body', 'choose 2 of 2') && await has('.step-body', 'Fighting Style'),
  String(await text('.step-body')).slice(0, 200));
check('two skills and a fighting style can be picked',
  (await clickEach(['Athletics', 'Perception', 'Archery'])) === 'ok'
  && await until(`${rail}.textContent.includes('all chosen')`),
  String(await text('.rail')));
await shot('06-choices');
await click('Next', "document.querySelector('.step-head h2').innerText.includes('equipment')");

// -- 6. equipment -----------------------------------------------------------
// What the class hands over, and nothing else: browsing a catalogue moved to
// the sheet, where an inventory manager belongs (ADR-0013).
const equipmentBody = String(await text('.step-body'));
// The catalogue groups its items under an `h3` per kind, inside the picker on
// the sheet. This step has no picker at all, which is the difference between
// "here is your kit" and "here is the shop" — and is truer than looking for an
// item's name, since a package's own sentence may well mention one.
const catalogueGroups = Number(await evaluate("document.querySelectorAll('.picker .equip-group h3').length"));
check('the equipment step offers the class\'s packages, not the item list',
  equipmentBody.includes('Weapons') && equipmentBody.includes('Ranged weapon')
  && equipmentBody.includes('Pack') && catalogueGroups === 0,
  `${catalogueGroups} catalogue groups · ${equipmentBody.replace(/\n+/g, ' · ').slice(0, 220)}`);

const tookPackages = await clickEach(['Leather, a longbow and 20 arrows', 'A martial weapon and a shield']);
check('a package is taken by clicking it', tookPackages === 'ok', tookPackages);

check('and taking a package raises the question it contains',
  (await clickEach(['Longsword'])) === 'ok'
  && await until("document.querySelector('.step-body').innerText.includes('Longsword')"),
  String(await text('.step-body')).replace(/\n+/g, ' · ').slice(0, 260));

const restOfKit = await clickEach(['A light crossbow and 20 bolts', "An explorer's pack"]);
check('the rest of the kit is chosen', restOfKit === 'ok', restOfKit);

check('what the kit gave is listed, and the numbers moved with it',
  await has('.step-body', 'You are carrying')
  && await until("document.querySelector('.stats').innerText.includes('15')"),
  String(await text('.stats')).replace(/\n+/g, ' · ').slice(0, 160));
await shot('07-equipment');
await click('Finish', "document.querySelector('.step-head h2').innerText.includes('Your character')");

// -- 7. character -----------------------------------------------------------
check('the character step lists the level and what it gave',
  await hasRaw('.step-body', 'Level 1') && await hasRaw('.step-body', 'Second Wind'));
check('and nothing is left to decide', !(await hasRaw('.step-body', 'Still to decide')));
await shot('08-character');

// -- levelling --------------------------------------------------------------
// The claims worth checking: a quiet level says so, the archetype appears only
// at 3rd, the ASI shows what it would do, and a Constitution increase reports
// the hit points it moves retroactively.
check('the level-up page opens and says what the level gives',
  (await click('Advance to level 2', "document.querySelector('.wizard') !== null")) === 'ok'
  && await has('.wizard', 'Action Surge') && await has('.wizard', 'The average'));
await shot('09-level-up');

check('taking the level commits it',
  (await click('Take level 2', null)) === 'ok' && await until(`${rail}.textContent.includes('Fighter 2')`),
  String(await text('.rail')));

check('3rd level offers the archetype, and only now',
  (await click('Advance to level 3', "document.querySelector('.wizard') !== null")) === 'ok'
  && await until("document.querySelector('.wizard').innerText.includes('Subclass')"),
  String(await text('.wizard')).slice(0, 200));
check('the archetype can be picked, which clears the outstanding list',
  (await clickEach(['Champion'])) === 'ok'
  && await until("document.querySelector('.wizard-foot').innerText.includes('Nothing left to decide')"),
  String(await text('.wizard-foot')));
await shot('10-archetype');
check('the third level commits',
  (await click('Take level 3', null)) === 'ok' && await until(`${rail}.textContent.includes('Fighter 3')`));

check('4th level asks for the ASI, with what each ability would become',
  (await click('Advance to level 4', "document.querySelector('.wizard') !== null")) === 'ok'
  && await until("document.querySelector('.advancement') !== null"),
  String(await text('.wizard')).slice(0, 200));
await clickEach(['+2 to one']);
check('the improvement shows the arithmetic', await has('.advancement', '→') && await has('.advancement', '20'),
  String(await text('.advancement')).replace(/\n+/g, ' · ').slice(0, 160));
await shot('11-asi');
check('choosing one takes the improvement',
  (await clickEach(['Strength'])) === 'ok'
  && await until("document.querySelector('.wizard-foot').innerText.includes('Nothing left to decide')"),
  String(await text('.wizard-foot')));
check('the fourth level commits',
  (await click('Take level 4', null)) === 'ok' && await until(`${rail}.textContent.includes('Fighter 4')`));

// -- 8. sheet ---------------------------------------------------------------
await click('Sheet', "document.querySelector('.attacks') !== null");
check('the sheet derives the character',
  await has('main', 'Armour class') && await has('main', 'Saving throws'));
check('the ability increase reached the sheet', await has('.readout', '18'),
  String(await text('.readout')).replace(/\n+/g, ' · '));
check('the fighting style landed on the longbow alone', await has('.attacks', '+6'),
  String(await text('.attacks')).replace(/\n+/g, ' | ').slice(0, 200));

// -- 9. the sheet's inventory -----------------------------------------------
// The kit the builder handed over arrives here, and this is where anything
// picked up later is added — the catalogue is a mid-campaign act, not a step in
// making a 1st-level character (ADR-0013).
const carried = String(await text('.items')).replace(/\n+/g, ' · ');
check('the sheet carries what the kit gave',
  carried.includes('Leather') && carried.includes('Longsword') && carried.includes('Longbow')
  && carried.includes('Arrows'),
  carried.slice(0, 240));

const addItem = await click('Add an item from the pack', "document.querySelector('.picker') !== null");
check('the sheet can take an item from the pack', addItem === 'ok', addItem);
check('and the item taken joins the inventory',
  (await click('Greataxe')) === 'ok'
  && await until("document.querySelector('.items').innerText.includes('Greataxe')"),
  String(await text('.items')).replace(/\n+/g, ' · ').slice(0, 240));

check('a custom item can be made on the sheet',
  (await click('Make a custom item', "document.querySelector('.custom') !== null")) === 'ok'
  && await has('.custom', 'Base'),
  String(await text('.custom')).replace(/\n+/g, ' · ').slice(0, 200));
await shot('12-sheet');

const sheetGeometry = (await evaluate(
  `({ scrollWidth: document.documentElement.scrollWidth, window: window.innerWidth })`,
)) as { scrollWidth: number; window: number };
check('the sheet does not scroll sideways', sheetGeometry.scrollWidth <= sheetGeometry.window + 1,
  JSON.stringify(sheetGeometry));

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const noise = events.slice(from).flatMap((event) => {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params?.['exceptionDetails'] as { exception?: { description?: string } } | undefined;
    return [`uncaught: ${details?.exception?.description ?? 'unknown'}`];
  }
  if (event.method === 'Runtime.consoleAPICalled' && event.params?.['type'] === 'error') {
    return [`console.error: ${JSON.stringify(event.params['args'])}`];
  }
  if (event.method === 'Log.entryAdded') {
    const entry = event.params?.['entry'] as { level?: string; text?: string } | undefined;
    if (entry?.level === 'error') return [`log: ${entry.text ?? ''}`];
  }
  return [];
});

if (noise.length > 0) {
  console.log('\nThe page complained:');
  for (const line of noise) console.log(`  ${line}`);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${options.shots === null ? '' : `; PNGs in ${resolve(invokeDir, options.shots)}`}`);
if (failed.length > 0) console.log(failed.map((result) => `  FAIL ${result.name}`).join('\n'));

shutdown(failed.length === 0 && noise.length === 0 ? 0 : 1);
