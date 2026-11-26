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

export function validateNewPassword(value: unknown): string | null {
  if (typeof value !== 'string') return 'new_password must be a string';
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    return `new_password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (value.trim() !== value) return 'new_password must not start or end with whitespace';
  if (/[\r\n]/.test(value)) return 'new_password must not contain line breaks';
  return null;
}

export const UNSTORABLE_PASSWORD_MESSAGE =
  'new_password cannot be stored in the env file as written; avoid starting it with a quote or mixing all of \' " ` in it';

export type PasswordSavePlan = { file: string; content: string };

function readEnvFileContent(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function sameOtherKeys(before: Record<string, string>, after: Record<string, string>): boolean {
  const keys = (values: Record<string, string>) => Object.keys(values).filter((key) => key !== ENV_KEY).sort();
  const kept = keys(before);
  const now = keys(after);
  return kept.length === now.length && kept.every((key, index) => key === now[index] && before[key] === after[key]);
}

/**
 * The whole env file as it would be written, using the first quoting for which the config loader (dotenv)
 * reads back this password and leaves every other key untouched; null when no quoting does.
 * The whole file is parsed because dotenv's quoted values run across lines.
 */
export function planPasswordSave(password: string): PasswordSavePlan | null {
  const file = resolveEnvFilePath();
  const original = readEnvFileContent(file);
  const before = parse(original);
  for (const written of [password, `'${password}'`, `"${password}"`, `\`${password}\``]) {
    const content = updateConfigEnvContent(original, [{ key: ENV_KEY, value: written }]);
    const after = parse(content);
    if (after[ENV_KEY] === password && sameOtherKeys(before, after)) return { file, content };
  }
  return null;
}

/** Writes the planned env file where the config loader reads it on the next start, then applies the password to this process. */
export function saveAdminPassword(password: string, plan: PasswordSavePlan): void {
  fs.writeFileSync(plan.file, plan.content, 'utf8');
  process.env[ENV_KEY] = password;
}
