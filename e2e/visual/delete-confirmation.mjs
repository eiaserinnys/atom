// Visual check for the tree delete confirmation (what a delete removes, shown before it happens).
//
//   node e2e/visual/delete-confirmation.mjs --out <dir> [--prefix after] [--root <checkout>]
// Set CHROMIUM_EXECUTABLE to use a Chromium other than the one Playwright installed.
//
// Starts a disposable API (bypass mode, SQLite) and Vite dev server from <root> (default: this checkout),
// builds a small tree through the REST API, opens the delete confirmation for each case at 1440px and 360px
// in ko, en, de and ja, and writes <dir>/<prefix>-<case>-<lang>-<width>.png. The wording is read from this
// checkout's locale files, so running it with --root on the base commit fails the assertions (that is the
// before run). Keyboard and focus (ui-design 0-14..18) are checked by dialog-focus.mjs.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const options = parseArguments(process.argv.slice(2));
const root = path.resolve(options.root ?? repo);
const outDir = path.resolve(options.out);
const prefix = options.prefix ?? 'after';
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 360, height: 800 };
const LANGS = ['ko', 'en', 'de', 'ja'];
const LONG_TITLE = 'ABCDEFGHIJ'.repeat(5);
const children = [];
const failures = [];
const results = [];

function parseArguments(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) parsed[arg.slice(2)] = args[++i];
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!parsed.out) throw new Error('Usage: delete-confirmation.mjs --out <dir> [--prefix after] [--root <checkout>]');
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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const locale = (lang) => JSON.parse(readFileSync(path.join(repo, 'dashboard/src/locales', lang, 'translation.json'), 'utf8'));
const has = (text, expected) => typeof expected === 'string' && text.includes(expected);
const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);

