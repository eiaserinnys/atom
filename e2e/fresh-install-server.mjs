// Starts the fresh-install server the way a new install is set up: build the dashboard so the API serves it from
// one origin (the login cookie needs that), write an env file, let `npm run setup -- --password-stdin` add the
// password and JWT_SECRET to it, then run the API on that file. Started by playwright.config.ts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const testDir = process.env.ATOM_E2E_DIR;
const repoDir = fs.readFileSync(path.join(testDir, '.atom-e2e'), 'utf8');
const envFile = path.join(testDir, 'fresh.env');
const dashboardDir = path.join(testDir, 'fresh-dashboard');

execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', dashboardDir, '--emptyOutDir'], {
  cwd: path.join(repoDir, 'dashboard'),
  env: { PATH: process.env.PATH },
  stdio: ['ignore', 'ignore', 'inherit'],
});
fs.writeFileSync(envFile, [
  'API_PORT=14201',
  `DASHBOARD_DIR=${dashboardDir}`,
  `SQLITE_PATH=${path.join(testDir, 'fresh.db')}`,
  'NODE_ENV=test',
  '',
].join('\n'));
execFileSync(process.execPath, ['--import', 'tsx', 'src/setup/main.ts', '--password-stdin'], {
  cwd: repoDir,
  env: { PATH: process.env.PATH, ATOM_ENV_FILE: envFile },
  input: `${process.env.ATOM_E2E_FRESH_PASSWORD}\n`,
  stdio: ['pipe', 'ignore', 'inherit'],
});

process.env.ATOM_ENV_FILE = envFile;
await import(pathToFileURL(path.join(testDir, 'src/api/index.ts')).href);
