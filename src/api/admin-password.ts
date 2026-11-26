import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { parse } from 'dotenv';
import { updateConfigEnvContent } from './config/env-file.js';
import { getDashboardAdminPassword, resolveAuthMode } from './auth-mode.js';
import { resolveEnvFilePath } from '../config/load-env.js';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;
const ENV_KEY = 'DASHBOARD_ADMIN_PASSWORD';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();

export function matchesAdminPassword(candidate: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(getDashboardAdminPassword()!));
}

export function passwordSessionBinding(password: string): string {
  return createHmac('sha256', process.env['JWT_SECRET']!)
    .update(`atom-password-session\0${password}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

/** The value password-mode tokens must carry; undefined outside password mode, where tokens are not bound. */
export function currentSessionBinding(): string | undefined {
  return resolveAuthMode() === 'password' ? passwordSessionBinding(getDashboardAdminPassword()!) : undefined;
}

export function sessionBindingMatches(claim: unknown): boolean {
  const expected = currentSessionBinding();
  if (expected === undefined) return true;
  if (typeof claim !== 'string') return false;
  const given = Buffer.from(claim);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export function validateNewPassword(value: unknown, label = 'new_password'): string | null {
  if (typeof value !== 'string') return `${label} must be a string`;
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    return `${label} must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (value.trim() !== value) return `${label} must not start or end with whitespace`;
  if (/[\r\n]/.test(value)) return `${label} must not contain line breaks`;
  return null;
}

export const unstorablePasswordMessage = (label = 'new_password') =>
  `${label} cannot be stored in the env file as written; avoid starting it with a quote or mixing all of ' " \` in it`;

export const UNSTORABLE_PASSWORD_MESSAGE = unstorablePasswordMessage();

export type PasswordSavePlan = { file: string; content: string };

/** The file's text, or undefined when it does not exist. */
export function readEnvFileContent(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function sameOtherKeys(before: Record<string, string>, after: Record<string, string>, owned: string[]): boolean {
  const keys = (values: Record<string, string>) => Object.keys(values).filter((key) => !owned.includes(key)).sort();
  const kept = keys(before);
  const now = keys(after);
  return kept.length === now.length && kept.every((key, index) => key === now[index] && before[key] === after[key]);
}

export type PasswordSaveOptions = {
  /** Other values that must read back exactly as given (unquoted), e.g. a generated JWT_SECRET. */
  alsoSet?: Record<string, string>;
  /** Starting content when the env file does not exist yet. */
  templateIfMissing?: string;
};

/**
 * The whole env file as it would be written, using the first quoting for which the config loader (dotenv)
 * reads back this password and leaves every other key untouched; null when no quoting does.
 * The whole file is parsed because dotenv's quoted values run across lines.
 */
export function planPasswordSave(password: string, options: PasswordSaveOptions = {}): PasswordSavePlan | null {
  const file = resolveEnvFilePath();
  const original = readEnvFileContent(file) ?? options.templateIfMissing ?? '';
  const before = parse(original);
  const alsoSet = Object.entries(options.alsoSet ?? {});
  const owned = [ENV_KEY, ...alsoSet.map(([key]) => key)];
  for (const written of [password, `'${password}'`, `"${password}"`, `\`${password}\``]) {
    const content = updateConfigEnvContent(original, [
      { key: ENV_KEY, value: written },
      ...alsoSet.map(([key, value]) => ({ key, value })),
    ]);
    const after = parse(content);
    if (
      after[ENV_KEY] === password &&
      alsoSet.every(([key, value]) => after[key] === value) &&
      sameOtherKeys(before, after, owned)
    ) return { file, content };
  }
  return null;
}

/** Writes the planned env file where the config loader reads it on the next start, then applies the password to this process. */
export function saveAdminPassword(password: string, plan: PasswordSavePlan): void {
  fs.writeFileSync(plan.file, plan.content, 'utf8');
  process.env[ENV_KEY] = password;
}
