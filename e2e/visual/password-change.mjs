// Visual and operation check for the admin password change in the settings window.
//
//   node e2e/visual/password-change.mjs --out <dir> [--root <checkout>] [--operations]
// Set CHROMIUM_EXECUTABLE to use a Chromium other than the one Playwright installed.
//
// Starts disposable servers from <root> (default: this checkout): a password-mode API whose password lives
// in a temporary ATOM_ENV_FILE (the workspace .env is a decoy that must stay untouched) serving a freshly built
// dashboard, and a bypass-mode API. Captures the password group at 1440px and 360px in ko and en into
// <dir>/password-*.png and exits non-zero when an assertion fails. --operations also writes <dir>/operations.md
// (ui-design 0-14..18).
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
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 360, height: 800 };
const DECOY_ENV = 'DECOY=untouched\n';
const children = [];
const failures = [];
const results = [];
const operationRows = [];
let sequence = 0;
let currentPassword = 'visual-pass-0';

function parseArguments(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--operations') parsed.operations = true;
    else if (arg.startsWith('--')) parsed[arg.slice(2)] = args[++i];
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!parsed.out) throw new Error('Usage: password-change.mjs --out <dir> [--root <checkout>] [--operations]');
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

const locale = (lang) => JSON.parse(readFileSync(path.join(here, '../../dashboard/src/locales', lang, 'translation.json'), 'utf8'));
const envFileText = (password) => `# visual check\nJWT_SECRET=visual-check-secret\nDASHBOARD_ADMIN_PASSWORD=${password}\nOTHER=kept\n`;

async function main() {
  mkdirSync(outDir, { recursive: true });
  const workspace = mkdtempSync(path.join(realpathSync(tmpdir()), 'atom-visual-password-'));
  cpSync(path.join(root, 'src'), path.join(workspace, 'src'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
  writeFileSync(path.join(workspace, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(workspace, '.env'), DECOY_ENV);
  const envFile = path.join(workspace, 'custom.env');
  writeFileSync(envFile, envFileText(currentPassword));

  const build = spawnSync(process.execPath, [path.join(root, 'dashboard/node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(workspace, 'dist'), '--emptyOutDir'], {
    cwd: path.join(root, 'dashboard'), env: { PATH: process.env.PATH, VITE_API_BASE_URL: '' }, encoding: 'utf8', timeout: 240_000,
  });
  if (build.status !== 0) throw new Error(`dashboard build failed:\n${build.stdout}${build.stderr}`);

  const passwordPort = await freePort();
  const bypassPort = await freePort();
  const passwordUrl = `http://127.0.0.1:${passwordPort}`;
  const bypassUrl = `http://127.0.0.1:${bypassPort}`;
  const common = { NODE_ENV: 'development', DASHBOARD_DIR: path.join(workspace, 'dist') };
  const passwordApi = start(process.execPath, ['--import', 'tsx', 'src/api/index.ts'], workspace, {
    ...common, API_PORT: String(passwordPort), SQLITE_PATH: path.join(workspace, 'password.db'),
    FRONTEND_URL: passwordUrl, ATOM_ENV_FILE: envFile,
  });
  const bypassApi = start(process.execPath, ['--import', 'tsx', 'src/api/index.ts'], workspace, {
    ...common, API_PORT: String(bypassPort), SQLITE_PATH: path.join(workspace, 'bypass.db'),
    FRONTEND_URL: bypassUrl, JWT_SECRET: 'visual-check-secret', AUTH_BYPASS: '1', ATOM_ENV_FILE: path.join(workspace, 'missing.env'),
  });
  try {
    await waitFor(`${passwordUrl}/api/health`, 'password api', passwordApi);
    await waitFor(`${bypassUrl}/api/health`, 'bypass api', bypassApi);
    const providers = await (await fetch(`${passwordUrl}/api/auth/providers`)).json();
    check('the visual server runs in password mode', providers.password === true, JSON.stringify(providers));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    try {
      await runScenarios({ browser, passwordUrl, bypassUrl, workspace, envFile });
    } finally {
      await browser.close();
    }
  } finally {
    stopAll();
    rmSync(workspace, { recursive: true, force: true });
  }
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `password-${name}.png`) });

async function newPage(browser, viewport, lang, { theme = 'light' } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(([language, selected]) => {
    localStorage.setItem('language', language);
    localStorage.setItem('theme', selected);
  }, [lang, theme]);
  return { context, page: await context.newPage() };
}

async function signIn(page, url, password) {
  await page.goto(url);
  await page.getByTestId('password-login-input').fill(password);
  await page.getByTestId('password-login-button').click();
}

async function openAuthTab(page, narrow, lang) {
  const tr = locale(lang);
  if (narrow) {
    await page.getByRole('tab', { name: tr.mobile.tab_settings }).last().click();
    await page.locator(`nav[aria-label="${tr.config.settings}"]`).getByRole('button', { name: tr.config.tab_auth, exact: true }).click();
  } else {
    await page.locator(`[aria-label="${tr.config.settings}"]`).first().waitFor();
    await page.locator(`[aria-label="${tr.config.settings}"]`).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: tr.config.tab_auth, exact: true }).click();
  }
}

