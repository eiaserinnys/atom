// Visual check for the tree delete confirmation (what a delete removes, shown before it happens).
//
//   node e2e/visual/delete-confirmation.mjs --out <dir> [--prefix after] [--root <checkout>]
// Set CHROMIUM_EXECUTABLE to use a Chromium other than the one Playwright installed.
//
// Starts a disposable API (bypass mode, SQLite) and Vite dev server from <root> (default: this checkout),
// builds a small tree through the REST API, opens the delete confirmation for each case (a symlink that leaves
// its card elsewhere, a symlink that is the last place of its card, nodes whose cards have symlinks in other
// places, a section with such cards deep below it) at 1440px and 360px in ko, en, de and ja, and writes
// <dir>/<prefix>-<case>-<lang>-<width>.png. The wording is read from this checkout's locale files, so running
// it with --root on the base commit fails the assertions (that is the before run). It also confirms a delete
// with the other place expanded, to see the symlink rows leave without a reload, and writes <dir>/operations.md
// (ui-design 0-14..18, measured here; dialog-focus.mjs checks the shared dialog keyboard code).
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
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
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${prefix}-${name}.png`) });
const children = [];
const failures = [];
const results = [];
const dialogRows = [];

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

const OPERATION_ITEMS = [
  ['14', '누른 뒤 초점', '확인창을 열면 첫 초점이 취소 단추에 있고, Esc나 취소 Enter로 닫으면 초점이 연 행으로 돌아온다. 링크와 정본 노드 둘 다 측정했다. 확인(삭제)으로 닫으면 행이 사라지므로 돌아갈 행이 없다(이 변경은 건드리지 않은 main 동작).'],
  ['15', 'Tab과 Esc', '받는 중에는 Tab과 Shift+Tab이 취소에 머물고 확인은 잠긴다. 준비되면 Tab이 삭제로 가서 취소로 되돌아온다. Esc는 확인창만 닫고 트리는 그대로다.'],
  ['16', '최소 폭 360에서 넘침과 잘림', '여섯 경우 곱하기 ko, en, de, ja에서 확인창이 화면 안에 있고 안쪽 글이 넘치거나 잘리지 않으며 가로 스크롤이 없다. 공백 없는 50자 제목도 같다.'],
  ['17', '오류 상태', '노드 미리보기를 실패시킨 화면은 일반 경고로 바뀌고 확인은 열려 있다. 삭제 요청을 실패시키면 확인창 안에 오류가 보이고 확인이 다시 열린다.'],
  ['18', '창 크기 바꾸기', '확인창을 연 채 1440, 1000, 1440으로 바꿔도 확인창이 화면 안에 다시 서고 가로 스크롤이 생기지 않는다.'],
];

function writeOperations() {
  const verdict = (item) => {
    const related = results.filter((result) => result.ops.includes(item));
    if (related.length === 0) return ['미측정', '이 실행에서 측정한 단언이 없다'];
    const failed = related.filter((result) => !result.ok);
    return [failed.length === 0 ? '통과' : '실패', `단언 ${related.length}개 중 ${related.length - failed.length}개 통과`];
  };
  const lines = [
    '# 조작 결과', '',
    '이 파일은 `e2e/visual/delete-confirmation.mjs`가 실행 끝에 쓴다. 바뀐 화면은 노드와 링크 삭제 확인창의 아래 한 줄이다. 확인창 틀, 단추, 키보드 코드는 이 변경에서 건드리지 않았고 같은 코드의 동작을 새 경우(정본 노드와 다른 자리 링크)에서 다시 쟀다.', '',
    '## 14번부터 18번', '',
    '| 항목 | 결과 | 근거 |', '| --- | --- | --- |',
  ];
  for (const [item, title, what] of OPERATION_ITEMS) {
    const [result, count] = verdict(item);
    lines.push(`| ${item} ${title} | ${result} | ${what} (${count}) |`);
  }
  lines.push('', '## 대화상자와 줄 안 편집', '',
    '| 대상 | 여는 법 | 첫 초점 | Enter | Esc | 닫은 뒤 초점 |', '| --- | --- | --- | --- | --- | --- |');
  for (const row of dialogRows) lines.push(`| ${row.target} | ${row.openedBy} | ${row.firstFocus} | ${row.enter} | ${row.esc} | ${row.focusAfterClose} |`);
  lines.push('', '줄 안 편집과 시트, 팝오버는 이 변경에 없다. 우클릭 메뉴(삭제 항목)는 글자와 동작이 그대로다.', '',
    '## 실행 명령과 산출물', '',
    `실행: \`node e2e/visual/delete-confirmation.mjs --out <shots 폴더> --prefix ${prefix}\``,
    `단언 ${results.length}개, 실패 ${failures.length}개.`, '',
    '산출물(같은 폴더):', '', ...readdirSync(outDir).filter((file) => file.endsWith('.png')).sort().map((file) => `- ${file}`), '');
  writeFileSync(path.join(outDir, 'operations.md'), lines.join('\n'));
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

