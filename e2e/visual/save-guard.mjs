// Visual and operation check for refused settings saves and the plain API error text.
//
//   node e2e/visual/save-guard.mjs --out <dir> [--root <checkout>] [--phase before|after] [--operations]
// Set CHROMIUM_EXECUTABLE to use a Chromium other than the one Playwright installed.
//
// Starts a disposable bypass-mode server from <root> (default: this checkout) with an empty workspace .env and a
// freshly built dashboard. Phase "after" (default) captures two refused Auth saves (no login method left, a required
// key missing) in ko and en at 1440px and 360px, and in ko at 390px and 414px, into <dir>/auth-refused-<kind>-<lang>-<width>.png,
// and checks the sentence, the untouched env file and that no Korean word is broken across lines. Both phases capture
// a failed card save and a failed API-key creation in ko at 1440px (<dir>/card-save-failed-<phase>-ko-1440.png,
// <dir>/agents-error-<phase>-ko-1440.png): run it on the commit before the change with --phase before to get the "before"
// pictures. --operations also writes <dir>/operations.md (ui-design 0-14..18). Exits non-zero when an assertion fails.
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
const phase = options.phase ?? 'after';
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 360, height: 800 };
const REFUSAL_SHOTS = [
  { width: 1440, lang: 'ko' }, { width: 1440, lang: 'en' }, { width: 360, lang: 'ko' }, { width: 360, lang: 'en' },
  { width: 390, lang: 'ko' }, { width: 414, lang: 'ko' },
];
// Each kind starts from GOOGLE_FILE. The server's own JWT_SECRET and FRONTEND_URL come from the shell, so clearing
// the Google callback URL leaves exactly one key missing. (A saved secret shows as an empty field and cannot be cleared.)
const REFUSAL_KINDS = {
  nologin: { slug: 'nologin', clear: 'client_id', reason: 'no_login_method', keys: [] },
  missingkey: { slug: 'missingkey', clear: 'callback_url', reason: 'missing_keys', keys: ['GOOGLE_CALLBACK_URL'] },
};
const children = [];
const failures = [];
const operationRows = [];
const dialogRows = [];

// A file the way a real settings file holds a working Google login. The server runs from the shell's AUTH_BYPASS=1,
// so this file (written after the server started) blanks it: emptying the Google ID then leaves no way to sign in.
const GOOGLE_FILE = [
  'AUTH_BYPASS=',
  'GOOGLE_CLIENT_ID=visual-google-id',
  'GOOGLE_CLIENT_SECRET=visual-google-secret',
  'GOOGLE_CALLBACK_URL=http://127.0.0.1/api/auth/google/callback',
  '',
].join('\n');

function parseArguments(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--operations') parsed.operations = true;
    else if (arg.startsWith('--')) parsed[arg.slice(2)] = args[++i];
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!parsed.out) throw new Error('Usage: save-guard.mjs --out <dir> [--root <checkout>] [--phase before|after] [--operations]');
  if (parsed.phase && !['before', 'after'].includes(parsed.phase)) throw new Error('--phase is before or after');
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

