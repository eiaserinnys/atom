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

export function formatJournalLimitLabel(journalLimit: number | null | undefined): string | null {
  if (journalLimit === null || journalLimit === undefined) {
    return null;
  }

  return `최근 ${journalLimit === 0 ? '전체' : `${journalLimit}개`}`;
}

export function isHttpSourceRef(sourceRef: string): boolean {
  return /^https?:\/\//.test(sourceRef);
}
