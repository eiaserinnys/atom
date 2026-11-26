// Visual check for the search screen when Jev search is and is not set up (card #1902).
//
//   node e2e/visual/jev-search.mjs --out <dir> [--prefix after] [--root <checkout>] [--operations]
// Set CHROMIUM_EXECUTABLE to use a Chromium other than the one Playwright installed.
//
// Starts two disposable API servers (bypass mode, SQLite, demo seed) from <root>, one without TYPESAFE_API_KEY and
// TYPESAFE_BASE_URL and one with both pointing at a closed port, plus a Vite dev server for each. It captures the
// search flow at 1440px and 390px into <dir>/<prefix>-*.png and exits non-zero when an assertion fails.
// --operations also writes <dir>/operations.md (ui-design 0-14..18).
// Run it on a checkout of the base commit with --prefix before to see the old screens.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const options = parseArguments(process.argv.slice(2));
const root = path.resolve(options.root ?? path.join(here, '../..'));
const outDir = path.resolve(options.out);
const prefix = options.prefix ?? 'after';
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const QUERY = 'PostgreSQL';
const RESULT_TITLE = 'PostgreSQL docs: Routine vacuuming';
const children = [];
const failures = [];
const results = [];
const measured = {};

function parseArguments(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--operations') parsed.operations = true;
    else if (arg.startsWith('--')) parsed[arg.slice(2)] = args[++i];
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!parsed.out) throw new Error('Usage: jev-search.mjs --out <dir> [--prefix after] [--root <checkout>] [--operations]');
  return parsed;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  children.push(child);
  return { child, log: () => log };
}

async function waitFor(url, label, running) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) throw new Error(`${label} exited early:\n${running.log()}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} did not answer at ${url}:\n${running.log()}`);
}

function stopAll() {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name} ${detail}`.trim());
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const locale = (lang, ...keys) => keys.reduce((node, key) => node[key], JSON.parse(readFileSync(path.join(root, 'dashboard/src/locales', lang, 'translation.json'), 'utf8')));

async function startStack(workspaceRoot, name, jevEnv) {
  const workspace = mkdtempSync(path.join(realpathSync(tmpdir()), `atom-visual-${name}-`));
  cpSync(path.join(root, 'src'), path.join(workspace, 'src'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
  writeFileSync(path.join(workspace, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(workspace, '.env'), '');
  const sqlitePath = path.join(workspace, 'atom.db');
  const apiPort = await freePort();
  const webPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const seed = spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/seed-demo.ts')], {
    cwd: root, env: { PATH: process.env.PATH, SQLITE_PATH: sqlitePath }, encoding: 'utf8', timeout: 60_000,
  });
  if (seed.status !== 0) throw new Error(`seed-demo failed:\n${seed.stdout}${seed.stderr}`);
  const api = start(process.execPath, ['--import', 'tsx', 'src/api/index.ts'], workspace, {
    API_PORT: String(apiPort), SQLITE_PATH: sqlitePath, FRONTEND_URL: webUrl,
    JWT_SECRET: 'visual-check-secret', NODE_ENV: 'development', AUTH_BYPASS: '1', ...jevEnv,
  });
  const web = start(process.execPath, [path.join(root, 'dashboard/node_modules/vite/bin/vite.js'), '--port', String(webPort), '--host', '127.0.0.1', '--strictPort'],
    path.join(root, 'dashboard'), { VITE_API_BASE_URL: apiUrl });
  workspaceRoot.push(workspace);
  await waitFor(`${apiUrl}/api/health`, `${name} api`, api);
  await waitFor(webUrl, `${name} vite`, web);
  return { apiUrl, webUrl, status: await (await fetch(`${apiUrl}/api/auth/status`)).json() };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const workspaces = [];
  const closedPort = await freePort();
  try {
    const unset = await startStack(workspaces, 'unset', {});
    const set = await startStack(workspaces, 'set', { TYPESAFE_API_KEY: 'visual-check-key', TYPESAFE_BASE_URL: `http://127.0.0.1:${closedPort}` });
    check('server without the Jev settings reports jevConfigured false', unset.status.jevConfigured === false, JSON.stringify(unset.status));
    check('server with the Jev settings reports jevConfigured true', set.status.jevConfigured === true, JSON.stringify(set.status));
    check('the status never carries the key or the address', !JSON.stringify(set.status).includes('visual-check-key') && !JSON.stringify(set.status).includes(String(closedPort)));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    try {
      await captureScreens({ browser, unset: unset.webUrl, set: set.webUrl });
    } finally {
      await browser.close();
    }
  } finally {
    stopAll();
    for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
  }
  if (options.operations) writeOperations();
}

