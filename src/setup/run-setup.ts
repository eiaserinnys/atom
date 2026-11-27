import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { getDashboardAdminPassword, resolveAuthMode } from '../api/auth-mode.js';
import {
  planPasswordSave,
  readEnvFileContent,
  unstorablePasswordMessage,
  validateNewPassword,
  type PasswordSavePlan,
} from '../api/admin-password.js';
import { resolveEnvFilePath } from '../config/load-env.js';

export const MAX_PASSWORD_ATTEMPTS = 3;
const ENV_EXAMPLE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env.example');

export interface SetupIo {
  /** stdin is a terminal, so the password can be asked for with echo off. */
  interactive: boolean;
  askHidden(question: string): Promise<string>;
  askLine(question: string): Promise<string>;
  readStdinLine(): Promise<string>;
  out(line: string): void;
  err(line: string): void;
}

export interface SetupOptions {
  passwordStdin: boolean;
}

type Checked = { plan: PasswordSavePlan } | { message: string };

/**
 * Chooses the administrator password and writes it, with a JWT_SECRET when there is none, into the env file
 * the server reads. Returns the process exit code. Neither value is ever printed.
 */
export async function runSetup(io: SetupIo, options: SetupOptions): Promise<number> {
  const envFile = resolveEnvFilePath();
  const existing = readEnvFileContent(envFile);
  const effective = { ...process.env, ...(existing === undefined ? {} : parse(existing)) };

  if (resolveAuthMode(effective) === 'oauth') {
    io.out('An OAuth provider is configured, so the administrator password is not used. Nothing was changed.');
    return 0;
  }
  if (effective['AUTH_BYPASS'] === '1') {
    io.err('AUTH_BYPASS=1 is set, and the server does not accept a password together with it. Remove AUTH_BYPASS=1, then run setup again. Nothing was changed.');
    return 1;
  }
  if (!options.passwordStdin && !io.interactive) {
    io.err('This is not a terminal, so the password cannot be asked for. Run `npm run setup` in a terminal, or pipe one line to `npm run setup -- --password-stdin`. Nothing was changed.');
    return 1;
  }
  const readsOneLine = options.passwordStdin && !io.interactive;
  if (getDashboardAdminPassword(effective) && !readsOneLine) {
    const answer = (await io.askLine('DASHBOARD_ADMIN_PASSWORD is already set. Change it? [y/N] ')).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      io.out('The administrator password was left unchanged.');
      return 0;
    }
  }

  if (options.passwordStdin && io.interactive) {
    io.err('Standard input is a terminal, so the password is asked for with echo off, as it is without --password-stdin.');
  }

  const keepsJwtSecret = Boolean(effective['JWT_SECRET']?.trim());
  const alsoSet: Record<string, string> = keepsJwtSecret ? {} : { JWT_SECRET: randomBytes(32).toString('hex') };
  const templateIfMissing = existing === undefined ? readEnvExample(io) : undefined;
  const check = (password: string): Checked => {
    const invalid = validateNewPassword(password, 'password');
    if (invalid) return { message: invalid };
    const plan = planPasswordSave(password, { alsoSet, templateIfMissing });
    return plan ? { plan } : { message: unstorablePasswordMessage('password') };
  };

  const plan = readsOneLine ? await planFromStdin(io, check) : await planFromPrompts(io, check);
  if (!plan) return 1;

  try {
    const writable = existing === undefined ? path.dirname(plan.file) : plan.file;
    fs.accessSync(writable, fs.constants.W_OK);
    fs.writeFileSync(plan.file, plan.content, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    io.err(`Could not write ${plan.file} (${(error as NodeJS.ErrnoException).code ?? 'error'}). Nothing was changed.`);
    return 1;
  }

  io.out(`${existing === undefined ? 'Created' : 'Updated'} ${plan.file}`);
  io.out('  DASHBOARD_ADMIN_PASSWORD: saved');
  io.out(`  JWT_SECRET: ${keepsJwtSecret ? 'kept as it was' : 'generated'}`);
  const saved = parse(plan.content);
  const serveStep = saved['DASHBOARD_DIR']?.trim() ? [] : [`Build the dashboard with \`pnpm --dir dashboard build\`, then set DASHBOARD_DIR=./dashboard/dist in ${plan.file}.`];
  io.out('Next:');
  [
    ...serveStep,
    'Start the server with `npm run dev` (or `npm run build`, then `npm start`).',
    `Open http://localhost:${saved['API_PORT']?.trim() || '<API_PORT>'} and enter the password. No user name is needed.`,
  ].forEach((step, index) => io.out(`  ${index + 1}. ${step}`));
  return 0;
}

function readEnvExample(io: SetupIo): string {
  const template = readEnvFileContent(ENV_EXAMPLE_PATH);
  if (template === undefined) io.out(`${ENV_EXAMPLE_PATH} was not found, so the new env file starts empty.`);
  return template ?? '';
}

async function planFromStdin(io: SetupIo, check: (password: string) => Checked): Promise<PasswordSavePlan | undefined> {
  const checked = check(await io.readStdinLine());
  if ('plan' in checked) return checked.plan;
  io.err(`${checked.message}. Nothing was changed.`);
  return undefined;
}

async function planFromPrompts(io: SetupIo, check: (password: string) => Checked): Promise<PasswordSavePlan | undefined> {
  for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS; attempt++) {
    const password = await io.askHidden('New administrator password: ');
    const checked = check(password);
    if (!('plan' in checked)) {
      io.err(`${checked.message}. Try again.`);
      continue;
    }
    if ((await io.askHidden('Confirm the password: ')) !== password) {
      io.err('The two entries do not match. Try again.');
      continue;
    }
    return checked.plan;
  }
  io.err(`No valid password after ${MAX_PASSWORD_ATTEMPTS} attempts. Nothing was changed.`);
  return undefined;
}
