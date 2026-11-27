import i18next, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, test } from 'vitest';
import en from '../locales/en/translation.json';
import ko from '../locales/ko/translation.json';
import { ApiError, VersionConflictError, describeApiError, parseErrorBody } from './apiError';

let tEn: TFunction;
let tKo: TFunction;

beforeAll(async () => {
  const english = i18next.createInstance();
  await english.init({ lng: 'en', resources: { en: { translation: en } } });
  const korean = i18next.createInstance();
  await korean.init({ lng: 'ko', fallbackLng: 'en', resources: { ko: { translation: ko }, en: { translation: en } } });
  tEn = english.t;
  tKo = korean.t;
});

function fromResponse(status: number, raw: string): ApiError {
  const body = parseErrorBody(raw);
  return new ApiError(status, body.code, body.text, { reason: body.reason, keys: body.keys });
}

function refusedSave(reason: string, keys: string[]): ApiError {
  return fromResponse(400, JSON.stringify({
    error: 'No login method is configured, so the server will not start.', code: 'STARTUP_WOULD_FAIL', reason, keys,
  }));
}

const RAW_LOOKING = [/[{}]/, /API \d{3}/, /<\/?[a-z]/i];
function expectPlainSentence(text: string) {
  RAW_LOOKING.forEach((pattern) => expect(text).not.toMatch(pattern));
}

describe('parseErrorBody', () => {
  test('{ error, code } gives the code and the text', () => {
    expect(parseErrorBody('{"error":"Node not found: x","code":"NODE_NOT_FOUND"}'))
      .toMatchObject({ code: 'NODE_NOT_FOUND', text: 'Node not found: x' });
  });

  test('{ error: string } is text, and an error that is itself a code is the code', () => {
    expect(parseErrorBody('{"error":"Body must be an array"}')).toMatchObject({ code: undefined, text: 'Body must be an array' });
    expect(parseErrorBody('{"error":"VERSION_CONFLICT","current_version":4}'))
      .toMatchObject({ code: 'VERSION_CONFLICT', text: undefined, fields: { current_version: 4 } });
  });

  test('{ error: { code } } gives the code only', () => {
    expect(parseErrorBody('{"error":{"code":"OPENAI_KEY_DB_ONLY"}}')).toMatchObject({ code: 'OPENAI_KEY_DB_ONLY', text: undefined });
  });

  test("Fastify's { statusCode, error, message } gives the message", () => {
    expect(parseErrorBody('{"statusCode":400,"error":"Bad Request","message":"body must be array"}'))
      .toMatchObject({ code: undefined, text: 'body must be array' });
  });

  test.each(['', 'broken', '<html><body>502</body></html>', '[1,2]', 'null', '{"error":"{\\"nested\\":1}"}'])(
    'yields neither code nor text for %j', (raw) => {
      const body = parseErrorBody(raw);
      expect(body.code).toBeUndefined();
      expect(body.text).toBeUndefined();
    },
  );
});