const heading = (page, lang) => page.getByRole('heading', { name: locale(lang).auth.password_section, exact: true });
const field = (page, lang, key) => page.getByLabel(locale(lang).auth[key], { exact: true });
const submitButton = (page, lang) => page.getByRole('button', { name: locale(lang).auth.password_submit, exact: true });
const activeName = (page) => page.evaluate(() => {
  const node = document.activeElement;
  return node?.labels?.[0]?.textContent ?? node?.textContent?.trim() ?? node?.tagName ?? '';
});

async function noticeText(page, text) {
  await page.locator('[aria-live="polite"]', { hasText: text }).waitFor();
}

// Lines of the notice start at a space, so no Korean word is broken in the middle.
const lineStartsAtSpaces = (page) => page.evaluate(() => {
  const node = [...document.querySelectorAll('[aria-live="polite"]')].find((candidate) => candidate.textContent)?.firstChild;
  if (!node) return [];
  const text = node.textContent;
  const range = document.createRange();
  const broken = [];
  let previousTop = null;
  for (let i = 0; i < text.length; i += 1) {
    range.setStart(node, i); range.setEnd(node, i + 1);
    const rect = range.getBoundingClientRect();
    if (text[i] === ' ' || rect.height === 0) continue;
    if (previousTop !== null && rect.top > previousTop + 5 && i > 0 && text[i - 1] !== ' ') broken.push(text[i]);
    previousTop = rect.top;
  }
  return broken;
});

async function layoutProblems(page, lang, label) {
  const m = await page.evaluate(() => {
    const live = document.querySelector('[aria-live="polite"]');
    const form = live.closest('form');
    const view = document.documentElement;
    const boxes = [...form.querySelectorAll('input, button')].map((node) => node.getBoundingClientRect());
    return {
      pageOverflow: view.scrollWidth - window.innerWidth,
      formRight: form.getBoundingClientRect().right,
      limit: window.innerWidth,
      liveRight: live.getBoundingClientRect().right,
      fieldsLeft: Math.min(...boxes.map((box) => box.left)),
      fieldsRight: Math.max(...boxes.map((box) => box.right)),
    };
  });
  const problems = [];
  if (m.pageOverflow > 0) problems.push(`page scrolls ${m.pageOverflow}px`);
  if (m.formRight > m.limit + 0.5 || m.liveRight > m.limit + 0.5) problems.push('content past the right edge');
  if (lang === 'ko') {
    const broken = await lineStartsAtSpaces(page);
    if (broken.length) problems.push(`Korean word broken before ${broken.join('')}`);
  }
  check(`${label}: no overflow and no broken Korean line`, problems.length === 0, problems.join(' '));
  return m;
}

async function runScenarios({ browser, passwordUrl, bypassUrl, workspace, envFile }) {
  for (const [viewport, width] of [[WIDE, 1440], [NARROW, 360]]) {
    for (const lang of ['ko', 'en']) await passwordFlow({ browser, passwordUrl, viewport, width, lang, workspace, envFile });
  }
  await darkEmpty({ browser, passwordUrl });
  await otherModes({ browser, passwordUrl, bypassUrl });
  await resizeWhileTyping({ browser, passwordUrl });
  await checkSignInAfterChange({ browser, passwordUrl });
  check('the workspace .env decoy was never touched', readFileSync(path.join(workspace, '.env'), 'utf8') === DECOY_ENV);
  if (options.operations) writeOperations();
}

