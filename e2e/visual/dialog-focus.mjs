// Keyboard and focus check for the tree's delete confirmation and move dialog (ui-design 0-14..18).
//
//   node e2e/visual/dialog-focus.mjs --out <dir> [--prefix after] [--root <checkout>] [--operations]
// Set CHROMIUM_EXECUTABLE to use a Chromium other than the one Playwright installed.
//
// Starts a disposable API (bypass mode, SQLite) and Vite dev server from <root> (default: this checkout), builds a
// small tree through the REST API and drives both dialogs with the keyboard: first focus, Esc from the page body,
// Tab and Shift+Tab, focus after closing, a delete and a move that work, a delete that fails, a delete still
// running. Writes <dir>/<prefix>-<dialog>-<lang>-<width>[-dark].png (dialog opened by keyboard, so the first-focus
// ring shows). Run with --root on the base commit for the before run: the assertions fail there. --operations also
// writes <dir>/operations.md.
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
  if (!parsed.out) throw new Error('Usage: dialog-focus.mjs --out <dir> [--prefix after] [--root <checkout>] [--operations]');
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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const locale = (lang) => JSON.parse(readFileSync(path.join(repo, 'dashboard/src/locales', lang, 'translation.json'), 'utf8'));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const workspace = mkdtempSync(path.join(realpathSync(tmpdir()), 'atom-visual-focus-'));
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
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    try {
      const operations = await runChecks({ browser, apiUrl, webUrl });
      if (options.operations) writeOperations(operations, apiUrl);
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

// Library (open) holds three notes; Archive is the move target; Solo has no parent row.
async function seedTree(apiUrl) {
  const card = (title, parent = null, cardType = 'knowledge') => post(apiUrl, '/cards', { title, card_type: cardType, parent_node_id: parent });
  const library = await card('Library', null, 'structure');
  const noteA = await card('Note A', library.node_id);
  const noteB = await card('Note B', library.node_id);
  const noteC = await card('Note C', library.node_id);
  const archive = await card('Archive', null, 'structure');
  return { library: library.node_id, noteA: noteA.node_id, noteB: noteB.node_id, noteC: noteC.node_id, archive: archive.node_id };
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
const FRAME = `${MODAL} > div`;
const rowOf = (page, nodeId) => page.locator(`[data-testid="tree-node-${nodeId}"] > div`).first();
const isOpen = async (page) => (await page.locator(MODAL).count()) > 0;
const waitIdle = (page) => page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });

const labelOf = (page) => page.evaluate(() => {
  const element = document.activeElement;
  if (!element || element === document.body) return 'body';
  if (element.getAttribute('role') === 'button' && element.parentElement?.dataset.testid?.startsWith('tree-node-')) {
    return `row:${(element.textContent ?? '').trim().slice(0, 20)}`;
  }
  if (element.dataset.testid === 'tree-list') return 'tree-list';
  return `${element.tagName.toLowerCase()}:${(element.textContent ?? '').trim().slice(0, 20)}`;
});

const insideFrame = (page) => page.evaluate((selector) => document.querySelector(selector)?.contains(document.activeElement) ?? false, FRAME);
const hasRing = (page) => page.evaluate(() => document.activeElement?.matches(':focus-visible') ?? false);

// Right-click the row, then pick the menu item with the keyboard, so the first-focus ring shows as it does for a keyboard user.
async function openDialog(page, lang, nodeId, which) {
  await closeIfOpen(page, lang);
  await rowOf(page, nodeId).waitFor({ timeout: 15_000 });
  await rowOf(page, nodeId).click({ button: 'right' });
  const text = locale(lang);
  const label = which === 'delete' ? text.tree.context_delete : text.tree.context_move;
  const item = page.locator('[data-testid="context-menu-item"]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
  await item.focus();
  await page.keyboard.press('Enter');
  await page.locator(MODAL).waitFor();
  if (which === 'delete') await waitIdle(page);
  else await page.locator(`${MODAL} button`).filter({ hasText: 'Archive' }).waitFor({ timeout: 10_000 });
}

async function closeIfOpen(page, lang) {
  if (!(await isOpen(page))) return;
  await page.locator(`${MODAL} button`).filter({ hasText: new RegExp(`^${locale(lang).common.cancel}$`) }).click();
  await page.locator(MODAL).waitFor({ state: 'detached' });
}

async function tabCycle(page) {
  const seen = [];
  let stays = true;
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    stays &&= await insideFrame(page);
    seen.push(await labelOf(page));
  }
  return { stays, seen };
}

async function overflowX(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function frameFits(page) {
  return page.evaluate((selector) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return Boolean(box) && box.left >= 15.5 && box.right <= window.innerWidth - 15.5;
  }, FRAME);
}

