import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const out = process.argv[2];
if (!out) throw new Error('Usage: node e2e/visual/locales.mjs <output directory>');
mkdirSync(out, { recursive: true });
const workspace = mkdtempSync(path.join(tmpdir(), 'atom-locales-'));
const results = [];
let server;
const record = (name, detail) => { results.push([name, detail]); console.log(name, detail); };
const port = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
try {
  cpSync(path.join(root, 'src'), path.join(workspace, 'src'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'));
  writeFileSync(path.join(workspace, 'package.json'), '{"type":"module"}');
  const envFile = path.join(workspace, 'visual.env');
  writeFileSync(envFile, 'JWT_SECRET=visual-check-secret\nDASHBOARD_ADMIN_PASSWORD=visual-pass-0\n');
  const build = spawnSync(process.execPath, [path.join(root, 'dashboard/node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(workspace, 'dist'), '--emptyOutDir'], { cwd: path.join(root, 'dashboard'), encoding: 'utf8', timeout: 240000 });
  if (build.status !== 0) throw Error(`build: ${build.stderr}`);
  const db = path.join(workspace, 'demo.db');
  const seed = spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/seed-demo.ts')], { cwd: root, env: { PATH: process.env.PATH, SQLITE_PATH: db }, encoding: 'utf8', timeout: 60000 });
  if (seed.status !== 0) throw Error(`seed: ${seed.stderr}`);
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'src/api/index.ts'], { cwd: workspace, env: { PATH: process.env.PATH, NODE_ENV: 'development', API_PORT: String(port), SQLITE_PATH: db, FRONTEND_URL: url, ATOM_ENV_FILE: envFile, DASHBOARD_DIR: path.join(workspace, 'dist'), TYPESAFE_API_KEY: 'visual-check-key', TYPESAFE_BASE_URL: 'http://127.0.0.1:1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
  for (let n = 0; n < 100; n++) { if (server.exitCode !== null) throw Error(logs); try { if ((await fetch(`${url}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 300)); }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  try {
    for (const lang of ['ja', 'zh']) for (const width of [1440, 390]) {
      const t = JSON.parse(readFileSync(path.join(root, `dashboard/src/locales/${lang}/translation.json`)));
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
      await context.addInitScript((l) => { localStorage.setItem('language', l); localStorage.setItem('theme', 'light'); }, lang);
      const page = await context.newPage();
      const shot = async (name) => {
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, `${lang}-${width}-${name}.png`) });
        const info = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, keys: [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /^(visual_search|common|users|card|config|login|auth)\.[a-z_]+$/.test(e.textContent.trim())).map(e => e.textContent.trim()) }));
        record(`${lang} ${width} ${name}`, `수평 넘침 ${info.overflow}px, 노출 키 ${JSON.stringify(info.keys)}`);
      };
      const attempt = async (name, fn) => { try { await fn(); await shot(name); } catch (e) { record(`${lang} ${width} ${name}`, `미확인: ${e.message.split('\n')[0]}`); } };
      await page.goto(url);
      await attempt('login', async () => { await page.getByTestId('password-login-input').waitFor(); });
      await page.getByTestId('password-login-input').fill('visual-pass-0');
      await page.getByTestId('password-login-button').click();
      await page.locator('[data-testid="tree-list"]').waitFor({ timeout: 15000 });
      await attempt('tree', async () => {});
      await attempt('card', async () => { await page.locator('[data-testid^="tree-node-"] > div').first().click(); if (width === 390) await page.getByRole('tab', { name: t.mobile.tab_detail }).click(); });
      await attempt('settings', async () => { if (width === 390) await page.getByRole('tab', { name: t.mobile.tab_settings }).last().click(); else await page.locator(`[aria-label="${t.config.settings}"]`).first().click(); });
      await attempt('language', async () => { await page.locator(`nav[aria-label="${t.config.settings}"]`).getByRole('button', { name: t.config.tab_language, exact: true }).click(); });
      await attempt('visual', async () => { if (width === 390) await page.getByRole('tab', { name: t.mobile.tab_search }).click(); else { await page.keyboard.press('Escape'); await page.getByRole('tab', { name: t.visual_search.title }).click(); } const input = page.locator(width === 390 ? 'form input[type=text]' : '.index-search input[type=text]').first(); await input.fill('PostgreSQL'); await input.press('Enter'); await page.waitForTimeout(1800); });
      await context.close();
    }
  } finally { await browser.close(); }
} catch (error) { record('실행 오류', error.stack); process.exitCode = 1; }
finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  rmSync(workspace, { recursive: true, force: true });
  writeFileSync(path.join(out, 'operations.md'), `# 다국어 화면 조작 결과\n\n독립 SQLite 데모와 암호 로그인 서버, 빌드된 대시보드에서 실행. 화면별 수평 넘침과 노출 사전 키를 측정했다.\n\n| 화면 | 측정 / 결과 |\n|---|---|\n${results.map(([a,b]) => `| ${a} | ${b.replaceAll('\n',' ')} |`).join('\n')}\n\n영문 낙하와 겹침은 캡처 육안 확인이 필요하다. UI 기준 14–18의 키보드·초점·입력 조작은 별도로 측정하지 않았다.\n`);
}