function check(name, ok, detail = '', ops = []) {
  results.push({ name, ok, detail, ops });
  if (!ok) failures.push(`${name} ${detail}`.trim());
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const locale = (lang) => JSON.parse(readFileSync(path.join(repo, 'dashboard/src/locales', lang, 'translation.json'), 'utf8'));
const has = (text, expected) => typeof expected === 'string' && text.includes(expected);
const fill = (template, values) => (typeof template === 'string' ? Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template) : template);

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
    const data = await seedTree(apiUrl, path.join(workspace, 'atom.db'));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    try {
      await captureScreens({ browser, apiUrl, webUrl, data });
      writeOperations();
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
async function seedTree(apiUrl, dbPath) {
  const card = (title, parent = null, cardType = 'knowledge') => post(apiUrl, '/cards', { title, card_type: cardType, parent_node_id: parent });
  const link = (created, parent = null) => post(apiUrl, '/tree/symlink', { card_id: created.id, parent_node_id: parent });
  const library = await card('Library', null, 'structure');
  const referenceOriginal = await card('Reference card', library.node_id);
  const referenceLink = await link(referenceOriginal);

  const sprint = await card('Sprint plan', null, 'structure');
  const taskOne = await card('Task one', sprint.node_id);
  const taskTwo = await card('Task two', sprint.node_id);
  const taskThree = await card('Task three', sprint.node_id);
  const taskThreeLink = await link(taskThree);

  // Older data: the original node is gone, so the symlink at the root is the last place of this card. Deleting
  // the original through the API now takes the symlink and the card with it, so the row is removed directly.
  const orphan = await card('Orphan reference', library.node_id);
  const orphanLink = await link(orphan);
  const database = new Database(dbPath);
  database.prepare('DELETE FROM tree_nodes WHERE id = ?').run(orphan.node_id);
  database.close();

  const lonely = await card(LONG_TITLE);
  const shared = await card('Shared note');
  const sharedLink = await link(shared, library.node_id);

  // A section whose cards deep below it also sit under "Elsewhere"; one more card there stays.
  const archive = await card('Archive section', null, 'structure');
  const archiveGroup = await card('Archive group', archive.node_id, 'structure');
  const itemOne = await card('Archive item one', archiveGroup.node_id);
  const itemTwo = await card('Archive item two', archiveGroup.node_id);
  const kept = await card('Kept note', library.node_id);
  const elsewhere = await card('Elsewhere', null, 'structure');
  const itemOneLink = await link(itemOne, elsewhere.node_id);
  const itemTwoLink = await link(itemTwo, elsewhere.node_id);
  const keptLink = await link(kept, elsewhere.node_id);

  // An other-place parent whose only child is the link of the deleted section: it ends up with no children.
  const emptiedSection = await card('Emptied section', null, 'structure');
  const emptiedItem = await card('Emptied item', emptiedSection.node_id);
  const emptiedPlace = await card('Emptied place', null, 'structure');
  const emptiedLink = await link(emptiedItem, emptiedPlace.node_id);

  return {
    cardIds: [library, referenceOriginal, orphan, sprint, taskOne, taskTwo, taskThree, lonely, shared, archive, archiveGroup, itemOne, itemTwo, kept, elsewhere, emptiedSection, emptiedItem, emptiedPlace].map((created) => created.id),
    elsewhere: { nodeId: elsewhere.node_id, linkNodeIds: [itemOneLink.id, itemTwoLink.id], keptLinkNodeId: keptLink.id, keptCardId: kept.id },
    emptied: { sectionNodeId: emptiedSection.node_id, sectionCardId: emptiedSection.id, itemCardId: emptiedItem.id, placeNodeId: emptiedPlace.node_id, placeCardId: emptiedPlace.id, linkNodeId: emptiedLink.id },
    cases: [
      { key: 'symlink', name: 'Reference card', nodeId: referenceLink.id, expected: { target: 'symlink', cards: 0, links: 0 } },
      { key: 'symlinkLast', name: 'Orphan reference', nodeId: orphanLink.id, cardId: orphan.id, expected: { target: 'symlink', cards: 1, links: 0, ids: [orphan.id] } },
      { key: 'normal', name: 'Sprint plan', nodeId: sprint.node_id, linkNodeIds: [taskThreeLink.id], expected: { target: 'node', cards: 4, links: 1, ids: [sprint.id, taskOne.id, taskTwo.id, taskThree.id] } },
      { key: 'leaf', name: LONG_TITLE, nodeId: lonely.node_id, expected: { target: 'node', cards: 1, links: 0, ids: [lonely.id] } },
      { key: 'shared', name: 'Shared note', nodeId: shared.node_id, linkNodeIds: [sharedLink.id], expected: { target: 'node', cards: 1, links: 1, ids: [shared.id] } },
      { key: 'deep', name: 'Archive section', nodeId: archive.node_id, linkNodeIds: [itemOneLink.id, itemTwoLink.id], expected: { target: 'node', cards: 4, links: 2, ids: [archive.id, archiveGroup.id, itemOne.id, itemTwo.id] } },
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

const DIALOG_SHAPE = {
  symlink: { title: 'title_link', body: 'body_link' },
  symlinkLast: { title: 'title_link', body: 'body_link' },
  normal: { title: 'title_node', body: 'body_node' },
  leaf: { title: 'title_node', body: 'body_node' },
  shared: { title: 'title_node', body: 'body_node' },
  deep: { title: 'title_node', body: 'body_node' },
};

// The word that says "permanently" in each checked language; a dialog says it once or not at all.
const PERMANENT_WORD = { ko: '영구 삭제', en: 'permanently', de: 'dauerhaft', ja: '完全に' };
const countOf = (text, word) => text.toLowerCase().split(word.toLowerCase()).length - 1;
const noticeText = (text, preview) => fill(preview.deleted_link_count > 0 ? text.cards_permanent_links : text.cards_permanent, { total: preview.deleted_card_count, links: preview.deleted_link_count });

async function frameBox(page) {
  return page.evaluate((selector) => {
    const box = document.querySelector(selector)?.firstElementChild?.getBoundingClientRect();
    return { top: box?.top, height: box?.height };
  }, MODAL);
}

// The dialog keeps its side margin (mx-4 = 16px) and no text runs past its own box.
const fitsViewport = (metrics) => metrics.left >= 15.5 && metrics.right <= metrics.innerWidth - 15.5 && metrics.overflowing === 0 && metrics.clipped === 0;

async function captureScreens({ browser, apiUrl, webUrl, data }) {
  const previews = {};
  for (const item of data.cases) {
    previews[item.key] = await serverPreview(apiUrl, item.nodeId);
    const preview = previews[item.key];
    const ids = [...(preview.deleted_card_ids ?? [])].sort();
    check(`server preview for ${item.key}: ${item.expected.target}, ${item.expected.cards} card(s), ${item.expected.links} other-place link(s)`,
      preview.target === item.expected.target && preview.deleted_card_count === item.expected.cards
        && preview.deleted_link_count === item.expected.links
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
        const permanentWords = countOf(body, PERMANENT_WORD[lang]);
        const preview = previews[item.key];
        const parts = await framePartTexts(page);
        if (item.key === 'symlink') {
          check(`symlink whose card sits elsewhere says the link is deleted and the original card stays, with no permanent-deletion wording (${tag})`,
            has(body, text.title_link) && has(body, fill(text.body_link, { name: item.name })) && has(body, text.link_card_stays)
              && permanentWords === 0 && !has(body, text.cards_unknown_link) && amber === 0, body.replace(/\n/g, ' | '));
        } else {
          const expected = noticeText(text, preview);
          check(`${item.key} dialog shows the server preview numbers: ${preview.deleted_card_count} card(s), ${preview.deleted_link_count} other-place link(s) (${tag})`,
            parts[2] === expected && amber === 1 && !has(body, text.link_card_stays)
              && has(parts[2], String(preview.deleted_card_count))
              && (!item.key.startsWith('symlink') || has(body, fill(text.body_link, { name: item.name }))), body.replace(/\n/g, ' | '));
          check(`permanent deletion is said once, in the notice line only, ${item.key} (${tag})`, permanentWords === 1, body.replace(/\n/g, ' | '));
        }
        const metrics = await boxMetrics(page);
        check(`dialog stays inside the viewport without overflowing children, ${item.key} (${tag})`,
          fitsViewport(metrics) && (await overflowX(page)) <= 0, JSON.stringify(metrics), width === 360 ? ['16'] : []);
        const shape = DIALOG_SHAPE[item.key];
        const sentence = fill(text[shape.body], { name: item.name });
        check(`dialog is title, one sentence, notice, buttons, and the name appears once, ${item.key} (${tag})`,
          parts.length === 4 && parts[0] === text[shape.title]
            && parts[1] === sentence && parts.join('').split(item.name).length === 2, JSON.stringify(parts));
        await checkKoreanBreaks(page, lang, `${item.key} (${tag})`);
        await shot(page, `${item.key}-${lang}-${width}`);
        await closeDelete(page, lang);
      }

      const waits = {};
      for (const key of ['normal', 'leaf', 'symlink', 'symlinkLast']) {
        const item = data.cases.find((candidate) => candidate.key === key);
        waits[key] = await captureWaiting({ page, lang, text, tag, item, shot, withFailure: key !== 'symlink' });
      }
      const shift = (key) => waits[key].ready.height - waits[key].loading.height;
      check(`symlink whose card stays keeps its top edge and height from loading to loaded (${tag})`,
        Math.abs(waits.symlink.ready.top - waits.symlink.loading.top) <= 0.5 && Math.abs(shift('symlink')) <= 0.5, JSON.stringify(waits.symlink));
      check(`symlink that deletes a card changes height from loading to loaded by as much as a node dialog with the same line does (${tag})`,
        Math.abs(shift('symlinkLast') - shift('leaf')) <= 1, `node ${shift('leaf')}px, symlink ${shift('symlinkLast')}px`);
      await page.context().close();
    }
  }

  const dark = await newPage(browser, WIDE, webUrl, 'en', 'dark');
  await openDelete(dark, 'en', data.cases.find((item) => item.key === 'normal').nodeId);
  await dark.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  await shot(dark, 'normal-en-1440-dark');
  await dark.context().close();

  const darkDeep = await newPage(browser, WIDE, webUrl, 'ko', 'dark');
  await openDelete(darkDeep, 'ko', data.cases.find((item) => item.key === 'deep').nodeId);
  await darkDeep.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  check('dark theme N>=1 dialog shows the server preview numbers (ko 1440)',
    has(await modalText(darkDeep), noticeText(locale('ko').delete_modal, previews.deep)));
  await shot(darkDeep, 'deep-ko-1440-dark');
  await darkDeep.context().close();

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

  const darkLast = await newPage(browser, WIDE, webUrl, 'ko', 'dark');
  await openDelete(darkLast, 'ko', data.cases.find((item) => item.key === 'symlinkLast').nodeId);
  await darkLast.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  await shot(darkLast, 'symlinkLast-ko-1440-dark');
  await darkLast.context().close();

  const darkStays = await newPage(browser, WIDE, webUrl, 'ko', 'dark');
  let releaseStays;
  const heldStays = new Promise((resolve) => { releaseStays = resolve; });
  await darkStays.route('**/tree/*/delete-preview', async (route) => { await heldStays; await route.continue(); });
  await openDelete(darkStays, 'ko', data.cases.find((item) => item.key === 'symlink').nodeId);
  await darkStays.locator(MODAL).getByText(locale('ko').delete_modal.checking, { exact: false }).waitFor({ timeout: 3_000 });
  await shot(darkStays, 'symlink-loading-ko-1440-dark');
  releaseStays();
  await darkStays.context().close();

  await measureBehaviour({ browser, apiUrl, webUrl, data });
  await measureDeepKeyboard({ browser, webUrl, data });
  await confirmDeleteRemovesPreviewedCards({ browser, apiUrl, webUrl, data, previews });
  await confirmRemovesOtherPlaceRows({ browser, apiUrl, webUrl, data, previews });
  await confirmEmptiesOtherPlaceParent({ browser, apiUrl, webUrl, data });
}

// The preview held back (loading) and the preview failing, for one node or symlink.
async function captureWaiting({ page, lang, text, tag, item, shot, withFailure }) {
  const isLink = item.key.startsWith('symlink');
  const name = item.key === 'normal' ? '' : `${item.key}-`;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/tree/*/delete-preview', async (route) => { await held; await route.continue(); });
  await openDelete(page, lang, item.nodeId);
  await page.locator(MODAL).getByText(text.checking ?? '', { exact: false }).waitFor({ timeout: 3_000 }).catch(() => {});
  const loadingBody = await modalText(page);
  const locked = await confirmButton(page, lang).isDisabled();
  check(`while the ${item.key} preview is received the dialog says so, claims nothing about the card and the confirm button is locked (${tag})`,
    has(loadingBody, text.checking) && locked && !has(loadingBody, text.link_card_stays) && countOf(loadingBody, PERMANENT_WORD[lang]) === 0
      && (!isLink || has(loadingBody, fill(text.body_link, { name: item.name }))), loadingBody.replace(/\n/g, ' | '));
  const loading = await frameBox(page);
  await checkKoreanBreaks(page, lang, `${item.key} loading (${tag})`);
  await shot(page, `${name}loading-${lang}-${tag.split(' ')[1]}`);
  release();
  await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  check(`the ${item.key} confirm button opens once the preview arrives (${tag})`, !(await confirmButton(page, lang).isDisabled()));
  const ready = await frameBox(page);
  await closeDelete(page, lang);
  await page.unroute('**/tree/*/delete-preview');
  if (!withFailure) return { loading, ready };

  await page.route('**/tree/*/delete-preview', (route) => route.fulfill(json({ error: 'x' }, 500)));
  await openDelete(page, lang, item.nodeId);
  await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  const failedBody = await modalText(page);
  const warning = isLink ? text.cards_unknown_link : text.cards_unknown;
  check(`a failed ${item.key} preview shows the general warning and keeps the confirm button open (${tag})`,
    has(failedBody, warning) && (!isLink || has(failedBody, fill(text.body_link, { name: item.name }))) && !has(failedBody, text.link_card_stays)
      && !(await confirmButton(page, lang).isDisabled()), failedBody.replace(/\n/g, ' | '), ['17']);
  await checkKoreanBreaks(page, lang, `${item.key} failed (${tag})`);
  await shot(page, `${name}failed-${lang}-${tag.split(' ')[1]}`);
  await closeDelete(page, lang);
  await page.unroute('**/tree/*/delete-preview');
  return { loading, ready };
}

// A confirmed delete removes exactly the cards the preview announced, and nothing else.
async function confirmDeleteRemovesPreviewedCards({ browser, apiUrl, webUrl, data, previews }) {
  const alive = async () => {
    const states = await Promise.all(data.cardIds.map(async (id) => (await fetch(`${apiUrl}/cards/${id}`)).ok));
    return states.filter(Boolean).length;
  };
  for (const key of ['normal', 'symlinkLast']) {
    const item = data.cases.find((candidate) => candidate.key === key);
    const before = await alive();
    const page = await newPage(browser, WIDE, webUrl, 'en');
    await openDelete(page, 'en', item.nodeId);
    await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
    await confirmButton(page, 'en').click();
    await page.locator(MODAL).waitFor({ state: 'detached' });
    await page.locator(`[data-testid="tree-node-${item.nodeId}"]`).waitFor({ state: 'detached' });
    const after = await alive();
    check(`after confirming ${key}, ${previews[key].deleted_card_count} cards are really gone (preview said so)`,
      before - after === previews[key].deleted_card_count, `before=${before} after=${after}`);
    const linkStates = await Promise.all((item.linkNodeIds ?? []).map(async (id) => (await fetch(`${apiUrl}/tree/${id}`)).ok));
    check(`after confirming ${key}, its ${previews[key].deleted_link_count} other-place link(s) are gone from the tree`,
      linkStates.length === previews[key].deleted_link_count && linkStates.every((present) => !present), JSON.stringify(linkStates));
    await page.context().close();
  }
}

// The other place is expanded while the section is deleted: its link rows leave without a reload, the link
// of a card that stays remains, the confirm button is locked while the delete is received.
async function confirmRemovesOtherPlaceRows({ browser, apiUrl, webUrl, data, previews }) {
  const item = data.cases.find((candidate) => candidate.key === 'deep');
  const preview = previews.deep;
  const row = (nodeId) => `[data-testid="tree-node-${nodeId}"]`;
  const lang = 'ko';
  const page = await newPage(browser, WIDE, webUrl, lang);
  let navigations = 0;
  page.on('framenavigated', () => { navigations += 1; });
  await page.locator(row(data.elsewhere.nodeId)).waitFor({ timeout: 15_000 });
  const toggle = page.locator(`${row(data.elsewhere.nodeId)} > div`).first();
  await toggle.locator('svg.lucide-chevron-right, svg.lucide-chevron-down').first().waitFor({ timeout: 10_000 });
  if ((await toggle.locator('svg.lucide-chevron-right').count()) > 0) await toggle.locator('svg.lucide-chevron-right').click();
  for (const nodeId of [...data.elsewhere.linkNodeIds, data.elsewhere.keptLinkNodeId]) await page.locator(row(nodeId)).waitFor({ timeout: 10_000 });
  const navigationsBefore = navigations;
  const alive = async () => (await Promise.all(item.expected.ids.map(async (id) => (await fetch(`${apiUrl}/cards/${id}`)).ok))).filter(Boolean).length;
  const before = await alive();

  await openDelete(page, lang, item.nodeId);
  await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  const dialog = await modalText(page);
  check('before confirming, the ko dialog shows the server numbers and the link rows are on screen',
    has(dialog, noticeText(locale(lang).delete_modal, preview)) && preview.deleted_card_count === 4 && preview.deleted_link_count === 2, dialog.replace(/\n/g, ' | '));
  await shot(page, 'deep-ko-1440-other-place-before');

  let releaseDelete;
  const heldDelete = new Promise((resolve) => { releaseDelete = resolve; });
  await page.route('**/tree/*', async (route) => {
    if (route.request().method() === 'DELETE') await heldDelete;
    await route.continue();
  });
  await confirmButton(page, lang).click();
  await page.waitForFunction((selector) => [...(document.querySelector(selector)?.querySelectorAll('button') ?? [])].some((button) => button.disabled), MODAL, { timeout: 5_000 });
  const lockedWhileReceiving = await confirmButton(page, lang).isDisabled();
  const spinnerShown = (await page.locator(`${MODAL} .animate-spin`).count()) > 0;
  check('while the delete is received the confirm button is locked and shows the spinner', lockedWhileReceiving && spinnerShown, JSON.stringify({ lockedWhileReceiving, spinnerShown }));
  releaseDelete();
  await page.locator(MODAL).waitFor({ state: 'detached' });
  for (const nodeId of data.elsewhere.linkNodeIds) await page.locator(row(nodeId)).waitFor({ state: 'detached', timeout: 10_000 });
  await page.locator(row(item.nodeId)).waitFor({ state: 'detached', timeout: 10_000 });
  const keptRows = await page.locator(row(data.elsewhere.keptLinkNodeId)).count();
  const after = await alive();
  check(`after confirming, ${preview.deleted_card_count} cards are gone, the ${preview.deleted_link_count} link rows left the expanded other place without a reload, the link of the kept card stays`,
    before - after === preview.deleted_card_count && after === 0 && keptRows === 1 && navigations === navigationsBefore,
    JSON.stringify({ before, after, keptRows, navigations: navigations - navigationsBefore }));
  const keptStill = (await fetch(`${apiUrl}/cards/${data.elsewhere.keptCardId}`)).ok;
  check('the card whose link stays in the other place is still there', keptStill);
  await page.waitForTimeout(500);
  await shot(page, 'deep-ko-1440-other-place-after');
  await page.unroute('**/tree/*');
  await page.context().close();
}

// The other-place parent loses its only child: with the parent expanded, its link row leaves and the parent
// stops offering to expand, without a reload. The parent itself and its card stay.
async function confirmEmptiesOtherPlaceParent({ browser, apiUrl, webUrl, data }) {
  const emptied = data.emptied;
  const row = (nodeId) => `[data-testid="tree-node-${nodeId}"]`;
  const lang = 'ko';
  const chevrons = 'svg.lucide-chevron-right, svg.lucide-chevron-down';
  const childCount = async () => (await (await fetch(`${apiUrl}/tree/${emptied.placeNodeId}/children`)).json()).length;
  const page = await newPage(browser, WIDE, webUrl, lang);
  let navigations = 0;
  page.on('framenavigated', () => { navigations += 1; });
  const parentRow = page.locator(`${row(emptied.placeNodeId)} > div`).first();
  await page.locator(row(emptied.placeNodeId)).waitFor({ timeout: 15_000 });
  await parentRow.locator(chevrons).first().waitFor({ timeout: 10_000 });
  if ((await parentRow.locator('svg.lucide-chevron-right').count()) > 0) await parentRow.locator('svg.lucide-chevron-right').click();
  await page.locator(row(emptied.linkNodeId)).waitFor({ timeout: 10_000 });
  await parentRow.locator('svg.lucide-chevron-down').waitFor({ timeout: 5_000 });
  const navigationsBefore = navigations;
  const childrenBefore = await childCount();

  await openDelete(page, lang, emptied.sectionNodeId);
  await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  await shot(page, 'emptied-ko-1440-before');
  await confirmButton(page, lang).click();
  await page.locator(MODAL).waitFor({ state: 'detached' });
  await page.locator(row(emptied.linkNodeId)).waitFor({ state: 'detached', timeout: 10_000 });
  await page.locator(row(emptied.sectionNodeId)).waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForTimeout(500);

  const parentStays = (await page.locator(row(emptied.placeNodeId)).count()) === 1;
  const expandMarks = await parentRow.locator(chevrons).count();
  const childrenAfter = await childCount();
  const rowsUnderParent = await page.locator(`${row(emptied.placeNodeId)} [data-testid^="tree-node-"]`).count();
  check('the other-place parent loses its only child: its expand mark is gone, no row sits under it, the server lists 0 children, no reload',
    parentStays && expandMarks === 0 && rowsUnderParent === 0 && childrenBefore === 1 && childrenAfter === 0 && navigations === navigationsBefore,
    JSON.stringify({ parentStays, expandMarks, rowsUnderParent, childrenBefore, childrenAfter, navigations: navigations - navigationsBefore }));
  const cardStates = await Promise.all([emptied.sectionCardId, emptied.itemCardId, emptied.placeCardId].map(async (id) => (await fetch(`${apiUrl}/cards/${id}`)).ok));
  check('the section and its card are deleted, the other-place parent card stays', !cardStates[0] && !cardStates[1] && cardStates[2], JSON.stringify(cardStates));
  await shot(page, 'emptied-ko-1440-after');
  await page.context().close();
}

// The dialog keyboard on one target: while its preview loads, first focus is on Cancel and Tab stays there with
// confirm locked; once ready Tab reaches Delete and wraps; Esc closes and focus returns to the row; Enter on
// Cancel closes and deletes nothing.
async function measureDialogKeyboard({ browser, webUrl, data, key, label, openedBy }) {
  const item = data.cases.find((candidate) => candidate.key === key);
  const page = await newPage(browser, WIDE, webUrl, 'en');
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/tree/*/delete-preview', async (route) => { await held; await route.continue(); });
  await openDelete(page, 'en', item.nodeId);
  const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? document.activeElement?.tagName);
  const cancelLabel = locale('en').common.cancel;
  const firstFocus = await focused();
  await page.keyboard.press('Tab');
  const afterTab = await focused();
  await page.keyboard.press('Shift+Tab');
  const afterShiftTab = await focused();
  const lockedWhileLoading = await confirmButton(page, 'en').isDisabled();
  check(`${label} dialog loading: first focus is Cancel, Tab and Shift+Tab stay on it, confirm is locked`,
    firstFocus === cancelLabel && afterTab === cancelLabel && afterShiftTab === cancelLabel && lockedWhileLoading,
    JSON.stringify({ firstFocus, afterTab, afterShiftTab, lockedWhileLoading }), ['14', '15']);
  release();
  await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  const focusAfterReady = await focused();
  await page.keyboard.press('Tab');
  const confirmFocus = await focused();
  await page.keyboard.press('Tab');
  const wrapFocus = await focused();
  check(`${label} dialog ready: first focus stays on Cancel, Tab goes to Delete and wraps back to Cancel`,
    focusAfterReady === cancelLabel && confirmFocus === locale('en').delete_modal.confirm_btn && wrapFocus === cancelLabel,
    JSON.stringify({ focusAfterReady, confirmFocus, wrapFocus }), ['14', '15']);
  await page.keyboard.press('Escape');
  const closed = (await page.locator(MODAL).count()) === 0;
  const focusAfterEscape = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid'));
  const escapeBack = closed && focusAfterEscape === `tree-node-${item.nodeId}`;
  check(`${label} dialog: Esc closes it and focus goes back to the row it was opened from`, escapeBack, JSON.stringify({ closed, focusAfterEscape }), ['14', '15']);
  await page.unroute('**/tree/*/delete-preview');

  await openDelete(page, 'en', item.nodeId);
  await page.waitForFunction((selector) => !document.querySelector(selector)?.querySelector('.animate-spin'), MODAL, { timeout: 10_000 });
  const enterFocus = await focused();
  await page.keyboard.press('Enter');
  const enterClosed = (await page.locator(MODAL).count()) === 0;
  const stillThere = (await page.locator(`[data-testid="tree-node-${item.nodeId}"]`).count()) === 1;
  const focusAfterEnter = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid'));
  check(`${label} dialog: Enter on the first focus (Cancel) closes it, deletes nothing and returns focus to the row`,
    enterFocus === cancelLabel && enterClosed && stillThere && focusAfterEnter === `tree-node-${item.nodeId}`,
    JSON.stringify({ enterFocus, enterClosed, stillThere, focusAfterEnter }), ['14', '15']);
  dialogRows.push({
    target: label, openedBy, firstFocus: `${firstFocus === locale('en').common.cancel ? '취소 단추' : firstFocus}, 받는 중에는 확인 잠김`,
    enter: enterFocus === cancelLabel && enterClosed && stillThere ? '취소에서 Enter는 닫고 아무것도 지우지 않음' : '실패',
    esc: escapeBack ? '닫힘, 트리 그대로' : '실패',
    focusAfterClose: focusAfterEscape === `tree-node-${item.nodeId}` && focusAfterEnter === focusAfterEscape ? '연 행' : '실패',
  });
  await page.context().close();
}

async function measureDeepKeyboard({ browser, webUrl, data }) {
  await measureDialogKeyboard({ browser, webUrl, data, key: 'symlinkLast', label: '링크 삭제 확인창', openedBy: '링크 행 우클릭, 삭제' });
  await measureDialogKeyboard({ browser, webUrl, data, key: 'deep', label: '다른 자리 링크가 있는 노드 삭제 확인창', openedBy: '노드 행 우클릭, 삭제' });
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
  check('Escape closes the dialog', !(await page.locator(MODAL).count()), '', ['15']);
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
    JSON.stringify({ narrowAtOpen, afterNarrow, afterWide }), ['18']);
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
  check('a failed delete keeps the dialog, shows the failure and reopens the confirm button', deleteFailureShown && confirmReopened, deleteFailureBody.replace(/\n/g, ' | '), ['17']);
  await page.unroute('**/tree/*');
  await closeDelete(page, lang);
  await page.context().close();

  const longPage = await newPage(browser, NARROW, webUrl, lang);
  await openDelete(longPage, lang, leaf.nodeId);
  await waitIdle(longPage);
  const longMetrics = { ...(await boxMetrics(longPage)), pageOverflow: await overflowX(longPage) };
  check(`the longest title (${LONG_TITLE.length} chars, no spaces) does not overflow the dialog at 360`, fitsViewport(longMetrics) && longMetrics.pageOverflow <= 0, JSON.stringify(longMetrics), ['16']);
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