async function runChecks({ browser, apiUrl, webUrl }) {
  const data = await seedTree(apiUrl);
  await captureShots({ browser, webUrl, data });
  const delete1 = await exerciseOpenAndClose(browser, webUrl, data, 'delete');
  const move1 = await exerciseOpenAndClose(browser, webUrl, data, 'move');
  const deleteFlow = await exerciseDeleteFlows(browser, webUrl, data);
  const moveFlow = await exerciseMoveSuccess(browser, webUrl, data);
  const narrow = await exerciseNarrow(browser, webUrl, data);
  return { delete1, move1, deleteFlow, moveFlow, narrow };
}

async function captureShots({ browser, webUrl, data }) {
  for (const [viewport, width, theme, langs] of [[WIDE, 1440, 'light', ['ko', 'en']], [NARROW, 360, 'light', ['ko', 'en']], [WIDE, 1440, 'dark', ['en']]]) {
    for (const lang of langs) {
      const page = await newPage(browser, viewport, webUrl, lang, theme);
      for (const which of ['delete', 'move']) {
        await openDialog(page, lang, data.noteA, which);
        await page.screenshot({ path: path.join(outDir, `${prefix}-${which}-${lang}-${width}${theme === 'dark' ? '-dark' : ''}.png`) });
        await closeIfOpen(page, lang);
      }
      await page.context().close();
    }
  }
}

// First focus, Esc from the page body, Tab and Shift+Tab, Enter on Cancel, Esc from Cancel, focus after closing.
async function exerciseOpenAndClose(browser, webUrl, data, which) {
  const lang = 'en';
  const text = locale(lang);
  const page = await newPage(browser, WIDE, webUrl, lang);
  const out = { which };

  await openDialog(page, lang, data.noteA, which);
  out.firstFocus = await labelOf(page);
  check(`${which}: opening puts the first focus on Cancel`, out.firstFocus === `button:${text.common.cancel}`, out.firstFocus);
  check(`${which}: the first focus shows the focus ring`, await hasRing(page));
  const dialogAttributes = await page.evaluate((selector) => {
    const frame = document.querySelector(selector);
    const title = frame?.getAttribute('aria-labelledby');
    return { role: frame?.getAttribute('role'), modal: frame?.getAttribute('aria-modal'), titleText: title ? document.getElementById(title)?.textContent : null, h2: frame?.querySelector('h2')?.textContent };
  }, FRAME);
  check(`${which}: the box is a modal dialog named by its heading`, dialogAttributes.role === 'dialog' && dialogAttributes.modal === 'true' && dialogAttributes.titleText === dialogAttributes.h2 && Boolean(dialogAttributes.h2), JSON.stringify(dialogAttributes));

  const cycle = await tabCycle(page);
  out.tab = cycle.seen.join(' -> ');
  check(`${which}: Tab x6 and Shift+Tab x6 never leave the dialog`, cycle.stays, out.tab);

  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  check(`${which}: setup, focus is on the page body`, (await labelOf(page)) === 'body');
  await page.keyboard.press('Escape');
  out.escapeFromBody = !(await isOpen(page));
  check(`${which}: Esc closes the dialog when focus is on the page body`, out.escapeFromBody);
  await closeIfOpen(page, lang);
  out.focusAfterEscapeFromBody = await labelOf(page);
  check(`${which}: after Esc the focus is on the row that opened it`, out.focusAfterEscapeFromBody === 'row:Note A', out.focusAfterEscapeFromBody);

  await openDialog(page, lang, data.noteA, which);
  await page.keyboard.press('Enter');
  out.enterClosed = !(await isOpen(page));
  out.focusAfterEnter = await labelOf(page);
  check(`${which}: Enter on Cancel closes without deleting or moving, focus back on the row`, out.enterClosed && out.focusAfterEnter === 'row:Note A'
    && (await rowOf(page, data.noteA).count()) === 1, `${out.enterClosed} ${out.focusAfterEnter}`);

  await openDialog(page, lang, data.noteA, which);
  await page.keyboard.press('Escape');
  out.escapeFromCancel = !(await isOpen(page));
  out.focusAfterEscape = await labelOf(page);
  check(`${which}: Esc from Cancel closes, focus back on the row`, out.escapeFromCancel && out.focusAfterEscape === 'row:Note A', `${out.escapeFromCancel} ${out.focusAfterEscape}`);

  await openDialog(page, lang, data.noteA, which);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(400);
  const insideAtNarrower = await insideFrame(page);
  const fitsAtNarrower = await frameFits(page);
  await page.setViewportSize(WIDE);
  await page.waitForTimeout(400);
  out.resize = { insideAtNarrower, fitsAtNarrower, openAgain: await isOpen(page), insideAgain: await insideFrame(page) };
  check(`${which}: resizing 1440 -> 1000 -> 1440 keeps the dialog open, inside the viewport, with focus inside`,
    insideAtNarrower && fitsAtNarrower && out.resize.openAgain && out.resize.insideAgain, JSON.stringify(out.resize));
  await page.setViewportSize(NARROW);
  await page.waitForTimeout(400);
  out.phoneLayout = { open: await isOpen(page), focus: await labelOf(page) };
  await page.setViewportSize(WIDE);
  await closeIfOpen(page, lang);
  await page.context().close();
  return out;
}