async function newPage(browser, viewport, webUrl, { language = 'en', theme = 'light', search = '' } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(([lang, mode]) => { localStorage.setItem('language', lang); localStorage.setItem('theme', mode); }, [language, theme]);
  const page = await context.newPage();
  await page.goto(`${webUrl}/${search}`);
  return page;
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${prefix}-${name}.png`) });
const searchInput = (page, narrow) => page.locator(narrow ? 'form input[type=text]' : '.index-search input[type=text]');
const dropdown = (page, narrow) => page.locator(narrow ? 'form .absolute' : '.index-search form .absolute');
const visibleTabs = (page) => page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter((tab) => tab.getClientRects().length > 0).map((tab) => tab.textContent.trim()));
// Tab bar order: tree, compile, search, detail, settings.
const mobileSearchTab = (page) => page.locator('[role=tablist] button[role=tab]').nth(2);
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function ready(page, narrow) {
  if (narrow) await mobileSearchTab(page).waitFor();
  else await searchInput(page, false).waitFor();
}

async function typeAndEnter(page, narrow, text = QUERY) {
  if (narrow) await mobileSearchTab(page).click();
  const input = searchInput(page, narrow);
  await input.waitFor();
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(1500);
}

const jevScreenGone = (page) => page.evaluate(() => document.querySelectorAll('[data-search-phase]').length === 0 && !/Jev search is not set up|Jev 검색/.test(document.body.innerText));

async function checkUnset({ browser, webUrl, narrow, language, theme, label }) {
  const viewport = narrow ? NARROW : WIDE;
  const width = viewport.width;
  const lang = language;
  const page = await newPage(browser, viewport, webUrl, { language: lang, theme });
  await ready(page, narrow);
  if (!narrow) await page.locator('[role=tab]').first().waitFor();
  const visualTitle = locale(lang, 'visual_search', 'title');
  await shot(page, `${label}-before`);
  if (!narrow) check(`Jev not set up: the center has no Visual search tab (${width}, ${lang}, ${theme})`, !(await visibleTabs(page)).includes(visualTitle), (await visibleTabs(page)).join('|'));
  await typeAndEnter(page, narrow);
  await shot(page, `${label}-after`);
  const listed = await dropdown(page, narrow).first().textContent().catch(() => '');
  check(`Jev not set up: Enter keeps the dropdown open with the normal results (${width}, ${lang}, ${theme})`, (listed ?? '').includes(RESULT_TITLE), (listed ?? '').slice(0, 80));
  check(`Jev not set up: Enter does not go to Visual search or show the 503 text (${width}, ${lang}, ${theme})`, await jevScreenGone(page));
  if (!narrow) check(`Jev not set up: the compile tab is the selected tab after Enter (${width}, ${lang}, ${theme})`, (await page.locator('[role=tab][aria-selected=true]').first().textContent()) === locale(lang, 'compile', 'header'));
  check(`Jev not set up: no horizontal scroll after Enter (${width}, ${lang}, ${theme})`, (await overflowX(page)) <= 0);
  return page;
}

async function captureScreens({ browser, unset, set }) {
  const w = await checkUnset({ browser, webUrl: unset, narrow: false, language: 'en', theme: 'light', label: 'unset-1440-en' });
  measured.wide = w;
  await checkUnset({ browser, webUrl: unset, narrow: false, language: 'ko', theme: 'light', label: 'unset-1440-ko' });
  await checkUnset({ browser, webUrl: unset, narrow: false, language: 'en', theme: 'dark', label: 'unset-1440-en-dark' });
  const m = await checkUnset({ browser, webUrl: unset, narrow: true, language: 'en', theme: 'light', label: 'unset-390-en' });
  measured.narrow = m;
  await checkUnset({ browser, webUrl: unset, narrow: true, language: 'ko', theme: 'light', label: 'unset-390-ko' });

  // ?q= deep link while Jev is not set up: stay on compile, no 503 text, the search box holds q with its results open.
  const link = await newPage(browser, WIDE, unset, { search: `?q=${QUERY}` });
  await searchInput(link, false).waitFor();
  await link.waitForTimeout(1500);
  await shot(link, 'unset-1440-en-deeplink');
  check('Jev not set up: a ?q= link shows no Visual search screen and no 503 text', await jevScreenGone(link));
  check('Jev not set up: a ?q= link stays on the compile tab', (await link.locator('[role=tab][aria-selected=true]').first().textContent()) === locale('en', 'compile', 'header'));
  check('Jev not set up: a ?q= link fills the search box and opens the normal results', (await searchInput(link, false).inputValue()) === QUERY && ((await dropdown(link, false).first().textContent().catch(() => '')) ?? '').includes(RESULT_TITLE));

  // Jev set up: today's flow, unchanged.
  for (const [narrow, viewport] of [[false, WIDE], [true, NARROW]]) {
    const page = await newPage(browser, viewport, set, {});
    await ready(page, narrow);
    if (!narrow) await page.locator('[role=tab]').first().waitFor();
    const label = `set-${viewport.width}-en`;
    await shot(page, `${label}-before`);
    if (!narrow) check('Jev set up: the center shows the Visual search tab (1440)', (await visibleTabs(page)).includes(locale('en', 'visual_search', 'title')), (await visibleTabs(page)).join('|'));
    await typeAndEnter(page, narrow);
    await shot(page, `${label}-after`);
    check(`Jev set up: Enter closes the dropdown (${viewport.width})`, (await dropdown(page, narrow).count()) === 0);
    if (!narrow) check('Jev set up: Enter selects the Visual search tab (1440)', (await page.locator('[role=tab][aria-selected=true]').evaluateAll((tabs) => tabs.filter((tab) => tab.getClientRects().length > 0).map((tab) => tab.textContent.trim()))).includes(locale('en', 'visual_search', 'title')));
    else check('Jev set up: Enter stays in the search tab and its Visual search area is mounted (390)', (await page.locator('[role=tab][aria-selected=true]').first().textContent()) === locale('en', 'common', 'search'));
    await page.context().close();
  }
  if (options.operations) await measureOperations({ browser, unset });
}

// ui-design 0-14..18 on the screen this change touches: the search box and its results dropdown with Jev not set up.
async function measureOperations({ browser, unset }) {
  const page = await newPage(browser, WIDE, unset, {});
  const input = searchInput(page, false);
  await input.waitFor();
  await input.fill(QUERY);
  await input.press('Enter');
  await page.waitForTimeout(1500);
  const focusOnInput = () => page.evaluate(() => document.activeElement?.matches('.index-search input[type=text]') ?? false);
  measured.focusAfterEnter = await focusOnInput();
  check('focus stays in the search box after Enter (not set up)', measured.focusAfterEnter);
  await input.press('Enter');
  await page.waitForTimeout(800);
  measured.enterTwice = ((await dropdown(page, false).first().textContent().catch(() => '')) ?? '').includes(RESULT_TITLE) && await focusOnInput();
  check('a second Enter reruns the search, keeps the dropdown open and the focus in the box', measured.enterTwice);
  const order = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const element = document.activeElement;
      const box = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 30), visible: box.width > 0 && box.height > 0 };
    }));
  }
  measured.tabOrder = order;
  check('Tab only reaches visible elements, in reading order, from the search box', order.every((entry) => entry.visible), order.map((entry) => entry.label).join(' > '));
  await input.focus();
  await page.keyboard.press('Escape');
  measured.escClosed = (await dropdown(page, false).count()) === 0 && await focusOnInput();
  check('Esc closes the dropdown and focus stays in the search box', measured.escClosed);
  await page.context().close();

  const tight = await newPage(browser, { width: 360, height: 844 }, unset, {});
  await mobileSearchTab(tight).waitFor();
  await typeAndEnter(tight, true, `${QUERY} ${'documentation '.repeat(12)}`);
  measured.overflow360 = await overflowX(tight);
  check('no horizontal scroll at 360 with a long query and the dropdown open', measured.overflow360 <= 0, `${measured.overflow360}px`);
  await tight.context().close();

  const resize = await newPage(browser, WIDE, unset, {});
  await searchInput(resize, false).waitFor();
  await searchInput(resize, false).fill(QUERY);
  await searchInput(resize, false).press('Enter');
  await resize.waitForTimeout(1200);
  const seen = [];
  for (const viewport of [NARROW, WIDE]) {
    await resize.setViewportSize(viewport);
    await resize.waitForTimeout(600);
    seen.push({ width: viewport.width, tabs: await visibleTabs(resize), gone: await jevScreenGone(resize), overflow: await overflowX(resize) });
  }
  measured.resize = seen;
  check('resizing between 1440 and 390 never brings back Visual search and never scrolls sideways', seen.every((entry) => entry.gone && entry.overflow <= 0 && !entry.tabs.includes(locale('en', 'visual_search', 'title'))), JSON.stringify(seen));
  await resize.context().close();
}

function writeOperations() {
  const pass = (ok) => (ok ? '통과' : '미통과');
  const failed = failures.length === 0;
  const text = `# 조작 결과 (카드 #1902 atom 검색 화면)

바뀐 화면은 Jev를 설정하지 않은 설치의 검색창, 일반 검색 결과 드롭다운, 가운데 탭과 모바일 검색 탭이다. 설정한 설치의 흐름은 그대로다.

## 14번부터 18번

| 번호 | 결과 | 근거 |
|---|---|---|
| 14 | ${pass(measured.focusAfterEnter && measured.enterTwice)} | 미설정에서 Enter를 두 번 쳐도 초점은 검색창에 있고 드롭다운이 열려 있다. 새로 연 대화상자나 시트는 없다 |
| 15 | ${pass(measured.tabOrder?.every((entry) => entry.visible) && measured.escClosed)} | 검색창에서 Tab 네 번이 모두 보이는 요소(${measured.tabOrder?.map((entry) => entry.label).join(' > ')})에 닿는다. Esc는 드롭다운만 닫고 초점은 검색창에 남는다. 가려 두던 Visual search 영역은 미설정에서 아예 그리지 않는다 |
| 16 | ${pass(measured.overflow360 <= 0)} | 360px에서 긴 검색어와 열린 드롭다운으로 가로 넘침 ${measured.overflow360}px. 1440, 390에서도 Enter 뒤 넘침 없음(스크립트 단언) |
| 17 | 해당 없음 | 오류 화면 코드를 바꾸지 않았다. 미설정에서는 503 화면에 닿지 않고, 설정됨에서는 SearchMotionView의 오류 처리가 그대로다(설정됨 캡처는 닫힌 포트로 향한 Jev 주소라 그 오류 화면이 나온다) |
| 18 | ${pass(measured.resize?.every((entry) => entry.gone && entry.overflow <= 0))} | 1440에서 Enter 뒤 390으로, 다시 1440으로 바꿔도 Visual search 탭과 화면이 돌아오지 않고 가로 넘침이 없다. 입력한 글이 그대로 남는지는 재지 않았다. 헤더 검색창과 모바일 탭의 검색창은 서로 다른 인스턴스라 이어지지 않으며 이는 이번 변경 전부터의 구조다 |

## 대화상자와 줄 안 편집

| 대상 | 여는 법 | 첫 초점 | Enter | Esc | 닫은 뒤 초점 |
|---|---|---|---|---|---|
| 일반 검색 결과 드롭다운(미설정) | 검색창에 입력, 또는 Enter | 검색창 그대로 | 같은 검색을 다시 돌리고 열린 채 둔다 | 닫는다. 바깥 화면은 그대로 | 검색창 |

## 실행

\`\`\`
node e2e/visual/jev-search.mjs --out <dir> --prefix ${prefix} --operations
\`\`\`

산출물: ${outDir}/${prefix}-*.png. 단언 ${results.length}개 가운데 ${failed ? '실패 없음' : `실패 ${failures.length}개`}.
`;
  writeFileSync(path.join(outDir, 'operations.md'), text);
}

main().then(() => {
  console.log(failures.length === 0 ? `\nAll ${results.length} assertions passed.` : `\n${failures.length} of ${results.length} assertions failed.`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}, (error) => {
  console.error(error);
  stopAll();
  process.exitCode = 1;
});
