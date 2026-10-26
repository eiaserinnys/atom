import { describe, expect, test } from 'vitest';
import {
  formatJournalLimitLabel,
  isHttpSourceRef,
  parseJournalLimitDraft,
} from './cardDetailLogic';

describe('parseJournalLimitDraft', () => {
  test('maps an empty draft to an unlimited null value', () => {
    expect(parseJournalLimitDraft('')).toEqual({ type: 'save', value: null });
    expect(parseJournalLimitDraft('   ')).toEqual({ type: 'save', value: null });
  });

  test('maps non-negative numeric drafts to save values', () => {
    expect(parseJournalLimitDraft('0')).toEqual({ type: 'save', value: 0 });
    expect(parseJournalLimitDraft('12')).toEqual({ type: 'save', value: 12 });
    expect(parseJournalLimitDraft(' 7 ')).toEqual({ type: 'save', value: 7 });
  });

  test('ignores invalid or negative drafts', () => {
    expect(parseJournalLimitDraft('abc')).toEqual({ type: 'ignore' });
    expect(parseJournalLimitDraft('-1')).toEqual({ type: 'ignore' });
  });
});

describe('formatJournalLimitLabel', () => {
  test('uses translated labels for all and limited states', () => {
    const t = (key: 'card.journal_limit_all' | 'card.journal_limit_latest', options?: { count: number }) =>
      options ? `${key}:${options.count}` : key;

    expect(formatJournalLimitLabel(null, t)).toBe('card.journal_limit_all');
    expect(formatJournalLimitLabel(0, t)).toBe('card.journal_limit_all');
    expect(formatJournalLimitLabel(5, t)).toBe('card.journal_limit_latest:5');
  });
});

describe('isHttpSourceRef', () => {
  test('matches the existing lowercase http and https source_ref link rule', () => {
    expect(isHttpSourceRef('http://example.com')).toBe(true);
    expect(isHttpSourceRef('https://example.com')).toBe(true);
    expect(isHttpSourceRef('ftp://example.com')).toBe(false);
    expect(isHttpSourceRef('HTTP://example.com')).toBe(false);
    expect(isHttpSourceRef('notes/local-file.md')).toBe(false);
  });
});