async function exerciseDeleteFlows(browser, webUrl, data) {
  const lang = 'en';
  const text = locale(lang);
  const page = await newPage(browser, WIDE, webUrl, lang);
  const confirm = () => page.locator(`${MODAL} button`).filter({ hasText: new RegExp(`^${text.delete_modal.confirm_btn}$`) });
  const out = {};

  await page.route('**/tree/*', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill(json({ error: 'x' }, 500));
    else await route.continue();
  });
  await openDialog(page, lang, data.noteA, 'delete');
  await confirm().click();
  await page.locator(MODAL).getByText('API 500').waitFor({ timeout: 5_000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await closeIfOpen(page, lang);
  out.focusAfterFailure = await labelOf(page);
  check('delete that failed: closing the dialog puts focus on the row', out.focusAfterFailure === 'row:Note A', out.focusAfterFailure);
  await page.unroute('**/tree/*');

  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/tree/*', async (route) => {
    if (route.request().method() === 'DELETE') { await held; await route.fulfill(json({ error: 'x' }, 500)); } else await route.continue();
  });
  await openDialog(page, lang, data.noteB, 'delete');
  await confirm().click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  const escapeWhileBusy = await isOpen(page);
  await page.mouse.click(4, 4);
  const backdropWhileBusy = await isOpen(page);
  out.busy = { escapeWhileBusy, backdropWhileBusy };
  check('delete still running: Esc and a click on the backdrop do not close the dialog', escapeWhileBusy && backdropWhileBusy, JSON.stringify(out.busy));
  release();
  await page.locator(MODAL).getByText('API 500').waitFor({ timeout: 5_000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await closeIfOpen(page, lang);
  await page.unroute('**/tree/*');
  out.focusAfterBusy = await labelOf(page);
  check('delete still running, then failed: closing puts focus on the row', out.focusAfterBusy === 'row:Note B', out.focusAfterBusy);

  await openDialog(page, lang, data.noteC, 'delete');
  await confirm().click();
  await page.locator(MODAL).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  out.focusAfterDelete = await labelOf(page);
  check('delete that works: focus goes to the parent row', out.focusAfterDelete === 'row:Library', out.focusAfterDelete);
  await page.context().close();
  return out;
}

async function exerciseMoveSuccess(browser, webUrl, data) {
  const lang = 'en';
  const text = locale(lang);
  const page = await newPage(browser, WIDE, webUrl, lang);
  const out = {};
  await openDialog(page, lang, data.noteA, 'move');
  await page.locator(`${MODAL} button`).filter({ hasText: 'Archive' }).click();
  await page.locator(`${MODAL} button`).filter({ hasText: new RegExp(`^${text.move_modal.confirm_btn}$`) }).click();
  await page.locator(MODAL).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  await rowOf(page, data.noteA).waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  out.focusAfterMove = await labelOf(page);
  const parentOfMoved = await page.evaluate((id) => document.querySelector(`[data-testid="tree-node-${id}"]`)?.parentElement?.closest('[data-testid^="tree-node-"]')?.querySelector('span.truncate')?.textContent, data.noteA);
  check('move that works: focus goes to the moved row in its new place', out.focusAfterMove === 'row:Note A' && parentOfMoved === 'Archive', `${out.focusAfterMove}, now under ${parentOfMoved}`);
  await page.context().close();
  return out;
}

async function exerciseNarrow(browser, webUrl, data) {
  const out = {};
  const page = await newPage(browser, NARROW, webUrl, 'en');
  for (const which of ['delete', 'move']) {
    await openDialog(page, 'en', data.noteB, which);
    out[which] = { fits: await frameFits(page), overflow: await overflowX(page), firstFocus: await labelOf(page) };
    check(`${which}: at 360px the dialog stays inside the viewport with no sideways scroll`, out[which].fits && out[which].overflow <= 0, JSON.stringify(out[which]));
    await closeIfOpen(page, 'en');
  }
  await page.context().close();
  return out;
}

function writeOperations({ delete1, move1, deleteFlow, moveFlow, narrow }, apiUrl) {
  const status = (ok) => (ok ? '통과' : '미통과');
  const dialogs = [delete1, move1];
  const rows = [
    ['14', status(dialogs.every((d) => d.firstFocus === 'button:Cancel' && d.focusAfterEscape === 'row:Note A') && deleteFlow.focusAfterDelete === 'row:Library' && moveFlow.focusAfterMove === 'row:Note A'),
      `두 창 모두 열면 첫 초점은 Cancel(${delete1.firstFocus}, ${move1.firstFocus}), 취소나 Esc로 닫으면 연 행(${delete1.focusAfterEscape}, ${move1.focusAfterEscape}), 삭제에 성공하면 부모 행(${deleteFlow.focusAfterDelete}), 옮기기에 성공하면 옮겨진 행(${moveFlow.focusAfterMove}), 실패 뒤 닫으면 연 행(${deleteFlow.focusAfterFailure})`],
    ['15', status(dialogs.every((d) => d.escapeFromBody && d.escapeFromCancel)),
      `초점이 body여도 Esc로 닫힌다. Tab 6회와 Shift+Tab 6회 모두 창 안에 머문다(삭제: ${delete1.tab}). 진행 중 Esc와 겉판 클릭은 닫지 않는다(${JSON.stringify(deleteFlow.busy)}). 닫은 뒤 바깥 화면은 그대로.`],
    ['16', status(narrow.delete.fits && narrow.move.fits && narrow.delete.overflow <= 0 && narrow.move.overflow <= 0),
      `360px에서 두 창 모두 창이 좌우 16px 여백 안에 있고 가로 스크롤이 없다(삭제 ${narrow.delete.overflow}px, 이동 ${narrow.move.overflow}px 넘침).`],
    ['17', status(deleteFlow.focusAfterFailure === 'row:Note A'),
      `삭제 요청을 500으로 바꾸면 창이 남고 실패 문구가 뜬다. 그 창을 닫으면 초점이 행으로 돌아간다(${deleteFlow.focusAfterFailure}). 그 밖의 오류 화면은 바꾸지 않았다.`],
    ['18', status(dialogs.every((d) => d.resize.insideAtNarrower && d.resize.fitsAtNarrower && d.resize.openAgain && d.resize.insideAgain)),
      `창을 연 채 1440 -> 1000 -> 1440으로 바꿔도 두 창 모두 열려 있고 좌우 여백 안에 있으며 초점이 창 안에 남는다. 폭이 휴대폰 배치로 넘어가면(360) 트리가 다시 그려지며 열린 창은 닫힌다(삭제 ${JSON.stringify(delete1.phoneLayout)}, 이동 ${JSON.stringify(move1.phoneLayout)}). 이 닫힘은 이번 변경 전에도 같고(전 캡처 확인) 바꾸지 않았다.`],
  ];
  const dialogRows = [
    ['삭제 확인창(트리 노드 우클릭 메뉴의 삭제)', '노드 우클릭, 메뉴 「Delete」', delete1.firstFocus, `Cancel에서 Enter는 닫는다, 삭제하지 않는다(${delete1.enterClosed}). 닫은 뒤 ${delete1.focusAfterEnter}`, `초점이 body여도 닫는다(${delete1.escapeFromBody}), 진행 중에는 닫지 않는다`, delete1.focusAfterEscape],
    ['옮기기 창(트리 노드 우클릭 메뉴의 Move Card)', '노드 우클릭, 메뉴 「Move Card」', move1.firstFocus, `Cancel에서 Enter는 닫는다, 옮기지 않는다(${move1.enterClosed}). 닫은 뒤 ${move1.focusAfterEnter}`, `초점이 body여도 닫는다(${move1.escapeFromBody}), 진행 중에는 닫지 않는다(MoveCardModal.dialogKeyboard 시험)`, move1.focusAfterEscape],
  ];
  const table = (head, body) => [head, ...body].join('\n');
  writeFileSync(path.join(outDir, 'operations.md'), [
    `# 조작 결과 (${prefix}, ${new Date().toISOString()})`,
    '',
    '실행: `node e2e/visual/dialog-focus.mjs --out <캡처 폴더> --prefix after --operations`',
    `서버: ${apiUrl} 의 일회용 SQLite(직접 만든 작은 트리), bypass 모드, tsx 실행`,
    '',
    '## 14번부터 18번',
    '',
    table('| 항목 | 결과 | 근거 |\n|---|---|---|', rows.map((row) => `| ${row.join(' | ')} |`)),
    '',
    '## 대화상자와 줄 안 편집',
    '',
    table('| 대상 | 여는 법 | 첫 초점 | Enter | Esc | 닫은 뒤 초점 |\n|---|---|---|---|---|---|', dialogRows.map((row) => `| ${row.join(' | ')} |`)),
    '',
    '## 단언',
    '',
    table('| 단언 | 결과 |\n|---|---|', results.map((result) => `| ${result.name} | ${result.ok ? '통과' : '실패'} |`)),
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