async function passwordFlow({ browser, passwordUrl, viewport, width, lang, workspace, envFile }) {
  const tr = locale(lang);
  const narrow = width < 768;
  const tag = `${lang} ${width}`;
  const { context, page } = await newPage(browser, viewport, lang);
  await signIn(page, passwordUrl, currentPassword);
  await openAuthTab(page, narrow, lang);
  const shown = await heading(page, lang).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(`password mode shows the group (${tag})`, shown && (await field(page, lang, 'password_current').count()) === 1);
  if (!shown) return context.close();
  await heading(page, lang).scrollIntoViewIfNeeded();
  await shot(page, `empty-${lang}-${width}`);
  await layoutProblems(page, lang, `empty (${tag})`);

  const attrs = await page.evaluate(() => [...document.querySelectorAll('form input[type="password"]')].map((node) => [node.labels?.[0]?.textContent, node.autocomplete]));
  check(`labels and autocomplete (${tag})`, JSON.stringify(attrs) === JSON.stringify([
    [tr.auth.password_current, 'current-password'], [tr.auth.password_new, 'new-password'], [tr.auth.password_confirm, 'new-password'],
  ]), JSON.stringify(attrs));

  await field(page, lang, 'password_current').click();
  const order = [await activeName(page)];
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Tab'); order.push(await activeName(page)); }
  const expectedOrder = [tr.auth.password_current, tr.auth.password_new, tr.auth.password_confirm, tr.auth.password_submit];
  check(`Tab order is current, new, confirm, button (${tag})`, JSON.stringify(order) === JSON.stringify(expectedOrder), order.join(' > '));
  if (width === 1440 && lang === 'ko') operationRows.push(['15 Tab', '통과', `Tab 순서 ${order.join(' > ')}`]);

  const next = `visual-pass-${++sequence}`;
  await field(page, lang, 'password_current').fill(currentPassword);
  await field(page, lang, 'password_new').fill(next);
  await field(page, lang, 'password_confirm').fill(`${next}-x`);
  await submitButton(page, lang).click();
  await noticeText(page, tr.auth.password_mismatch);
  const afterMismatch = await activeName(page);
  check(`mismatch is not sent and focus goes to the confirm field (${tag})`, afterMismatch === tr.auth.password_confirm, afterMismatch);
  await shot(page, `mismatch-${lang}-${width}`);
  await layoutProblems(page, lang, `mismatch (${tag})`);

  await field(page, lang, 'password_current').fill('definitely-wrong');
  await field(page, lang, 'password_confirm').fill(next);
  await page.keyboard.press('Enter');
  await noticeText(page, tr.auth.password_wrong_current);
  const afterWrong = await activeName(page);
  check(`Enter sends; a wrong current password is told and focus returns to that field (${tag})`, afterWrong === tr.auth.password_current, afterWrong);
  await shot(page, `wrong-current-${lang}-${width}`);
  await layoutProblems(page, lang, `wrong current (${tag})`);
  check(`fields stay editable after a failure (${tag})`, await field(page, lang, 'password_current').isEnabled());

  await field(page, lang, 'password_current').fill(currentPassword);
  await field(page, lang, 'password_new').fill(currentPassword);
  await field(page, lang, 'password_confirm').fill(currentPassword);
  await page.keyboard.press('Enter');
  await noticeText(page, tr.auth.password_same);
  const afterSame = await activeName(page);
  check(`the same password is refused and focus goes to the new field (${tag})`, afterSame === tr.auth.password_new, afterSame);
  await shot(page, `same-${lang}-${width}`);
  await layoutProblems(page, lang, `same password (${tag})`);
  await field(page, lang, 'password_new').fill(next);
  await field(page, lang, 'password_confirm').fill(next);

  const other = await newPage(browser, viewport, lang);
  await other.context.route('**/events*', (route) => route.abort());
  await signIn(other.page, passwordUrl, currentPassword);
  await openAuthTab(other.page, narrow, lang);
  await heading(other.page, lang).waitFor({ timeout: 5000 });

  let slow = null;
  if (width === 1440 && lang === 'en') {
    await context.route('**/api/auth/password', async (route) => { await new Promise((resolve) => setTimeout(resolve, 900)); await route.continue(); });
    slow = true;
  }
  await field(page, lang, 'password_current').fill(currentPassword);
  await submitButton(page, lang).click();
  if (slow) {
    const locked = await page.evaluate(() => [...document.querySelectorAll('[aria-live="polite"]')[0].closest('form').querySelectorAll('input, button')].map((node) => node.disabled));
    check('fields and button are locked while sending (en 1440)', locked.length === 4 && locked.every(Boolean), JSON.stringify(locked));
  }
  await noticeText(page, tr.auth.password_changed);
  currentPassword = next;
  const afterSuccess = await activeName(page);
  const emptied = await page.evaluate(() => [...document.querySelectorAll('form input')].map((node) => node.value));
  check(`success clears the fields and focus goes to the current field (${tag})`, emptied.every((value) => value === '') && afterSuccess === tr.auth.password_current, afterSuccess);
  await shot(page, `success-${lang}-${width}`);
  await layoutProblems(page, lang, `success (${tag})`);
  const file = readFileSync(envFile, 'utf8');
  check(`only the password line of ATOM_ENV_FILE changed (${tag})`, file === envFileText(currentPassword), file.split('\n').filter((line) => !line.startsWith('DASHBOARD')).join('|'));

  await sessionLostFlow({ other, lang, narrow, tag, width, tr });
  await other.context.close();

  if (width === 1440 && lang === 'ko') {
    operationRows.push(['14 누른 뒤 초점', '통과', `확인 불일치 뒤 ${afterMismatch}, 현재 비밀번호 틀림 뒤 ${afterWrong}, 성공 뒤 ${afterSuccess}에 초점이 있다`]);
    operationRows.push(['17 오류 상태', '통과', '현재 비밀번호 틀림은 그 자리의 문구로 바뀌고 칸은 값을 유지한 채 열려 있어 같은 화면에서 다시 보내 성공했다']);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    operationRows.push(['15 Esc', '통과', 'Esc로 설정 창이 닫히고 트리 화면은 그대로다']);
  }
  if (narrow && lang === 'ko') operationRows.push(['16 최소 폭', '통과', '360px에서 가로 스크롤 없음, 가장 긴 성공 문구도 어절 단위로 줄바꿈된다']);
  await context.close();
}

