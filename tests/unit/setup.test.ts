import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'dotenv';
import { MAX_PASSWORD_ATTEMPTS, runSetup, type SetupIo } from '../../src/setup/run-setup.js';

const GOOD = 'a-good-password-1';
const originalEnv = { ...process.env };
let dir: string;
let envFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-setup-test-'));
  envFile = path.join(dir, 'atom.env');
  process.env = { ...originalEnv, ATOM_ENV_FILE: envFile };
  for (const key of ['GOOGLE_CLIENT_ID', 'SLACK_CLIENT_ID', 'DASHBOARD_ADMIN_PASSWORD', 'JWT_SECRET', 'AUTH_BYPASS']) delete process.env[key];
});
afterEach(() => {
  process.env = { ...originalEnv };
  fs.rmSync(dir, { recursive: true, force: true });
});

type FakeInput = { interactive?: boolean; hidden?: string[]; lines?: string[]; stdin?: string };

function fakeIo(input: FakeInput = {}) {
  const hidden = [...(input.hidden ?? [])];
  const lines = [...(input.lines ?? [])];
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const io: SetupIo = {
    interactive: input.interactive ?? true,
    askHidden: async (question) => {
      asked.push(question);
      const next = hidden.shift();
      if (next === undefined) throw new Error('unexpected hidden prompt');
      return next;
    },
    askLine: async (question) => {
      asked.push(question);
      return lines.shift() ?? '';
    },
    readStdinLine: async () => input.stdin ?? '',
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { io, out, err, asked, text: () => [...out, ...err, ...asked].join('\n') };
}

const readEnv = () => parse(fs.readFileSync(envFile, 'utf8'));

describe('npm run setup: a missing env file', () => {
  it('is created from .env.example with the password and a generated JWT_SECRET, readable only by the owner', async () => {
    const fake = fakeIo({ hidden: [GOOD, GOOD] });

    expect(await runSetup(fake.io, { passwordStdin: false })).toBe(0);

    const values = readEnv();
    expect(values['DASHBOARD_ADMIN_PASSWORD']).toBe(GOOD);
    expect(values['JWT_SECRET']).toMatch(/^[0-9a-f]{64}$/);
    expect(values['API_PORT']).toBe('4200');
    expect(fs.readFileSync(envFile, 'utf8')).toContain('# Optional PostgreSQL connection');
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
    expect(fake.text()).toContain(envFile);
    expect(fake.text()).toContain('http://localhost:4200');
    expect(fake.text()).toContain('No user name is needed');
    expect(fake.text()).toContain('DASHBOARD_DIR');
  });

  it('never prints the password or the JWT_SECRET', async () => {
    const fake = fakeIo({ hidden: [GOOD, GOOD] });
    await runSetup(fake.io, { passwordStdin: false });
    expect(fake.text()).not.toContain(GOOD);
    expect(fake.text()).not.toContain(readEnv()['JWT_SECRET']);

    const stdin = fakeIo({ interactive: false, stdin: 'another-good-password-2' });
    fs.rmSync(envFile);
    await runSetup(stdin.io, { passwordStdin: true });
    expect(stdin.text()).not.toContain('another-good-password-2');
    expect(stdin.text()).not.toContain(readEnv()['JWT_SECRET']);
  });
});

describe('npm run setup: an existing env file', () => {
  const ORIGINAL = '# keep this comment\nAPI_PORT=4300\nJWT_SECRET=existing-secret\nOTHER=\'two words\'\n\n# trailing note\n';

  it('keeps every other line and comment, and an existing JWT_SECRET', async () => {
    fs.writeFileSync(envFile, ORIGINAL, { mode: 0o640 });
    const fake = fakeIo({ hidden: [GOOD, GOOD] });

    expect(await runSetup(fake.io, { passwordStdin: false })).toBe(0);

    const text = fs.readFileSync(envFile, 'utf8');
    expect(text.startsWith(ORIGINAL.replace(/\n$/, ''))).toBe(true);
    expect(parse(text)).toEqual({ API_PORT: '4300', JWT_SECRET: 'existing-secret', OTHER: 'two words', DASHBOARD_ADMIN_PASSWORD: GOOD });
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o640);
  });

  it('generates a JWT_SECRET when the existing line is empty, in place', async () => {
    fs.writeFileSync(envFile, 'JWT_SECRET=\nAPI_PORT=4300\n');

    await runSetup(fakeIo({ hidden: [GOOD, GOOD] }).io, { passwordStdin: false });

    expect(readEnv()['JWT_SECRET']).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(envFile, 'utf8').split('\n').slice(0, 2)[1]).toBe('API_PORT=4300');
  });
});