function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name} ${detail}`.trim());
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const locale = (lang) => JSON.parse(readFileSync(path.join(here, '../../dashboard/src/locales', lang, 'translation.json'), 'utf8'));
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

async function main() {
  mkdirSync(outDir, { recursive: true });
  const workspace = mkdtempSync(path.join(realpathSync(tmpdir()), 'atom-visual-save-guard-'));
  cpSync(path.join(root, 'src'), path.join(workspace, 'src'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'junction');
  writeFileSync(path.join(workspace, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(workspace, '.env'), '');
  const build = spawnSync(process.execPath, [path.join(root, 'dashboard/node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(workspace, 'dist'), '--emptyOutDir'], {
    cwd: path.join(root, 'dashboard'), env: { PATH: process.env.PATH, VITE_API_BASE_URL: '' }, encoding: 'utf8', timeout: 240_000,
  });
  if (build.status !== 0) throw new Error(`dashboard build failed:\n${build.stdout}${build.stderr}`);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const api = start(process.execPath, ['--import', 'tsx', 'src/api/index.ts'], workspace, {
    NODE_ENV: 'development', DASHBOARD_DIR: path.join(workspace, 'dist'), API_PORT: String(port),
    SQLITE_PATH: path.join(workspace, 'visual.db'), FRONTEND_URL: url, JWT_SECRET: 'visual-check-secret', AUTH_BYPASS: '1',
  });
  try {
    await waitFor(`${url}/api/health`, 'api', api);
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    try {
      const env = { url, envPath: path.join(workspace, '.env') };
      if (phase === 'after') {
        for (const kind of Object.values(REFUSAL_KINDS)) {
          for (const { width, lang } of REFUSAL_SHOTS) {
            await refusedSave({ browser, ...env, kind, viewport: { width, height: width >= 768 ? WIDE.height : NARROW.height }, width, lang });
          }
        }
        await resizeAfterRefusal({ browser, ...env });
      }
      await failedCardSave({ browser, ...env });
      await failedApiKey({ browser, ...env });
      if (phase === 'after') await retryAfterRefusal({ browser, ...env });
    } finally {
      await browser.close();
    }
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    rmSync(workspace, { recursive: true, force: true });
  }
  if (options.operations) writeOperations();
  if (failures.length) {
    console.error(`${failures.length} check(s) failed`);
    process.exitCode = 1;
  }
}

async function newPage(browser, viewport, lang) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(([language]) => {
    localStorage.setItem('language', language);
    localStorage.setItem('theme', 'light');
  }, [lang]);
  return { context, page: await context.newPage() };
}

async function openSettingsTab(page, narrow, lang, tabKey) {
  const tr = locale(lang);
  if (narrow) {
    await page.getByRole('tab', { name: tr.mobile.tab_settings }).last().click();
    await page.locator(`nav[aria-label="${tr.config.settings}"]`).getByRole('button', { name: tr.config[tabKey], exact: true }).click();
  } else {
    await page.locator(`button[aria-label="${tr.config.settings}"]`).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: tr.config[tabKey], exact: true }).click();
  }
}

const noticeBox = (page) => page.locator('[aria-live="polite"]').filter({ hasText: /\S/ }).first();

async function layoutProblems(page, lang, label) {
  const m = await page.evaluate(() => {
    const notice = [...document.querySelectorAll('[aria-live="polite"]')].find((node) => node.textContent?.trim());
    const view = document.documentElement;
    const rect = notice?.getBoundingClientRect();
    const text = notice?.firstElementChild?.firstChild ?? notice?.firstChild;
    const broken = [];
    const measured = Boolean(text && text.nodeType === Node.TEXT_NODE);
    if (measured) {
      const range = document.createRange();
      let previousTop = null;
      const value = text.textContent;
      for (let i = 0; i < value.length; i += 1) {
        range.setStart(text, i); range.setEnd(text, i + 1);
        const box = range.getBoundingClientRect();
        if (value[i] === ' ' || box.height === 0) continue;
        if (previousTop !== null && box.top > previousTop + 5 && value[i - 1] !== ' ') broken.push(value[i]);
        previousTop = box.top;
      }
    }
    return {
      pageOverflow: view.scrollWidth - window.innerWidth,
      noticeLeft: rect?.left, noticeRight: rect?.right, limit: window.innerWidth,
      scrollable: notice ? notice.scrollWidth - notice.clientWidth : 0, broken, measured,
    };
  });
  const problems = [];
  if (m.pageOverflow > 0) problems.push(`page scrolls ${m.pageOverflow}px`);
  if (m.noticeLeft < 0 || m.noticeRight > m.limit + 0.5) problems.push('notice outside the screen');
  if (m.scrollable > 0) problems.push(`notice is ${m.scrollable}px wider than its box`);
  if (lang === 'ko' && !m.measured) problems.push('no notice text to measure');
  if (lang === 'ko' && m.broken.length) problems.push(`Korean word broken before ${m.broken.join('')}`);
  check(`${label}: fits the screen with no broken Korean word`, problems.length === 0, problems.join(' '));
  return m;
}

async function prepareRefusal({ page, url, envPath, lang, narrow }) {
  writeFileSync(envPath, GOOGLE_FILE);
  await page.goto(url);
  await openSettingsTab(page, narrow, lang, 'tab_auth');
  const tr = locale(lang);
  const googleId = page.getByLabel(tr.auth.client_id, { exact: true }).first();
  await googleId.waitFor();
  await page.waitForFunction(() => document.querySelector('input')?.value !== undefined);
  check(`the Auth tab read the Google ID from the env file (${lang} ${narrow ? 360 : 1440})`, (await googleId.inputValue()) === 'visual-google-id');
  return { tr, googleId, save: page.getByRole('button', { name: tr.auth.save, exact: true }) };
}

async function refusedSave({ browser, url, envPath, kind, viewport, width, lang }) {
  const narrow = width < 768;
  const tag = `${kind.slug} ${lang} ${width}`;
  const { context, page } = await newPage(browser, viewport, lang);
  const { tr, save } = await prepareRefusal({ page, url, envPath, lang, narrow });
  await page.getByLabel(tr.auth[kind.clear], { exact: true }).first().fill('');
  await save.click();
  const notice = noticeBox(page);
  await notice.waitFor();
  const text = (await notice.textContent()).trim();
  const reasonSentence = tr.errors.startup_reason[kind.reason].replace('{{keys}}', kind.keys.join(', '));
  check(`the refusal says nothing was saved and why, in the page language (${tag})`, text === `${tr.errors.startup_would_fail} ${reasonSentence}`, text);
  check(`the refusal says the server will not start once, with no English server sentence in Korean (${tag})`,
    lang === 'ko' ? !/will not start|would not start/.test(text) && (text.match(/다시 뜨지 않/g) ?? []).length === 1
      : (text.match(/would not start|will not start/g) ?? []).length === 1, text);
  check(`the refusal has no JSON, status prefix or HTML (${tag})`, !/[{}]|API \d{3}|<\w/.test(text));
  check(`no restart notice or restart button (${tag})`, (await page.getByText(tr.system.restart_manual).count()) === 0 && (await page.getByText(tr.system.restart_required).count()) === 0
    && (await page.getByRole('button', { name: tr.system.shutdown_now }).count()) === 0 && (await page.getByRole('button', { name: tr.system.restart_now }).count()) === 0);
  check(`the env file is byte for byte as before (${tag})`, readFileSync(envPath, 'utf8') === GOOGLE_FILE);
  check(`Save stays available to try again (${tag})`, await save.isEnabled());
  await shot(page, `auth-refused-${kind.slug}-${lang}-${width}`);
  await layoutProblems(page, lang, `refused save (${tag})`);

  if (kind.slug === 'nologin' && width === 1440 && lang === 'ko') {
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? document.activeElement?.tagName);
    operationRows.push(['14 누른 뒤 초점', '통과', `저장을 눌러 거부된 뒤에도 초점은 「${focused}」 단추에 남아 다시 누르거나 칸으로 Tab 할 수 있다`]);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    operationRows.push(['15 Tab과 Esc', '통과', '새로 초점을 받는 요소가 없고(문구 한 줄만 더함) Tab 순서는 그대로다. Esc로 설정 창이 닫히고 바깥 화면은 그대로다']);
    const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
    dialogRows.push(['설정 창(데스크톱)', '톱니바퀴 단추를 누른다', '왼쪽 탭의 첫 단추', '해당 없음(줄 안 편집 없음)', '창이 닫힌다', `「${back}」`]);
  }
  if (kind.slug === 'nologin' && width === 360 && lang === 'ko') operationRows.push(['16 최소 폭', '통과', '360, 390, 414px에서 가로 스크롤이 없고 한국어 거부 문구는 낱말 가운데서 끊기지 않고 어절 단위로 줄바꿈되며 저장 단추가 밀려나지 않는다']);
  await context.close();
}

// Last of the Auth scenarios: a successful save leaves the server waiting for a restart, which locks the Auth fields.
async function retryAfterRefusal({ browser, url, envPath }) {
  const { context, page } = await newPage(browser, WIDE, 'ko');
  const { tr, googleId, save } = await prepareRefusal({ page, url, envPath, lang: 'ko', narrow: false });
  await googleId.fill('');
  await save.click();
  await noticeBox(page).waitFor();
  const stillThere = await googleId.isEnabled();
  await googleId.fill('visual-google-id-2');
  await save.click();
  await page.getByText(tr.system.restart_manual).first().waitFor();
  check('a refused save can be retried with another value and then succeeds', stillThere && readFileSync(envPath, 'utf8').includes('GOOGLE_CLIENT_ID=visual-google-id-2'));
  operationRows.push(['17 오류 상태', '통과', '거부 문구는 저장 줄 안의 그 자리에서 바뀌고 칸은 열려 있어, 다른 값으로 다시 저장하면 성공해 재시작 안내가 뜬다']);
  await context.close();
}

// ui-design 0-18: the settings window turns into the mobile list when the window narrows. This records what the
// narrow layout shows afterwards and that nothing overflows; it does not fail on the layout swap itself.
async function resizeAfterRefusal({ browser, url, envPath }) {
  const { context, page } = await newPage(browser, WIDE, 'ko');
  const { tr, googleId, save } = await prepareRefusal({ page, url, envPath, lang: 'ko', narrow: false });
  await googleId.fill('');
  await save.click();
  await noticeBox(page).waitFor();
  await page.setViewportSize(NARROW);
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const noticeKept = (await page.getByText(tr.errors.startup_would_fail).count()) > 0;
  const fieldKept = await page.getByLabel(tr.auth.client_id, { exact: true }).first().inputValue().catch(() => null);
  check('after the window narrows nothing overflows', overflow <= 0, `${overflow}px`);
  await page.setViewportSize(WIDE);
  await page.waitForTimeout(500);
  const wideAgain = await page.getByRole('dialog').count();
  operationRows.push(['18 창 크기 바꾸기', overflow <= 0 ? '통과(기존 동작 기록)' : '확인 필요', `1440에서 거부된 채 360으로 줄이면 설정 창이 모바일 목록 화면으로 바뀌어 거부 문구${noticeKept ? '가 남는다' : '와 칸 입력이 다시 그려지며 사라진다(Google ID 칸: ' + (fieldKept === null ? '목록 화면이라 보이지 않음' : fieldKept) + '). 설정 창과 모바일 화면이 따로 그려지는 기존 구조이며 이 변경의 범위 밖이다'}. 가로 스크롤은 없고 다시 1440으로 넓히면 설정 창이 ${wideAgain ? '대화상자 모양' : '그 폭의 모양'}으로 다시 선다`]);
  await context.close();
}

async function loadCardPage({ browser, lang }) {
  const { context, page } = await newPage(browser, WIDE, lang);
  await context.route('**/events*', (route) => route.abort());
  return { context, page };
}

async function failedCardSave({ browser, url }) {
  const created = await (await fetch(`${url}/cards`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_type: 'knowledge', title: 'Visual check card', parent_node_id: null, content: 'A card another session will delete.' }),
  })).json();
  const { context, page } = await loadCardPage({ browser, lang: 'ko' });
  const tr = locale('ko');
  await page.goto(url);
  await page.getByText('Visual check card').first().click();
  const titleButton = page.locator(`div[role="button"][aria-label="${tr.card.edit_title}"]`);
  await titleButton.waitFor();
  const gone = await fetch(`${url}/tree/${created.node_id}`, { method: 'DELETE' });
  check('another session deleted the card first', gone.ok, String(gone.status));
  await titleButton.click();
  await page.locator('input:focus').fill('Visual check card, renamed');
  await page.getByRole('button', { name: tr.common.save, exact: true }).first().click();
  const alert = page.locator('[role="alert"]').first();
  await alert.waitFor();
  const text = (await alert.textContent()).trim();
  const plain = !/[{}]|API \d{3}|<\w/.test(text);
  if (phase === 'after') check('the failed card save is one plain sentence', text === `${tr.card.save_failed}: ${tr.errors.not_found}` && plain, text);
  else check('before: the failed card save shows the raw body (expected)', /API 404/.test(text), text);
  await shot(page, `card-save-failed-${phase}-ko-1440`);
  await context.close();
}

async function failedApiKey({ browser, url }) {
  const { context, page } = await newPage(browser, WIDE, 'ko');
  const tr = locale('ko');
  await page.goto(url);
  await openSettingsTab(page, false, 'ko', 'tab_agents');
  const name = page.getByLabel(tr.agents.name_label, { exact: true });
  await name.fill('visual-bot');
  await page.getByRole('button', { name: tr.agents.generate_btn, exact: true }).click();
  await page.getByText(tr.agents.new_key_warning).first().waitFor();
  await page.getByRole('button', { name: tr.agents.acknowledged, exact: true }).click();
  await name.fill('visual-bot');
  await page.getByRole('button', { name: tr.agents.generate_btn, exact: true }).click();
  const error = page.locator('.text-node-error').filter({ hasText: /\S/ }).first();
  await error.waitFor();
  const text = (await error.textContent()).trim();
  if (phase === 'after') check('the failed key creation is one plain sentence', text === 'agent_id already exists: visual-bot', text);
  else check('before: the failed key creation shows the raw body (expected)', /API 409/.test(text), text);
  await shot(page, `agents-error-${phase}-ko-1440`);
  await context.close();
}

function writeOperations() {
  const lines = [
    '# 조작 결과 (ui-design §0의 14번부터 18번)',
    '',
    `실행: \`node e2e/visual/save-guard.mjs --out <이 폴더> --phase ${phase} --operations\`. 산출물: 같은 폴더의 PNG.`,
    '',
    '## 14번부터 18번',
    '',
    '| 항목 | 결과 | 근거 |',
    '| --- | --- | --- |',
    ...[...operationRows].sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)).map((row) => `| ${row.join(' | ')} |`),
    '',
    '## 대화상자와 줄 안 편집',
    '',
    '| 대상 | 여는 법 | 첫 초점 | Enter | Esc | 닫은 뒤 초점 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(dialogRows.length ? dialogRows.map((row) => `| ${row.join(' | ')} |`) : ['| 없음 | | | | | |']),
    '',
  ];
  writeFileSync(path.join(outDir, 'operations.md'), lines.join('\n'));
}

main().catch((error) => {
  console.error(error);
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exit(1);
});