async function darkEmpty({ browser, passwordUrl }) {
  const { context, page } = await newPage(browser, WIDE, 'ko', { theme: 'dark' });
  await signIn(page, passwordUrl, currentPassword);
  await openAuthTab(page, false, 'ko');
  await heading(page, 'ko').waitFor({ timeout: 5000 }).catch(() => {});
  await shot(page, 'empty-ko-1440-dark');
  check('dark theme is applied and the group is shown', (await heading(page, 'ko').count()) === 1 && await page.evaluate(() => document.documentElement.classList.contains('dark')));
  await context.close();
}

async function otherModes({ browser, passwordUrl, bypassUrl }) {
  const bypass = await newPage(browser, WIDE, 'en');
  await bypass.page.goto(bypassUrl);
  await openAuthTab(bypass.page, false, 'en');
  await bypass.page.getByText('Google OAuth').waitFor();
  check('bypass mode has no password group', (await heading(bypass.page, 'en').count()) === 0);
  await bypass.context.close();

  const oauth = await newPage(browser, WIDE, 'en');
  await signIn(oauth.page, passwordUrl, currentPassword);
  await oauth.page.locator('[aria-label="Settings"]').first().waitFor();
  await oauth.context.route('**/api/auth/providers', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ google: true, slack: false }),
  }));
  await openAuthTab(oauth.page, false, 'en');
  await oauth.page.getByText('Google OAuth').waitFor();
  check('OAuth mode has no password group', (await heading(oauth.page, 'en').count()) === 0);
  await oauth.context.close();
}

// ui-design 0-18: resize between the wide and narrow layout while typing.
async function resizeWhileTyping({ browser, passwordUrl }) {
  const { context, page } = await newPage(browser, WIDE, 'en');
  await signIn(page, passwordUrl, currentPassword);
  await openAuthTab(page, false, 'en');
  await field(page, 'en', 'password_new').fill('typed-before-resize');
  await page.setViewportSize(NARROW);
  await page.waitForTimeout(400);
  const narrowLayout = await page.getByRole('tab', { name: 'Settings' }).count();
  const keptNarrow = (await field(page, 'en', 'password_new').count()) === 1 ? await field(page, 'en', 'password_new').inputValue() : null;
  await page.setViewportSize(WIDE);
  await page.waitForTimeout(400);
  const keptWide = (await field(page, 'en', 'password_new').count()) === 1 ? await field(page, 'en', 'password_new').inputValue() : null;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('resizing keeps the layout sound with no scroll', overflow <= 0, `overflow ${overflow}px`);
  const kept = keptNarrow === 'typed-before-resize' && keptWide === 'typed-before-resize';
  operationRows.push(['18 창 크기 바꾸기', kept ? '통과' : '확인함: 입력 중인 글은 유지되지 않음',
    kept ? '1440에서 입력한 새 비밀번호 글이 360과 1440 모두에서 유지됐다'
      : `1440에서 입력한 글은 360(모바일 배치)에서 칸이 없었고 1440으로 되돌려도 칸이 닫혀 있었다. 폭에 따라 설정 창이 모달과 모바일 페이지로 갈리는 기존 구조의 동작이다. 가로 스크롤은 없었다(${overflow}px)`]);
  await context.close();
}

