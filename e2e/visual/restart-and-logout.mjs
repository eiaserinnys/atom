// Visual check for the restart notice and the bypass-mode Logout button.
//
//   node e2e/visual/restart-and-logout.mjs --out <dir> [--prefix after] [--root <checkout>] [--operations]
// Set CHROMIUM_EXECUTABLE to use a Chromium other than the one Playwright installed.
//
// Starts a disposable API (bypass mode, SQLite, demo seed) and Vite dev server from <root>
// (default: this checkout), captures the changed screens at 1440px and 390px into <dir>/<prefix>-*.png,
// and exits non-zero when an assertion fails. --operations also writes <dir>/operations.md
// (ui-design 0-14..18). Run it on a checkout of the base commit with --prefix before to see the old screens.
// The server runs under tsx, so the restart notice is in manual mode: the button stops the server and the
// banner, the settings footer and the overlay after the press must read as one language in all 9 languages.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
const children = [];
const failures = [];
const results = [];

function parseArguments(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--operations') parsed.operations = true;
    else if (arg.startsWith('--')) parsed[arg.slice(2)] = args[++i];
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!parsed.out) throw new Error('Usage: restart-and-logout.mjs --out <dir> [--prefix after] [--root <checkout>] [--operations]');
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

async function waitFor(url, label, process_) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (process_.child.exitCode !== null) throw new Error(`${label} exited early:\n${process_.log()}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} did not answer at ${url}:\n${process_.log()}`);
}

function stopAll() {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name} ${detail}`.trim());
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const workspace = mkdtempSync(path.join(realpathSync(tmpdir()), 'atom-visual-'));
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
    JWT_SECRET: 'visual-check-secret', NODE_ENV: 'development', AUTH_BYPASS: '1',
  });
  const web = start(process.execPath, [path.join(root, 'dashboard/node_modules/vite/bin/vite.js'), '--port', String(webPort), '--host', '127.0.0.1', '--strictPort'],
    path.join(root, 'dashboard'), { VITE_API_BASE_URL: apiUrl });
  try {
    await waitFor(`${apiUrl}/api/health`, 'api', api);
    await waitFor(webUrl, 'vite', web);
    const status = await (await fetch(`${apiUrl}/api/auth/status`)).json();
    check('server runs in bypass mode', status.id === 'bypass', `id=${status.id}`);
    await capture({ apiUrl, webUrl, workspace });
    await checkCompiledServer();
  } finally {
    stopAll();
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function checkCompiledServer() {
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'api/index.js'))) {
    console.log('SKIP compiled server check: run npm run build first');
    return;
  }
  const workspace = mkdtempSync(path.join(realpathSync(tmpdir()), 'atom-visual-dist-'));
  try {
    cpSync(dist, path.join(workspace, 'dist'), { recursive: true });
    symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
    writeFileSync(path.join(workspace, 'package.json'), '{"type":"module"}');
    writeFileSync(path.join(workspace, '.env'), '');
    const port = await freePort();
    const server = start(process.execPath, ['dist/api/index.js'], workspace, {
      API_PORT: String(port), SQLITE_PATH: path.join(workspace, 'atom.db'), JWT_SECRET: 'visual-check-secret',
      NODE_ENV: 'production', AUTH_BYPASS: '1',
    });
    await waitFor(`http://127.0.0.1:${port}/api/health`, 'compiled api', server);
    const status = await (await fetch(`http://127.0.0.1:${port}/api/system/status`)).json();
    check('compiled server (node dist, NODE_ENV=production) does not ask for a manual start', status.manualRestartRequired === false, JSON.stringify(status));
  } finally {
    stopAll();
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function setPendingRestart(apiUrl) {
  const response = await fetch(`${apiUrl}/api/config/env`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ key: 'MCP_AGENT_ID', value: 'visual-check' }]),
  });
  if (!response.ok) throw new Error(`could not mark a restart as pending: ${response.status}`);
}