describe('npm run setup: asking for the password', () => {
  it.each([
    ['too short', 'short12'],
    ['too long', 'x'.repeat(257)],
    ['only spaces', ' '.repeat(10)],
    ['with edge whitespace', ' leading-space-1'],
    ['with a quote mix dotenv cannot read back', 'a#\'b"c`d-1234'],
  ])('asks again for a password that is %s', async (_name, bad) => {
    const fake = fakeIo({ hidden: [bad, GOOD, GOOD] });

    expect(await runSetup(fake.io, { passwordStdin: false })).toBe(0);

    expect(fake.err).toHaveLength(1);
    expect(readEnv()['DASHBOARD_ADMIN_PASSWORD']).toBe(GOOD);
  });

  it('asks again when the confirmation differs', async () => {
    const fake = fakeIo({ hidden: [GOOD, 'a-different-password', 'second-password-2', 'second-password-2'] });

    expect(await runSetup(fake.io, { passwordStdin: false })).toBe(0);

    expect(fake.err.join('\n')).toContain('do not match');
    expect(readEnv()['DASHBOARD_ADMIN_PASSWORD']).toBe('second-password-2');
  });

  it(`gives up after ${MAX_PASSWORD_ATTEMPTS} failures and leaves the file as it was`, async () => {
    const before = 'API_PORT=4300\n';
    fs.writeFileSync(envFile, before);
    const fake = fakeIo({ hidden: ['bad', 'bad2', 'bad3'] });

    expect(await runSetup(fake.io, { passwordStdin: false })).toBe(1);

    expect(fs.readFileSync(envFile, 'utf8')).toBe(before);
    expect(fake.err.join('\n')).toContain('Nothing was changed');
  });

  it('writes no file when every attempt fails on a missing env file', async () => {
    expect(await runSetup(fakeIo({ hidden: ['bad', 'bad', 'bad'] }).io, { passwordStdin: false })).toBe(1);
    expect(fs.existsSync(envFile)).toBe(false);
  });
});

describe('npm run setup --password-stdin', () => {
  it('takes the password from standard input without asking or confirming', async () => {
    const fake = fakeIo({ interactive: false, stdin: GOOD });

    expect(await runSetup(fake.io, { passwordStdin: true })).toBe(0);

    expect(fake.asked).toEqual([]);
    expect(readEnv()['DASHBOARD_ADMIN_PASSWORD']).toBe(GOOD);
  });

  it('rejects an invalid password at once and changes nothing', async () => {
    const fake = fakeIo({ interactive: false, stdin: 'short' });

    expect(await runSetup(fake.io, { passwordStdin: true })).toBe(1);

    expect(fs.existsSync(envFile)).toBe(false);
    expect(fake.err.join('\n')).toContain('8 to 256 characters');
  });

  it('with no terminal and no option says what to do and changes nothing', async () => {
    const fake = fakeIo({ interactive: false });

    expect(await runSetup(fake.io, { passwordStdin: false })).toBe(1);

    expect(fs.existsSync(envFile)).toBe(false);
    expect(fake.err.join('\n')).toContain('--password-stdin');
  });
});

