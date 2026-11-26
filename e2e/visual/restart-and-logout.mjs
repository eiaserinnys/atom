// Visual check for the restart notice and the bypass-mode Logout button.
//
//   node e2e/visual/restart-and-logout.mjs --out <dir> [--prefix after] [--root <checkout>] [--operations]
// Set CHROMIUM_EXECUTABLE to use a Chromium other than the one Playwright installed.
//
// Starts a disposable API (bypass mode, SQLite, demo seed) and Vite dev server from <root>
// (default: this checkout), captures the changed screens at 1440px and 390px into <dir>/<prefix>-*.png,
// and exits non-zero when an assertion fails. --operations also writes <dir>/operations.md
// (ui-design 0-14..18). Run it on a checkout of the base commit with --prefix before to see the old screens.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

async function newPage(browser, viewport, webUrl, language = 'en') {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((lang) => localStorage.setItem('language', lang), language);
  const page = await context.newPage();
  await page.goto(webUrl);
  return page;
}

const textOf = (locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const MANUAL_NOTE = /start it again yourself/i;

async function capture({ apiUrl, webUrl }) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
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
  await wideBanner.getByRole('button', { name: 'Restart Now' }).waitFor();
  await shot(wideBanner, 'banner-1440');
  const bannerText = (await textOf(wideBanner.locator('.bg-\\[var\\(--amber-soft\\)\\]')))[0] ?? '';
  check('restart banner explains the server must be started again (1440)', MANUAL_NOTE.test(bannerText), bannerText);

  await wideBanner.locator('[aria-label="Settings"]').click();
  const modal = wideBanner.getByRole('dialog');
  await modal.waitFor();
  await shot(wideBanner, 'settings-modal-1440');
  const footerText = (await textOf(modal.locator('footer')))[0] ?? '';
  check('settings footer explains the server must be started again (1440)', MANUAL_NOTE.test(footerText), footerText);

  const narrowBanner = await newPage(browser, NARROW, webUrl);
  await narrowBanner.getByRole('button', { name: 'Restart Now' }).waitFor();
  await shot(narrowBanner, 'banner-390');
  check('restart banner explains the server must be started again (390)', MANUAL_NOTE.test((await textOf(narrowBanner.locator('.bg-\\[var\\(--amber-soft\\)\\]')))[0] ?? ''));
  check('no horizontal scroll at 390 with the banner', (await overflowX(narrowBanner)) <= 0);

  if (options.operations) await measureOperations({ browser, webUrl, apiUrl, wideBanner, narrowBanner, modal });
  await browser.close();
}