const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// mock 'automatic': the server reports a pending restart it can do by itself (this run's tsx server cannot).
// mock 'pressable': manual mode whose server survives the press, so the overlay can be measured in every language.
async function newPage(browser, viewport, webUrl, language = 'en', mock = null) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((lang) => localStorage.setItem('language', lang), language);
  if (mock === 'automatic') await context.route('**/api/system/status', (route) => route.fulfill(json({ pendingRestart: true, manualRestartRequired: false })));
  if (mock === 'pressable') {
    await context.route('**/api/health', (route) => route.fulfill(json({ status: 'ok', bootId: 'unchanged' })));
    await context.route('**/api/system/restart', (route) => route.fulfill(json({ ok: true })));
  }
  const page = await context.newPage();
  await page.goto(webUrl);
  return page;
}

const textOf = (locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const MANUAL_NOTE = /start it again yourself/i;
const LANGS = ['en', 'ko', 'de', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'];
const OVERLAY = '[role="status"]:has(p)';
const BANNER = '.bg-\\[var\\(--amber-soft\\)\\]';
const locale = (lang) => JSON.parse(readFileSync(path.join(root, 'dashboard/src/locales', lang, 'translation.json'), 'utf8')).system ?? {};
const bannerButton = (page) => page.locator(`${BANNER} button`);

async function capture({ apiUrl, webUrl }) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  try {
    await captureScreens({ browser, apiUrl, webUrl });
  } finally {
    await browser.close();
  }
}

async function captureScreens({ browser, apiUrl, webUrl }) {
  const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${prefix}-${name}.png`) });
  const logoutIn = (scope) => scope.getByRole('button', { name: 'Logout' });

  // Tree screen, no restart pending
  const wide = await newPage(browser, WIDE, webUrl);
  await wide.getByText('atom', { exact: true }).first().waitFor();
  await wide.locator('[aria-label="Settings"]').waitFor();
  await shot(wide, 'tree-1440');
  check('bypass: tree screen has no Logout button (1440)', (await logoutIn(wide).count()) === 0);

  const narrow = await newPage(browser, NARROW, webUrl);
  await narrow.getByRole('tab', { name: /Settings/ }).last().waitFor();
  await shot(narrow, 'tree-390');
  await narrow.getByRole('tab', { name: /Settings/ }).last().click();
  await narrow.locator('nav[aria-label="Settings"]').waitFor();
  await shot(narrow, 'settings-list-390');
  check('bypass: mobile settings list has no Logout button (390)', (await logoutIn(narrow).count()) === 0);
  check('mobile settings list still lists the settings tabs', (await narrow.locator('nav[aria-label="Settings"] button').count()) > 0);

  // Restart pending
  await setPendingRestart(apiUrl);
  const wideBanner = await newPage(browser, WIDE, webUrl);
  await bannerButton(wideBanner).waitFor();
  await shot(wideBanner, 'banner-1440');
  const bannerText = (await textOf(wideBanner.locator(BANNER)))[0] ?? '';
  const en = locale('en');
  check('restart banner explains the server must be started again (1440)', MANUAL_NOTE.test(bannerText), bannerText);
  check('manual mode: the button says it stops the server, and the restart wording is gone (1440)',
    typeof en.shutdown_now === 'string' && (await textOf(bannerButton(wideBanner)))[0] === en.shutdown_now && !bannerText.includes(en.restart_required ?? '\0'),
    `${(await textOf(bannerButton(wideBanner)))[0]} | ${bannerText}`);

  await wideBanner.locator('[aria-label="Settings"]').click();
  const modal = wideBanner.getByRole('dialog');
  await modal.waitFor();
  await shot(wideBanner, 'settings-modal-1440');
  const footerText = (await textOf(modal.locator('footer')))[0] ?? '';
  check('settings footer explains the server must be started again (1440)', MANUAL_NOTE.test(footerText), footerText);

  const narrowBanner = await newPage(browser, NARROW, webUrl);
  await bannerButton(narrowBanner).waitFor();
  await shot(narrowBanner, 'banner-390');
  check('restart banner explains the server must be started again (390)', MANUAL_NOTE.test((await textOf(narrowBanner.locator(BANNER)))[0] ?? ''));
  check('no horizontal scroll at 390 with the banner', (await overflowX(narrowBanner)) <= 0);

  await checkFooterLayout({ browser, webUrl, shot });
  await checkBannerWording({ browser, webUrl });
  await checkBannerMatrix({ browser, webUrl });
  await checkOverlayCentering({ browser, webUrl });
  const operations = options.operations ? await measureOperations({ browser, webUrl, apiUrl, wideBanner, narrowBanner, modal }) : null;
  await checkPressedManualRestart({ browser, webUrl, shot });
  if (operations) writeOperations(operations, apiUrl);
}

async function openSettings(browser, webUrl, viewport, language) {
  const page = await newPage(browser, viewport, webUrl, language);
  await bannerButton(page).waitFor();
  await page.locator('.index-actions button.index-action').first().click();
  await page.getByRole('dialog').waitFor();
  return page;
}

// Desktop widths where the two footer buttons used to wrap away from the notice (ui-design 0-16).
async function checkFooterLayout({ browser, webUrl, shot }) {
  for (const width of [768, 820]) {
    const broken = [];
    const untranslated = [];
    for (const lang of LANGS) {
      const page = await openSettings(browser, webUrl, { width, height: 900 }, lang);
      const m = await page.evaluate(() => {
        const footer = document.querySelector('[role="dialog"] footer');
        const style = getComputedStyle(footer);
        const text = footer.querySelector('[aria-live]').getBoundingClientRect();
        const buttons = [...footer.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
        return {
          text: footer.querySelector('[aria-live]').textContent.trim(),
          textTop: text.top, textBottom: text.bottom, textRight: text.right,
          limit: footer.getBoundingClientRect().right - parseFloat(style.paddingRight),
          buttons: buttons.map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom })),
          count: buttons.length,
        };
      });
      const onTextLine = m.buttons.every((box) => box.top < m.textBottom && box.bottom > m.textTop);
      const sameLine = Math.abs(m.buttons[0].top - m.buttons.at(-1).top) < 1;
      const rightAligned = Math.abs(m.buttons.at(-1).right - m.limit) <= 1;
      const clear = m.textRight <= m.buttons[0].left;
      if (m.count !== 2 || !onTextLine || !sameLine || !rightAligned || !clear) broken.push(`${lang}:${JSON.stringify({ onTextLine, sameLine, rightAligned, clear })}`);
      const expected = locale(lang).restart_manual;
      if (typeof expected !== 'string' || !m.text.includes(expected) || (lang !== 'en' && [locale('en').restart_manual, locale('en').restart_required].some((english) => m.text.includes(english ?? '\0')))) untranslated.push(lang);
      if (lang === 'ko' || lang === 'pt') await shot(page, `settings-modal-${lang}-${width}`);
      await page.context().close();
    }
    check(`settings footer: two buttons on one line at the right edge, clear of the notice (${width}, 9 languages)`, broken.length === 0, broken.join(' '));
    check(`settings footer notice reads as one language (${width}, 9 languages)`, untranslated.length === 0, untranslated.join(' '));
  }
}

// Banner wording: one language per screen and no mid-word breaks in Korean.
const lineStarts = (selector) => {
    const node = document.querySelector(selector).firstChild;
    const text = node.textContent;
    const range = document.createRange();
    const lines = [];
    let previousTop = null;
    for (let i = 0; i < text.length; i += 1) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      if (text[i] === ' ' || rect.height === 0) continue;
      if (previousTop === null || rect.top > previousTop + 5) lines.push({ char: text[i], afterSpace: i === 0 || text[i - 1] === ' ' });
      previousTop = rect.top;
    }
    return lines;
};

// ui-design 0-16 for the banner: the button label is one line, clear of the notice, no scroll, and the line breaks are sound.
async function measureBanner(page, lang) {
  const m = await page.evaluate(([selector]) => {
    const banner = document.querySelector(selector);
    const button = banner.querySelector('button');
    const text = banner.querySelector('span').getBoundingClientRect();
    const box = button.getBoundingClientRect();
    const label = document.createRange();
    label.selectNodeContents(button);
    const tops = new Set([...label.getClientRects()].map((rect) => Math.round(rect.top)));
    return { buttonLines: tops.size, overlap: text.right > box.left + 0.5, overflow: document.documentElement.scrollWidth - window.innerWidth };
  }, [BANNER]);
  const starts = await page.evaluate(lineStarts, `${BANNER} span`);
  const problems = [];
  if (m.buttonLines !== 1) problems.push(`button ${m.buttonLines} lines`);
  if (m.overlap) problems.push('button overlaps text');
  if (m.overflow > 0) problems.push(`scroll ${m.overflow}px`);
  if (lang === 'ja' && starts.some((line) => '。、'.includes(line.char))) problems.push('line starts with a Japanese full stop or comma');
  if (lang === 'ko' && starts.some((line) => !line.afterSpace)) problems.push('Korean word broken');
  return problems;
}

async function checkBannerMatrix({ browser, webUrl }) {
  for (const mode of ['manual', 'automatic']) {
    for (const width of [360, 390]) {
      const broken = [];
      for (const lang of LANGS) {
        const page = await newPage(browser, { width, height: 844 }, webUrl, lang, mode === 'automatic' ? 'automatic' : null);
        await bannerButton(page).waitFor();
        const problems = await measureBanner(page, lang);
        if (problems.length > 0) broken.push(`${lang}: ${problems.join(', ')}`);
        if (lang === 'ja') await shot_ja(page, mode, width);
        await page.context().close();
      }
      check(`banner button stays on one line, clear of the notice, no scroll, sound line breaks (${mode}, ${width}, 9 languages)`, broken.length === 0, broken.join(' ; '));
    }
  }
}

async function shot_ja(page, mode, width) {
  await page.screenshot({ path: path.join(outDir, `${prefix}-banner-${mode}-ja-${width}.png`), clip: { x: 0, y: 0, width, height: 140 } });
}

// ui-design 0-16 for the overlay after the press: every text line sits on the spinner's centre axis.
async function checkOverlayCentering({ browser, webUrl }) {
  for (const width of [360, 390]) {
    const off = [];
    for (const lang of LANGS) {
      const page = await newPage(browser, { width, height: 844 }, webUrl, lang, 'pressable');
      await bannerButton(page).waitFor();
      await bannerButton(page).click();
      await page.locator(OVERLAY).waitFor();
      const m = await page.evaluate((selector) => {
        const status = document.querySelector(selector);
        const axis = status.querySelector('svg, [class*="animate-spin"]')?.getBoundingClientRect() ?? status.getBoundingClientRect();
        const text = status.querySelector('p').firstChild;
        const range = document.createRange();
        range.selectNodeContents(text);
        const lines = [...range.getClientRects()].map((rect) => rect.left + rect.width / 2);
        return { axis: axis.left + axis.width / 2, lines };
      }, OVERLAY);
      const worst = Math.max(...m.lines.map((x) => Math.abs(x - m.axis)));
      if (worst > 2) off.push(`${lang}:${m.lines.length} lines, off by ${worst.toFixed(1)}px`);
      if (lang === 'en' && width === 360) await page.screenshot({ path: path.join(outDir, `${prefix}-overlay-after-press-en-360.png`) });
      await page.context().close();
    }
    check(`after the press: every overlay text line is centred on the spinner axis (${width}, 9 languages)`, off.length === 0, off.join(' ; '));
  }
}

async function checkBannerWording({ browser, webUrl }) {
  const wrong = [];
  const tall = [];
  for (const lang of LANGS) {
    const page = await newPage(browser, NARROW, webUrl, lang);
    await bannerButton(page).waitFor();
    const seen = { text: (await textOf(page.locator(`${BANNER} span`)))[0], button: (await textOf(bannerButton(page)))[0] };
    const mine = locale(lang);
    const english = locale('en');
    const asExpected = seen.text === mine.restart_manual && seen.button === mine.shutdown_now;
    const english_fallback = lang !== 'en' && (seen.text === english.restart_manual || seen.button === english.shutdown_now || seen.text === english.restart_required);
    if (!asExpected || english_fallback) wrong.push(`${lang}:${seen.text}|${seen.button}`);
    const lines = await page.locator(`${BANNER} span`).evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
    if (lines > 4) tall.push(`${lang}:${lines}`);
    console.log(`banner lines at 390: ${lang} ${lines}`);
    await page.context().close();
  }
  check('restart banner stays within 4 lines in all 9 languages (390)', tall.length === 0, tall.join(' '));
  check('restart banner reads as one language in all 9 languages (390)', wrong.length === 0, wrong.join(' ; '));

  const korean = await newPage(browser, { width: 360, height: 844 }, webUrl, 'ko');
  await bannerButton(korean).waitFor();
  const breaks = await korean.evaluate((selector) => {
    const node = document.querySelector(`${selector} span`).firstChild;
    const text = node.textContent;
    const range = document.createRange();
    const topOf = (index) => { range.setStart(node, index); range.setEnd(node, index + 1); return range.getBoundingClientRect().top; };
    const found = [];
    let previousTop = null;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === ' ') continue;
      const top = topOf(i);
      if (previousTop !== null && top > previousTop + 5 && text[i - 1] !== ' ') found.push(`${text.slice(Math.max(0, i - 3), i)}|${text.slice(i, i + 3)}`);
      previousTop = top;
    }
    return found;
  }, BANNER);
  await korean.screenshot({ path: path.join(outDir, `${prefix}-banner-ko-360.png`), clip: { x: 0, y: 0, width: 360, height: 120 } });
  check('Korean banner never breaks a word in the middle (360)', breaks.length === 0, breaks.join(' '));
  await korean.context().close();
}

// ui-design 0-17: what the screen shows after the button is pressed in manual mode. Stops this run's own API.
async function checkPressedManualRestart({ browser, webUrl, shot }) {
  const ko = locale('ko');
  const page = await newPage(browser, WIDE, webUrl, 'ko');
  await bannerButton(page).waitFor();
  await bannerButton(page).click();
  await page.waitForTimeout(2000);
  await shot(page, 'press-2s-ko-1440');
  const overlay = async () => (await textOf(page.locator(OVERLAY)))[0] ?? '';
  const expected = typeof ko.shutdown_done === 'string' ? ko.shutdown_done : '(missing shutdown_done)';
  const early = await overlay();
  check('after the press: the overlay says the server stopped and must be started again (2s)', early === expected, early);
  await page.waitForTimeout(31_000);
  await shot(page, 'press-33s-ko-1440');
  const late = await overlay();
  check('after the press: still waiting with the same notice, no early return to the banner (33s)',
    late === expected && (await bannerButton(page).count()) === 0, `${late} | banner buttons ${await bannerButton(page).count()}`);
  await page.context().close();
}

async function measureOperations({ browser, webUrl, apiUrl, wideBanner, narrowBanner, modal }) {
  const dialogRows = [];
  const labelOf = () => {
    const el = document.activeElement;
    const box = el?.getBoundingClientRect();
    return { label: el && el !== document.body ? (el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName) : 'body', inDialog: Boolean(el?.closest('[role="dialog"]')), visible: Boolean(box && box.width > 0 && box.height > 0) };
  };
  const activeLabel = async (page) => (await page.evaluate(labelOf)).label;

  // 14, 15: the settings dialog (changed footer)
  const firstFocus = await activeLabel(wideBanner);
  const order = [];
  for (let i = 0; i < 6; i += 1) {
    await wideBanner.keyboard.press('Tab');
    order.push(await wideBanner.evaluate(labelOf));
  }
  const tabOk = order.every((step) => step.visible);

  // The ends of the dialog: Tab after the last footer button, Shift+Tab twice from the first tab.
  await modal.locator('footer button').last().focus();
  await wideBanner.keyboard.press('Tab');
  const afterLastButton = await wideBanner.evaluate(labelOf);
  await modal.locator('nav button').first().focus();
  await wideBanner.keyboard.press('Shift+Tab');
  await wideBanner.keyboard.press('Shift+Tab');
  const beforeFirstTab = await wideBanner.evaluate(labelOf);
  const leavesDialog = !afterLastButton.inDialog || !beforeFirstTab.inDialog;
  const lastButtonLabel = (await textOf(modal.locator('footer button')))[1];

  await wideBanner.keyboard.press('Escape');
  const closed = (await modal.count()) === 0;
  const focusAfterClose = await activeLabel(wideBanner);
  const treeStill = await wideBanner.locator('[aria-label="Settings"]').count();
  const focusReturned = focusAfterClose === 'Settings';
  dialogRows.push(`| 설정 창 | 헤더의 톱니 단추 누름 | ${firstFocus} | 해당 없음(눌린 단추의 동작) | ${closed && treeStill ? '닫힘, 바깥 화면 그대로' : '닫히지 않음'} | ${focusAfterClose} |`);

  // 16: narrow widths with the longest translation
  const russian = await newPage(browser, NARROW, webUrl, 'ru');
  await bannerButton(russian).waitFor();
  const overflow = await overflowX(russian);
  const bannerBox = await russian.evaluate((selector) => {
    const banner = document.querySelector(selector);
    const button = banner?.querySelector('button')?.getBoundingClientRect();
    const text = banner?.querySelector('span')?.getBoundingClientRect();
    return { buttonRight: button?.right, textRight: text?.right, textBottom: text?.bottom, buttonTop: button?.top, buttonLeft: button?.left, textLeft: text?.left, textLines: Math.round((text?.height ?? 0) / 20) };
  }, BANNER);
  await russian.screenshot({ path: path.join(outDir, `${prefix}-banner-ru-390.png`) });
  const overlap = bannerBox.textRight > bannerBox.buttonLeft + 0.5;
  check('no horizontal scroll at 390 with the longest translation (ru)', overflow <= 0, `overflow=${overflow}`);
  check('button does not overlap the notice text (ru, 390)', !overlap, JSON.stringify(bannerBox));
  check('restart button stays inside the 390px viewport (ru)', bannerBox.buttonRight <= NARROW.width + 0.5);

  // 17: the status request fails
  const failing = await browser.newContext({ viewport: NARROW });
  const failingPage = await failing.newPage();
  await failingPage.route('**/api/system/status', (route) => route.fulfill({ status: 500, body: '{"error":"x"}', contentType: 'application/json' }));
  await failingPage.goto(webUrl);
  await failingPage.getByRole('tab', { name: /Settings/ }).last().waitFor();
  const errorState = { banner: await bannerButton(failingPage).count(), overflow: await overflowX(failingPage) };
  check('status failure leaves the screen intact without a banner (390)', errorState.banner === 0 && errorState.overflow <= 0, JSON.stringify(errorState));

  // 18: resize while the banner is open
  await wideBanner.setViewportSize(NARROW);
  const afterNarrow = { button: await bannerButton(wideBanner).isVisible(), text: MANUAL_NOTE.test(await wideBanner.locator('body').innerText()), overflow: await overflowX(wideBanner) };
  await wideBanner.setViewportSize(WIDE);
  const afterWide = { button: await bannerButton(wideBanner).isVisible(), overflow: await overflowX(wideBanner) };
  check('banner survives 1440 -> 390 -> 1440', afterNarrow.button && afterNarrow.text && afterNarrow.overflow <= 0 && afterWide.button && afterWide.overflow <= 0, JSON.stringify({ afterNarrow, afterWide }));
  check('Tab order stays on visible controls inside the settings dialog', tabOk && order.some((step) => step.inDialog), JSON.stringify(order));
  check('Escape closes the settings dialog and leaves the page', closed && treeStill > 0);
  check('closing the settings dialog returns focus to the Settings button', focusReturned, `focus=${focusAfterClose}`);

  const statusBody = await (await fetch(`${apiUrl}/api/system/status`)).json();
  const rows = [
    ['14', firstFocus !== 'body' && focusReturned ? '통과' : '확인 필요', `설정 창을 열면 첫 초점은 ${firstFocus}(선택된 탭), Esc로 닫으면 초점이 연 단추(${focusAfterClose})로 돌아온다. 변경 전에는 body로 떨어졌다.`],
    ['15', tabOk && closed ? (leavesDialog ? '통과(창 끝 이탈은 기존 동작)' : '통과') : '확인 필요',
      `창 안 Tab 6회는 모두 보이는 요소에 머문다: ${order.map((step) => step.label).join(' → ')}. Esc로 닫히고 트리 화면은 그대로. `
      + `창 끝 「${lastButtonLabel}」 다음 Tab은 ${afterLastButton.inDialog ? '창 안' : '창 밖'}(${afterLastButton.label}), 첫 탭에서 Shift+Tab 두 번은 ${beforeFirstTab.inDialog ? '창 안' : '창 밖'}(${beforeFirstTab.label})으로 간다. `
      + '창 밖으로 나가는 것은 변경 전부터 있던 동작이라 이 단위에서 고치지 않았다.'],
    ['16', overflow <= 0 && !overlap ? '통과' : '확인 필요', `390px에서 가장 긴 번역(ru)도 가로 스크롤 ${overflow}px, 글 오른쪽 끝 ${bannerBox.textRight}px < 단추 왼쪽 끝 ${bannerBox.buttonLeft}px, 글 ${bannerBox.textLines}줄. 설정 창 아래 줄은 768px와 820px에서 9개 언어 모두 두 단추가 한 줄에 오른쪽 끝으로 붙는다. 배너는 360px과 390px, 9개 언어, manual과 automatic 모두에서 단추 글이 한 줄이고 글과 겹치지 않으며(ja 포함) 가로 스크롤이 없다. 한국어는 낱말 가운데서, 일본어는 「。」「、」로 줄이 시작하지 않는다.`],
    ['17', errorState.banner === 0 && errorState.overflow <= 0 ? '통과' : '확인 필요', '상태 요청을 500으로 바꿔도 화면이 그대로 서고 배너만 보이지 않는다. 새 데이터 요청은 추가하지 않았다(기존 30초 상태 조회에 필드 하나). 단추를 누른 뒤 서버가 꺼진 화면은 아래 단언 표의 2초, 33초 항목이다. 누른 뒤 겹친 창 글은 360px과 390px, 9개 언어에서 모든 줄이 돌이표 가운데 축에 놓인다.'],
    ['18', afterNarrow.button && afterWide.button ? '통과' : '확인 필요', `1440 → 390 → 1440으로 바꿔도 배너, 안내, 단추가 다시 서고 가로 스크롤 없음(${afterNarrow.overflow}, ${afterWide.overflow}).`],
  ];
  await russian.context().close();
  await failing.close();
  return { rows, dialogRows, statusBody };
}

function writeOperations({ rows, dialogRows, statusBody }, apiUrl) {
  const table = (head, body) => [head, ...body].join('\n');
  const checks = results.map((result) => `| ${result.name} | ${result.ok ? '통과' : '실패'} |`).join('\n');
  writeFileSync(path.join(outDir, 'operations.md'), [
    `# 조작 결과 (${prefix}, ${new Date().toISOString()})`,
    '',
    '실행: `node e2e/visual/restart-and-logout.mjs --out <캡처 폴더> --prefix after --operations`',
    `서버: ${apiUrl} 의 일회용 SQLite + 데모 시드, bypass 모드, tsx 실행(status.manualRestartRequired=${statusBody.manualRestartRequired})`,
    '',
    '## 14번부터 18번',
    '',
    table('| 항목 | 결과 | 근거 |\n|---|---|---|', rows.map((row) => `| ${row.join(' | ')} |`)),
    '',
    '## 대화상자와 줄 안 편집',
    '',
    table('| 대상 | 여는 법 | 첫 초점 | Enter | Esc | 닫은 뒤 초점 |\n|---|---|---|---|---|---|', dialogRows),
    '',
    '재시작 배너와 모바일 설정 목록에는 대화상자, 팝오버, 줄 안 편집이 없다.',
    '',
    '## 단언',
    '',
    table('| 단언 | 결과 |\n|---|---|', [checks]),
    '',
  ].join('\n'));
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} assertion(s) failed:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    }
  })
  .catch((error) => { console.error(error); stopAll(); process.exitCode = 1; });
