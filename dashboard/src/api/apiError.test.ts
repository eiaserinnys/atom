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
  return new ApiError(status, body.code, body.text);
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

  test('the refused save names the settings problem the server gave, once', () => {
    const reason = 'Missing required environment variables: GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL';
    const error = fromResponse(400, JSON.stringify({ error: reason, code: 'STARTUP_WOULD_FAIL' }));

    expect(describeApiError(error, tKo)).toBe(`${ko.errors.startup_would_fail} ${reason}`);
    expect(describeApiError(error, tEn)).toBe(`${en.errors.startup_would_fail} ${reason}`);
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

  test('a server text that looks like JSON or HTML is never shown', () => {
    expect(describeApiError(fromResponse(500, '{"error":"{\\"a\\":1}"}'), tEn)).toBe(en.errors.server);
  });
});

describe('locale text', () => {
  test('the Korean sentences are polite and avoid the banned marks', () => {
    Object.values(ko.errors).forEach((sentence) => {
      expect(sentence).not.toMatch(/[·―]|박/);
      expect(sentence).toMatch(/(니다|세요)\.$/);
    });
  });
});