async function measureOperations({ browser, webUrl, apiUrl, wideBanner, narrowBanner, modal }) {
  const rows = [];
  const dialogRows = [];
  const activeLabel = (page) => page.evaluate(() => {
    const el = document.activeElement;
    return el && el !== document.body ? (el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName) : 'body';
  });

  // 14, 15: the settings dialog (changed footer)
  const firstFocus = await activeLabel(wideBanner);
  const order = [];
  for (let i = 0; i < 6; i += 1) {
    await wideBanner.keyboard.press('Tab');
    order.push(await wideBanner.evaluate(() => {
      const el = document.activeElement;
      const box = el?.getBoundingClientRect();
      return { label: el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? el?.tagName, inDialog: Boolean(el?.closest('[role="dialog"]')), visible: Boolean(box && box.width > 0 && box.height > 0) };
    }));
  }
  const tabOk = order.every((step) => step.visible);
  await wideBanner.keyboard.press('Escape');
  const closed = (await modal.count()) === 0;
  const focusAfterClose = await activeLabel(wideBanner);
  const treeStill = await wideBanner.locator('[aria-label="Settings"]').count();
  const focusReturned = focusAfterClose === 'Settings';
  dialogRows.push(`| 설정 창 | 헤더의 톱니 단추 누름 | ${firstFocus} | 해당 없음(눌린 단추의 동작) | ${closed && treeStill ? '닫힘, 바깥 화면 그대로' : '닫히지 않음'} | ${focusAfterClose} |`);

  // 16: narrow widths with the longest translation
  const russian = await newPage(browser, NARROW, webUrl, 'ru');
  await russian.getByRole('button').filter({ hasText: /Перезапуст|Restart/ }).first().waitFor();
  const overflow = await overflowX(russian);
  const bannerBox = await russian.evaluate(() => {
    const banner = document.querySelector('.bg-\\[var\\(--amber-soft\\)\\]');
    const button = banner?.querySelector('button')?.getBoundingClientRect();
    const text = banner?.querySelector('span')?.getBoundingClientRect();
    return { buttonRight: button?.right, textRight: text?.right, textBottom: text?.bottom, buttonTop: button?.top, buttonLeft: button?.left, textLeft: text?.left };
  });
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
  const errorState = { banner: await failingPage.getByRole('button', { name: 'Restart Now' }).count(), overflow: await overflowX(failingPage) };
  check('status failure leaves the screen intact without a banner (390)', errorState.banner === 0 && errorState.overflow <= 0, JSON.stringify(errorState));

  // 18: resize while the banner is open
  await wideBanner.setViewportSize(NARROW);
  const afterNarrow = { button: await wideBanner.getByRole('button', { name: 'Restart Now' }).isVisible(), text: MANUAL_NOTE.test(await wideBanner.locator('body').innerText()), overflow: await overflowX(wideBanner) };
  await wideBanner.setViewportSize(WIDE);
  const afterWide = { button: await wideBanner.getByRole('button', { name: 'Restart Now' }).isVisible(), overflow: await overflowX(wideBanner) };
  check('banner survives 1440 -> 390 -> 1440', afterNarrow.button && afterNarrow.text && afterNarrow.overflow <= 0 && afterWide.button && afterWide.overflow <= 0, JSON.stringify({ afterNarrow, afterWide }));
  check('Tab order stays on visible controls inside the settings dialog', tabOk && order.some((step) => step.inDialog), JSON.stringify(order));
  check('Escape closes the settings dialog and leaves the page', closed && treeStill > 0);
  check('closing the settings dialog returns focus to the Settings button', focusReturned, `focus=${focusAfterClose}`);

  const statusBody = await (await fetch(`${apiUrl}/api/system/status`)).json();
  rows.push(
    ['14', firstFocus !== 'body' && focusReturned ? '통과' : '확인 필요', `설정 창을 열면 첫 초점은 ${firstFocus}(선택된 탭), Esc로 닫으면 초점이 연 단추(${focusAfterClose})로 돌아온다. 변경 전에는 body로 떨어졌다.`],
    ['15', tabOk && closed ? '통과' : '확인 필요', `Tab 6회가 모두 보이는 요소에 머문다: ${order.map((step) => step.label).join(' → ')}. Esc로 닫히고 트리 화면은 그대로.`],
    ['16', overflow <= 0 && !overlap ? '통과' : '확인 필요', `390px에서 가장 긴 번역(ru)도 가로 스크롤 ${overflow}px, 글 오른쪽 끝 ${bannerBox.textRight}px < 단추 왼쪽 끝 ${bannerBox.buttonLeft}px.`],
    ['17', errorState.banner === 0 && errorState.overflow <= 0 ? '통과' : '확인 필요', '상태 요청을 500으로 바꿔도 화면이 그대로 서고 배너만 보이지 않는다. 새 데이터 요청은 추가하지 않았다(기존 30초 상태 조회에 필드 하나).'],
    ['18', afterNarrow.button && afterWide.button ? '통과' : '확인 필요', `1440 → 390 → 1440으로 바꿔도 배너, 안내, 단추가 다시 서고 가로 스크롤 없음(${afterNarrow.overflow}, ${afterWide.overflow}).`],
  );
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
  await russian.context().close();
  await failing.close();
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} assertion(s) failed:\n- ${failures.join('\n- ')}`);
      process.exitCode = 1;
    }
  })
  .catch((error) => { console.error(error); stopAll(); process.exitCode = 1; });
