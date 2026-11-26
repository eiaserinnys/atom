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
  if (envFileValue(value) === null) return 'new_password cannot be stored in the env file; avoid mixing all of \' " ` in it';
  return null;
}

/** The first quoting that the config loader (dotenv) reads back as exactly this password, or null. */
function envFileValue(password: string): string | null {
  return [password, `'${password}'`, `"${password}"`, `\`${password}\``]
    .find((candidate) => parse(`${ENV_KEY}=${candidate}`)[ENV_KEY] === password) ?? null;
}

/** Writes the password where the config loader reads it on the next start, then applies it to this process. */
export function saveAdminPassword(password: string): void {
  const file = resolveEnvFilePath();
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  fs.writeFileSync(file, updateConfigEnvContent(content, [{ key: ENV_KEY, value: envFileValue(password)! }]), 'utf8');
  process.env[ENV_KEY] = password;
}
