export type JournalLimitDraftResult =
  | { type: 'save'; value: number | null }
  | { type: 'ignore' };

export function parseJournalLimitDraft(draft: string): JournalLimitDraftResult {
  const value = draft.trim();

  if (value === '') {
    return { type: 'save', value: null };
  }

  const parsed = parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    return { type: 'ignore' };
  }

  return { type: 'save', value: parsed };
}

export function formatJournalLimitLabel(
  journalLimit: number | null | undefined,
  t: (key: 'card.journal_limit_all' | 'card.journal_limit_latest', options?: { count: number }) => string,
): string {
  if (journalLimit === null || journalLimit === undefined || journalLimit === 0) {
    return t('card.journal_limit_all');
  }

  return t('card.journal_limit_latest', { count: journalLimit });
}

export function isHttpSourceRef(sourceRef: string): boolean {
  return /^https?:\/\//.test(sourceRef);
}