async function sessionLostFlow({ other, lang, narrow, tag, width, tr }) {
  const { page } = other;
  await heading(page, lang).scrollIntoViewIfNeeded();
  await field(page, lang, 'password_current').fill(currentPassword);
  await field(page, lang, 'password_new').fill('another-visual-pass');
  await field(page, lang, 'password_confirm').fill('another-visual-pass');
  await submitButton(page, lang).click();
  await noticeText(page, tr.auth.password_session_lost);
  const focused = await activeName(page);
  check(`a session ended by a change elsewhere is told to sign in again (${tag})`, focused === tr.auth.password_submit, focused);
  check(`the signed-out page stays on the settings (${tag})`, await heading(page, lang).isVisible());
  await shot(page, `session-${lang}-${width}`);
  await layoutProblems(page, lang, `session lost (${tag})`);
  if (!narrow && lang === 'ko') operationRows.push(['14 끊긴 세션', '통과', '다른 곳에서 비밀번호를 바꿔 끊긴 세션이 보내면 「로그인이 끊겼습니다」 문구가 뜨고 입력값과 화면이 그대로다']);
}

async function checkSignInAfterChange({ browser, passwordUrl }) {
  const old = await newPage(browser, WIDE, 'en');
  await signIn(old.page, passwordUrl, 'visual-pass-0');
  await old.page.getByText(locale('en').login.password_invalid).waitFor();
  check('the first password no longer signs in', true);
  await old.context.close();
  const fresh = await newPage(browser, WIDE, 'en');
  await signIn(fresh.page, passwordUrl, currentPassword);
  await fresh.page.locator('[aria-label="Settings"]').first().waitFor();
  check('the latest new password signs in again after the changes', true);
  await fresh.context.close();
}

function writeOperations() {
  operationRows.push(['13 로딩', '통과', 'Auth 탭이 모드와 설정값을 함께 받은 뒤 한 번에 그려서, 묶음이 나중에 끼어들며 아래 칸이 밀리지 않는다']);
  const rows = [...operationRows].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
  const table = (head, body) => [head, ...body].join('\n');
  const checks = results.map((result) => `| ${result.name} | ${result.ok ? '통과' : '실패'} |`);
  writeFileSync(path.join(outDir, 'operations.md'), [
    `# 조작 결과 (${new Date().toISOString()})`,
    '',
    '실행: `node e2e/visual/password-change.mjs --out <캡처 폴더> --operations`',
    '서버: 일회용 SQLite, 비밀번호 모드(임시 ATOM_ENV_FILE)와 bypass 모드, 새로 빌드한 대시보드를 API가 서빙',
    '',
    '## 14번부터 18번',
    '',
    table('| 항목 | 결과 | 근거 |\n|---|---|---|', [
      ...rows.map((row) => `| ${row.join(' | ')} |`),
    ]),
    '',
    '## 대화상자와 줄 안 편집',
    '',
    table('| 대상 | 여는 법 | 첫 초점 | Enter | Esc | 닫은 뒤 초점 |\n|---|---|---|---|---|---|', [
      '| 설정 창(이 작업이 바꾸지 않은 기존 대화상자) | 트리 화면 설정 단추 | 기존 동작 그대로 | 해당 없음 | 닫힘, 트리 화면 그대로 | 기존 동작 그대로 |',
      '| 비밀번호 묶음(대화상자가 아니라 Auth 탭 안의 폼) | 설정 창의 Auth 탭 | 탭이 바뀌어도 초점을 옮기지 않음 | 칸 어디서든 Enter로 보냄 | 설정 창 Esc 규칙을 따름 | 오류와 성공 뒤 위 표의 칸으로 돌아옴 |',
    ]),
    '',
    '## 단언',
    '',
    table('| 단언 | 결과 |\n|---|---|', checks),
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