describe('npm run setup --password-stdin on a terminal', () => {
  const WITH_PASSWORD = 'DASHBOARD_ADMIN_PASSWORD=old-password-1\nJWT_SECRET=kept-secret\n';

  it('asks twice with echo off instead of reading a visible line, and says so on standard error', async () => {
    const fake = fakeIo({ interactive: true, hidden: [GOOD, GOOD], stdin: 'must-not-be-read-1' });

    expect(await runSetup(fake.io, { passwordStdin: true })).toBe(0);

    expect(fake.asked).toEqual(['New administrator password: ', 'Confirm the password: ']);
    expect(fake.err.join('\n')).toContain('Standard input is a terminal');
    expect(readEnv()['DASHBOARD_ADMIN_PASSWORD']).toBe(GOOD);
    expect(fake.text()).not.toContain(GOOD);
    expect(fake.text()).not.toContain(readEnv()['JWT_SECRET']);
  });

  it('asks again when the confirmation differs and gives up after three failures', async () => {
    const again = fakeIo({ interactive: true, hidden: [GOOD, 'a-different-password', 'second-password-2', 'second-password-2'] });
    expect(await runSetup(again.io, { passwordStdin: true })).toBe(0);
    expect(again.err.join('\n')).toContain('do not match');
    expect(readEnv()['DASHBOARD_ADMIN_PASSWORD']).toBe('second-password-2');

    fs.rmSync(envFile);
    const giveUp = fakeIo({ interactive: true, hidden: ['bad', 'bad2', 'bad3'] });
    expect(await runSetup(giveUp.io, { passwordStdin: true })).toBe(1);
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it('asks whether to change an existing password, as it does without the option', async () => {
    fs.writeFileSync(envFile, WITH_PASSWORD);
    const declined = fakeIo({ interactive: true, lines: [''] });
    expect(await runSetup(declined.io, { passwordStdin: true })).toBe(0);
    expect(fs.readFileSync(envFile, 'utf8')).toBe(WITH_PASSWORD);

    const accepted = fakeIo({ interactive: true, lines: ['y'], hidden: [GOOD, GOOD] });
    expect(await runSetup(accepted.io, { passwordStdin: true })).toBe(0);
    expect(readEnv()['DASHBOARD_ADMIN_PASSWORD']).toBe(GOOD);
  });

  it('still reads one line from a pipe or a file without asking', async () => {
    const fake = fakeIo({ interactive: false, stdin: GOOD });

    expect(await runSetup(fake.io, { passwordStdin: true })).toBe(0);

    expect(fake.asked).toEqual([]);
    expect(fake.err).toEqual([]);
    expect(readEnv()['DASHBOARD_ADMIN_PASSWORD']).toBe(GOOD);
  });
});

describe('npm run setup: when auth is already set', () => {
  const WITH_PASSWORD = 'DASHBOARD_ADMIN_PASSWORD=old-password-1\nJWT_SECRET=kept-secret\n';

  it('leaves an existing password alone by default', async () => {
    fs.writeFileSync(envFile, WITH_PASSWORD);

    expect(await runSetup(fakeIo({ lines: [''] }).io, { passwordStdin: false })).toBe(0);

    expect(fs.readFileSync(envFile, 'utf8')).toBe(WITH_PASSWORD);
  });

  it('changes an existing password after a yes, keeping the JWT_SECRET', async () => {
    fs.writeFileSync(envFile, WITH_PASSWORD);

    expect(await runSetup(fakeIo({ lines: ['y'], hidden: [GOOD, GOOD] }).io, { passwordStdin: false })).toBe(0);

    expect(readEnv()).toEqual({ DASHBOARD_ADMIN_PASSWORD: GOOD, JWT_SECRET: 'kept-secret' });
  });

  it('treats --password-stdin as a yes', async () => {
    fs.writeFileSync(envFile, WITH_PASSWORD);
    const fake = fakeIo({ interactive: false, stdin: GOOD });

    expect(await runSetup(fake.io, { passwordStdin: true })).toBe(0);

    expect(fake.asked).toEqual([]);
    expect(readEnv()['DASHBOARD_ADMIN_PASSWORD']).toBe(GOOD);
  });

  it.each([
    ['in the env file', () => fs.writeFileSync(envFile, 'GOOGLE_CLIENT_ID=google-client\n')],
    ['in the environment', () => { process.env['SLACK_CLIENT_ID'] = 'slack-client'; }],
  ])('changes nothing and exits 0 when an OAuth provider is configured %s', async (_where, configure) => {
    configure();
    const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : undefined;
    const fake = fakeIo({ hidden: [GOOD, GOOD] });

    expect(await runSetup(fake.io, { passwordStdin: false })).toBe(0);

    expect(fake.out.join('\n')).toContain('OAuth');
    expect(fake.asked).toEqual([]);
    expect(fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : undefined).toBe(before);
  });

  it('refuses while AUTH_BYPASS=1 is set, because the server would not start with both', async () => {
    fs.writeFileSync(envFile, 'AUTH_BYPASS=1\n');

    expect(await runSetup(fakeIo({ hidden: [GOOD, GOOD] }).io, { passwordStdin: false })).toBe(1);

    expect(fs.readFileSync(envFile, 'utf8')).toBe('AUTH_BYPASS=1\n');
  });
});

describe('npm run setup: when the file cannot be written', () => {
  it('says so and changes nothing', async () => {
    process.env['ATOM_ENV_FILE'] = path.join(dir, 'missing-folder', 'atom.env');
    const fake = fakeIo({ hidden: [GOOD, GOOD] });

    expect(await runSetup(fake.io, { passwordStdin: false })).toBe(1);

    expect(fake.err.join('\n')).toContain('Could not write');
    expect(fs.existsSync(path.join(dir, 'missing-folder'))).toBe(false);
  });
});