async function main() {
  mkdirSync(outDir, { recursive: true });
  const workspace = mkdtempSync(path.join(realpathSync(tmpdir()), 'atom-visual-delete-'));
  cpSync(path.join(root, 'src'), path.join(workspace, 'src'), { recursive: true });
  symlinkSync(path.join(repo, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
  writeFileSync(path.join(workspace, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(workspace, '.env'), '');
  const apiPort = await freePort();
  const webPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  const api = start(process.execPath, ['--import', 'tsx', 'src/api/index.ts'], workspace, {
    API_PORT: String(apiPort), SQLITE_PATH: path.join(workspace, 'atom.db'), FRONTEND_URL: webUrl,
    JWT_SECRET: 'visual-check-secret', NODE_ENV: 'development', AUTH_BYPASS: '1',
  });
  const web = start(process.execPath, [path.join(root, 'dashboard/node_modules/vite/bin/vite.js'), '--port', String(webPort), '--host', '127.0.0.1', '--strictPort'],
    path.join(root, 'dashboard'), { VITE_API_BASE_URL: apiUrl });
  try {
    await waitFor(`${apiUrl}/api/health`, 'api', api);
    await waitFor(webUrl, 'vite', web);
    const data = await seedTree(apiUrl);
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    try {
      await captureScreens({ browser, apiUrl, webUrl, data });
    } finally {
      await browser.close();
    }
  } finally {
    stopAll();
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function post(apiUrl, route, body) {
  const response = await fetch(`${apiUrl}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`POST ${route} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

// Every delete target is a root node so the tree needs no expanding.
async function seedTree(apiUrl) {
  const card = (title, parent = null, cardType = 'knowledge') => post(apiUrl, '/cards', { title, card_type: cardType, parent_node_id: parent });
  const library = await card('Library', null, 'structure');
  const referenceOriginal = await card('Reference card', library.node_id);
  const referenceLink = await post(apiUrl, '/tree/symlink', { card_id: referenceOriginal.id, parent_node_id: null });

  const sprint = await card('Sprint plan', null, 'structure');
  const taskOne = await card('Task one', sprint.node_id);
  const taskTwo = await card('Task two', sprint.node_id);
  const taskThree = await card('Task three', sprint.node_id);
  await post(apiUrl, '/tree/symlink', { card_id: taskThree.id, parent_node_id: null });

  const lonely = await card(LONG_TITLE);
  const shared = await card('Shared note');
  await post(apiUrl, '/tree/symlink', { card_id: shared.id, parent_node_id: library.node_id });

  return {
    cardIds: [library, referenceOriginal, sprint, taskOne, taskTwo, taskThree, lonely, shared].map((created) => created.id),
    cases: [
      { key: 'symlink', name: 'Reference card', nodeId: referenceLink.id, expected: { target: 'symlink', cards: 0 } },
      { key: 'normal', name: 'Sprint plan', nodeId: sprint.node_id, expected: { target: 'node', cards: 3, ids: [sprint.id, taskOne.id, taskTwo.id] } },
      { key: 'leaf', name: LONG_TITLE, nodeId: lonely.node_id, expected: { target: 'node', cards: 1, ids: [lonely.id] } },
      { key: 'shared', name: 'Shared note', nodeId: shared.node_id, expected: { target: 'node', cards: 0 } },
    ],
  };
}

const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function newPage(browser, viewport, webUrl, language, theme = 'light') {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(([lang, mode]) => {
    localStorage.setItem('language', lang);
    localStorage.setItem('theme', mode);
  }, [language, theme]);
  const page = await context.newPage();
  await page.goto(webUrl);
  return page;
}

const MODAL = '.fixed.inset-0:has(h2)';
const AMBER = '.bg-\\[var\\(--amber-soft\\)\\]';
const modalText = (page) => page.locator(MODAL).innerText();
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const confirmButton = (page, lang) => page.locator(MODAL).getByRole('button', { name: new RegExp(`^${locale(lang).delete_modal.confirm_btn}$`) });
const cancelButton = (page, lang) => page.locator(MODAL).getByRole('button', { name: locale(lang).common.cancel, exact: true });

async function openDelete(page, lang, nodeId) {
  await page.locator(`[data-testid="tree-node-${nodeId}"]`).waitFor({ timeout: 15_000 });
  await page.locator(`[data-testid="tree-node-${nodeId}"] > div`).first().click({ button: 'right' });
  const label = locale(lang).tree.context_delete;
  await page.locator('[data-testid="context-menu-item"]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).click();
  await page.locator(MODAL).waitFor();
}

async function closeDelete(page, lang) {
  await cancelButton(page, lang).click();
  await page.locator(MODAL).waitFor({ state: 'detached' });
}

async function serverPreview(apiUrl, nodeId) {
  const response = await fetch(`${apiUrl}/tree/${nodeId}/delete-preview`);
  return response.ok ? response.json() : { error: response.status };
}

async function boxMetrics(page) {
  return page.evaluate((selector) => {
    const modal = document.querySelector(selector);
    const frame = modal?.firstElementChild;
    const box = frame?.getBoundingClientRect();
    const inside = [...(frame?.querySelectorAll('*') ?? [])];
    const overflowing = inside.filter((node) => node.getBoundingClientRect().right > (box?.right ?? 0) + 0.5).length;
    const clipped = inside.filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0).length;
    return { left: box?.left, right: box?.right, width: box?.width, overflowing, clipped, innerWidth: window.innerWidth };
  }, MODAL);
}

async function framePartTexts(page) {
  return page.evaluate((selector) => [...(document.querySelector(selector)?.firstElementChild?.children ?? [])].map((part) => part.textContent ?? ''), MODAL);
}

// Korean lines may only turn over at a space or punctuation. Letters of an unbroken Latin name are exempt
// (a name wider than the dialog has to fold somewhere).
async function koreanBreakViolations(page) {
  return page.evaluate((selector) => {
    const frame = document.querySelector(selector)?.firstElementChild;
    if (!frame) return ['no dialog'];
    const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
    const violations = [];
    let previous = null;
    let spaceSince = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (/\s/.test(char)) { spaceSince = true; continue; }
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        if (previous && rect.top > previous.top + 3 && rect.left < previous.right) {
          const afterPunctuation = /[.,!?;:)\]"'\u201d\u2019\u3002\u3001\u2026]/.test(previous.char);
          const insideLatinName = /[A-Za-z0-9]/.test(previous.char) && /[A-Za-z0-9]/.test(char);
          if (!spaceSince && !afterPunctuation && !insideLatinName) violations.push(`${previous.char}|${char}`);
        }
        previous = { char, top: rect.top, right: rect.right };
        spaceSince = false;
      }
      spaceSince = true;
    }
    return violations;
  }, MODAL);
}

async function checkKoreanBreaks(page, lang, label) {
  if (lang !== 'ko') return;
  const violations = await koreanBreakViolations(page);
  check(`ko dialog text turns over lines only at a space or punctuation, ${label}`, violations.length === 0, violations.join(' '));
}

// The dialog keeps its side margin (mx-4 = 16px) and no text runs past its own box.
const fitsViewport = (metrics) => metrics.left >= 15.5 && metrics.right <= metrics.innerWidth - 15.5 && metrics.overflowing === 0 && metrics.clipped === 0;

async function captureScreens({ browser, apiUrl, webUrl, data }) {
  const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${prefix}-${name}.png`) });
  const previews = {};
  for (const item of data.cases) {
    previews[item.key] = await serverPreview(apiUrl, item.nodeId);
    const preview = previews[item.key];
    const ids = [...(preview.deleted_card_ids ?? [])].sort();
    check(`server preview for ${item.key}: ${item.expected.target}, ${item.expected.cards} card(s)`,
      preview.target === item.expected.target && preview.deleted_card_count === item.expected.cards
        && (item.expected.ids === undefined || JSON.stringify(ids) === JSON.stringify([...item.expected.ids].sort())),
      JSON.stringify(preview));
  }

  for (const [viewport, width] of [[WIDE, 1440], [NARROW, 360]]) {
    for (const lang of LANGS) {
      const text = locale(lang).delete_modal;
      const page = await newPage(browser, viewport, webUrl, lang);
      const tag = `${lang} ${width}`;
      for (const item of data.cases) {
        await openDelete(page, lang, item.nodeId);
        await page.locator(MODAL).getByRole('button', { name: new RegExp(`^${text.confirm_btn}$`) }).waitFor();
        await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 }).catch(() => {});
        const body = await modalText(page);
        const amber = await page.locator(`${MODAL} ${AMBER}`).count();
        if (item.key === 'symlink') {
          check(`symlink dialog says only the link goes and has no permanent-deletion wording (${tag})`,
            has(body, text.title_link) && has(body, fill(text.body_link, { name: item.name })) && !has(body, text.cards_unknown)
              && !has(body, fill(text.cards_permanent, { total: '' }).slice(0, 8)) && amber === 0, body.replace(/\n/g, ' | '));
        } else if (item.key === 'normal') {
          const expected = fill(text.cards_permanent, { total: previews.normal.deleted_card_count });
          check(`node dialog shows the server preview count ${previews.normal.deleted_card_count} (${tag})`,
            has(body, text.title_node) && has(body, fill(text.body_node, { name: item.name })) && has(body, expected), body.replace(/\n/g, ' | '));
        } else if (item.key === 'leaf') {
          const expected = fill(text.cards_permanent, { total: previews.leaf.deleted_card_count });
          check(`leaf node without another place counts its own card (${tag})`, has(body, expected), body.replace(/\n/g, ' | '));
        } else {
          check(`node whose card sits elsewhere says nothing is deleted permanently (${tag})`,
            has(body, text.cards_none) && !has(body, text.cards_unknown) && amber === 0, body.replace(/\n/g, ' | '));
        }
        const metrics = await boxMetrics(page);
        check(`dialog stays inside the viewport without overflowing children, ${item.key} (${tag})`,
          fitsViewport(metrics) && (await overflowX(page)) <= 0, JSON.stringify(metrics));
        const parts = await framePartTexts(page);
        const sentence = fill(item.key === 'symlink' ? text.body_link : text.body_node, { name: item.name });
        check(`dialog is title, one sentence${item.key === 'symlink' ? '' : ', notice'}, buttons, and the name appears once, ${item.key} (${tag})`,
          parts.length === (item.key === 'symlink' ? 3 : 4) && parts[0] === (item.key === 'symlink' ? text.title_link : text.title_node)
            && parts[1] === sentence && parts.join('').split(item.name).length === 2, JSON.stringify(parts));
        await checkKoreanBreaks(page, lang, `${item.key} (${tag})`);
        await shot(page, `${item.key}-${lang}-${width}`);
        await closeDelete(page, lang);
      }

      const normal = data.cases.find((item) => item.key === 'normal');
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route('**/tree/*/delete-preview', async (route) => { await held; await route.continue(); });
      await openDelete(page, lang, normal.nodeId);
      await page.locator(MODAL).getByText(text.checking ?? '', { exact: false }).waitFor({ timeout: 3_000 }).catch(() => {});
      const loadingBody = await modalText(page);
      const locked = await confirmButton(page, lang).isDisabled();
      check(`while the preview is received the dialog says so and the confirm button is locked (${tag})`, has(loadingBody, text.checking) && locked, loadingBody.replace(/\n/g, ' | '));
      await checkKoreanBreaks(page, lang, `loading (${tag})`);
      await shot(page, `loading-${lang}-${width}`);
      release();
      await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
      check(`the confirm button opens once the preview arrives (${tag})`, !(await confirmButton(page, lang).isDisabled()));
      await closeDelete(page, lang);
      await page.unroute('**/tree/*/delete-preview');

      await page.route('**/tree/*/delete-preview', (route) => route.fulfill(json({ error: 'x' }, 500)));
      await openDelete(page, lang, normal.nodeId);
      await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
      const failedBody = await modalText(page);
      check(`a failed preview shows the general warning and keeps the confirm button open (${tag})`,
        has(failedBody, text.cards_unknown) && !(await confirmButton(page, lang).isDisabled()), failedBody.replace(/\n/g, ' | '));
      await checkKoreanBreaks(page, lang, `failed (${tag})`);
      await shot(page, `failed-${lang}-${width}`);
      await closeDelete(page, lang);
      await page.unroute('**/tree/*/delete-preview');
      await page.context().close();
    }
  }

  const dark = await newPage(browser, WIDE, webUrl, 'en', 'dark');
  await openDelete(dark, 'en', data.cases.find((item) => item.key === 'normal').nodeId);
  await dark.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  await shot(dark, 'normal-en-1440-dark');
  await dark.context().close();

  const darkKorean = await newPage(browser, WIDE, webUrl, 'ko', 'dark');
  const normalCase = data.cases.find((item) => item.key === 'normal');
  let releaseDark;
  const heldDark = new Promise((resolve) => { releaseDark = resolve; });
  await darkKorean.route('**/tree/*/delete-preview', async (route) => { await heldDark; await route.continue(); });
  await openDelete(darkKorean, 'ko', normalCase.nodeId);
  await darkKorean.locator(MODAL).getByText(locale('ko').delete_modal.checking, { exact: false }).waitFor({ timeout: 3_000 });
  await shot(darkKorean, 'loading-ko-1440-dark');
  releaseDark();
  await darkKorean.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  await closeDelete(darkKorean, 'ko');
  await darkKorean.unroute('**/tree/*/delete-preview');
  await darkKorean.route('**/tree/*/delete-preview', (route) => route.fulfill(json({ error: 'x' }, 500)));
  await openDelete(darkKorean, 'ko', normalCase.nodeId);
  await darkKorean.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  await shot(darkKorean, 'failed-ko-1440-dark');
  await darkKorean.context().close();

  await measureBehaviour({ browser, apiUrl, webUrl, data });
  await confirmDeleteRemovesPreviewedCards({ browser, apiUrl, webUrl, data, previews });
}

// A confirmed delete removes exactly the cards the preview announced, and nothing else.
async function confirmDeleteRemovesPreviewedCards({ browser, apiUrl, webUrl, data, previews }) {
  const alive = async () => {
    const states = await Promise.all(data.cardIds.map(async (id) => (await fetch(`${apiUrl}/cards/${id}`)).ok));
    return states.filter(Boolean).length;
  };
  const normal = data.cases.find((item) => item.key === 'normal');
  const before = await alive();
  const page = await newPage(browser, WIDE, webUrl, 'en');
  await openDelete(page, 'en', normal.nodeId);
  await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  await confirmButton(page, 'en').click();
  await page.locator(MODAL).waitFor({ state: 'detached' });
  await page.locator(`[data-testid="tree-node-${normal.nodeId}"]`).waitFor({ state: 'detached' });
  const after = await alive();
  check(`after confirming, ${previews.normal.deleted_card_count} cards are really gone (preview said so)`,
    before - after === previews.normal.deleted_card_count, `before=${before} after=${after}`);
  await page.context().close();
}

async function measureBehaviour({ browser, apiUrl, webUrl, data }) {
  const lang = 'en';
  const leaf = data.cases.find((item) => item.key === 'leaf');
  const shared = data.cases.find((item) => item.key === 'shared');
  const waitIdle = (page) => page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });

  const page = await newPage(browser, WIDE, webUrl, lang);
  await openDelete(page, lang, shared.nodeId);
  await waitIdle(page);
  await page.keyboard.press('Escape');
  check('Escape closes the dialog', !(await page.locator(MODAL).count()));
  check('closing the dialog leaves the tree and the card in place', (await page.locator(`[data-testid="tree-node-${shared.nodeId}"]`).count()) === 1);

  await openDelete(page, lang, leaf.nodeId);
  await waitIdle(page);
  const narrowAtOpen = await boxMetrics(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(300);
  const afterNarrow = { ...(await boxMetrics(page)), pageOverflow: await overflowX(page), visible: await page.locator(MODAL).isVisible() };
  await page.setViewportSize(WIDE);
  await page.waitForTimeout(300);
  const afterWide = { ...(await boxMetrics(page)), pageOverflow: await overflowX(page), visible: await page.locator(MODAL).isVisible() };
  check('dialog survives 1440 -> 1000 -> 1440 inside the viewport', afterNarrow.visible && afterWide.visible && fitsViewport(afterNarrow) && afterNarrow.pageOverflow <= 0 && afterWide.pageOverflow <= 0,
    JSON.stringify({ narrowAtOpen, afterNarrow, afterWide }));
  await closeDelete(page, lang);

  await page.route('**/tree/*', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill(json({ error: 'x' }, 500));
    else await route.continue();
  });
  await openDelete(page, lang, shared.nodeId);
  await waitIdle(page);
  await confirmButton(page, lang).click();
  await page.locator(MODAL).getByText('API 500').waitFor({ timeout: 5_000 }).catch(() => {});
  const deleteFailureBody = await modalText(page);
  const deleteFailureShown = has(deleteFailureBody, 'API 500');
  const confirmReopened = !(await confirmButton(page, lang).isDisabled());
  check('a failed delete keeps the dialog, shows the failure and reopens the confirm button', deleteFailureShown && confirmReopened, deleteFailureBody.replace(/\n/g, ' | '));
  await page.unroute('**/tree/*');
  await closeDelete(page, lang);
  await page.context().close();

  const longPage = await newPage(browser, NARROW, webUrl, lang);
  await openDelete(longPage, lang, leaf.nodeId);
  await waitIdle(longPage);
  const longMetrics = { ...(await boxMetrics(longPage)), pageOverflow: await overflowX(longPage) };
  check(`the longest title (${LONG_TITLE.length} chars, no spaces) does not overflow the dialog at 360`, fitsViewport(longMetrics) && longMetrics.pageOverflow <= 0, JSON.stringify(longMetrics));
  await longPage.context().close();
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} assertion(s) failed:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    }
  })
  .catch((error) => { console.error(error); stopAll(); process.exitCode = 1; });