describe('describeApiError', () => {
  test('a known code shows its locale text in each language', () => {
    expect(describeApiError(fromResponse(409, '{"error":"VERSION_CONFLICT","code":"VERSION_CONFLICT"}'), tEn)).toBe(en.card.unsaved_changes);
    expect(describeApiError(new VersionConflictError(3), tKo)).toBe(ko.card.unsaved_changes);
    expect(describeApiError(fromResponse(400, '{"error":"x","code":"SAME_PASSWORD"}'), tKo)).toBe(ko.auth.password_same);
    expect(describeApiError(fromResponse(401, '{"error":"x","code":"INVALID_CURRENT_PASSWORD"}'), tKo)).toBe(ko.auth.password_wrong_current);
    expect(describeApiError(fromResponse(401, '{"error":"x","code":"SESSION_INVALID"}'), tEn)).toBe(en.auth.password_session_lost);
  });

  test.each([
    ['no_login_method', []],
    ['oauth_and_bypass', ['AUTH_BYPASS', 'GOOGLE_CLIENT_ID']],
    ['password_and_bypass', ['AUTH_BYPASS', 'DASHBOARD_ADMIN_PASSWORD']],
  ])('a refused save for %s says the server will not start once, then the reason in the same language', (reason, keys) => {
    const expectedKo = `${ko.errors.startup_would_fail} ${ko.errors.startup_reason[reason as keyof typeof ko.errors.startup_reason]}`;
    const expectedEn = `${en.errors.startup_would_fail} ${en.errors.startup_reason[reason as keyof typeof en.errors.startup_reason]}`;
    expect(describeApiError(refusedSave(reason, keys), tKo)).toBe(expectedKo);
    expect(describeApiError(refusedSave(reason, keys), tEn)).toBe(expectedEn);
    expect(expectedKo.match(/다시 뜨지 않/g)).toHaveLength(1);
    expect(expectedKo).not.toMatch(/will not start|would not start/);
    expect(expectedEn.match(/would not start|will not start/g)).toHaveLength(1);
  });

  test('a refused save for missing keys names them as the server listed them', () => {
    const error = refusedSave('missing_keys', ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']);
    expect(describeApiError(error, tKo)).toBe(`${ko.errors.startup_would_fail} GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL 설정이 빠져 있습니다.`);
    expect(describeApiError(error, tEn))
      .toBe(`${en.errors.startup_would_fail} Missing required settings: GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL.`);
  });

  test.each([
    ['an unknown kind', refusedSave('something_new', ['JWT_SECRET'])],
    ['no kind', refusedSave('', [])],
    ['missing keys with no key list', refusedSave('missing_keys', [])],
    ['a key list that is not key names', refusedSave('missing_keys', ['{"a":1}', 'a secret value']) ],
  ])('a refused save with %s shows only the first sentence', (_name, error) => {
    expect(describeApiError(error, tKo)).toBe(ko.errors.startup_would_fail);
    expect(describeApiError(error, tEn)).toBe(en.errors.startup_would_fail);
  });

  test('a missing node or card shows the plain not-found sentence', () => {
    expect(describeApiError(fromResponse(404, '{"error":"Card not found: 1234","code":"CARD_NOT_FOUND"}'), tKo)).toBe(ko.errors.not_found);
  });

  test('an unknown code shows the server text as it is', () => {
    expect(describeApiError(fromResponse(409, '{"error":"agent_id already exists: bot","code":"ALREADY_EXISTS"}'), tEn)).toBe('agent_id already exists: bot');
    expect(describeApiError(fromResponse(400, '{"statusCode":400,"error":"Bad Request","message":"body must be array"}'), tEn)).toBe('body must be array');
  });

  test.each([
    [400, 'broken', 'failed'],
    [403, '', 'forbidden'],
    [404, '<html>Not Found</html>', 'not_found'],
    [429, '{}', 'busy'],
    [500, '<html>boom</html>', 'server'],
    [502, '', 'server'],
  ] as const)('a %i with body %j gives the plain %s sentence', (status, raw, key) => {
    const text = describeApiError(fromResponse(status, raw), tKo);
    expect(text).toBe(ko.errors[key]);
    expectPlainSentence(text);
  });

  test('a failure that is not an API answer (network, redirect) gives the plain sentence', () => {
    expect(describeApiError(new TypeError('Failed to fetch'), tEn)).toBe(en.errors.failed);
    expect(describeApiError('nothing', tEn)).toBe(en.errors.failed);
  });

  test.each([
    [500, '{"statusCode":500,"error":"Internal Server Error","message":"SQLITE_ERROR: no such table: cards"}'],
    [500, '{"error":"Failed to write .env: EACCES: permission denied, open \'/srv/atom/.env\'"}'],
    [503, '{"error":"Database is down at 10.0.0.5","code":"DB_DOWN"}'],
  ])('a %i with a server text never shows that text, only the plain server sentence', (status, raw) => {
    const text = describeApiError(fromResponse(status, raw), tEn);
    expect(text).toBe(en.errors.server);
    expect(text).not.toMatch(/SQLITE|EACCES|\/srv|10\.0/);
  });

  test('a 5xx that carries a known code still shows that code\'s locale text', () => {
    expect(describeApiError(fromResponse(500, '{"error":"x","code":"STARTUP_WOULD_FAIL"}'), tEn)).toBe(en.errors.startup_would_fail);
  });

  test('a server text that looks like JSON or HTML is never shown', () => {
    expect(describeApiError(fromResponse(500, '{"error":"{\\"a\\":1}"}'), tEn)).toBe(en.errors.server);
  });
});

describe('locale text', () => {
  test('the Korean sentences are polite and avoid the banned marks', () => {
    Object.values({ ...ko.errors, ...ko.errors.startup_reason }).filter((value) => typeof value === 'string').forEach((sentence) => {
      expect(sentence).not.toMatch(/[·―]|박/);
      expect(sentence).toMatch(/(니다|세요)\.$/);
    });
  });
});
