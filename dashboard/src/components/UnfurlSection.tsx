import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { UnfurlEntry } from '../api/client';
import type { TrelloCardUnfurlData } from '../types/unfurl';
import { TrelloCardView } from './TrelloCardView';

interface UnfurlSectionProps {
  unfurlData: Record<string, unknown> | null | undefined;
  sourceType: string;
  error?: string;
}

export function UnfurlSection({ unfurlData, sourceType, error }: UnfurlSectionProps) {
  const { t } = useTranslation();
  if (error || !unfurlData) {
    return (
      <div className="text-[13px] text-[var(--amber)] mt-1">
        <AlertTriangle className="w-3.5 h-3.5 inline-block mr-1 align-text-bottom" strokeWidth={1.75} />{t('unfurl.failure')}{error ? `: ${error}` : ''}
      </div>
    );
  }

  if (sourceType === 'trello') {
    return <TrelloCardView data={unfurlData as unknown as TrelloCardUnfurlData} />;
  }

  return (
    <pre className="text-[13px] bg-muted border border-border rounded-none p-2 overflow-x-auto">
      {JSON.stringify(unfurlData, null, 2)}
    </pre>
  );
}

interface UnfurlSectionListProps {
  unfurls: Record<string, UnfurlEntry>;
}

export function UnfurlSectionList({ unfurls }: UnfurlSectionListProps) {
  const { t } = useTranslation();
  const entries = Object.entries(unfurls);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2 mt-3">
      <div className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider">
        {t('unfurl.section_title')} ({entries.length})
      </div>
      {entries.map(([cardId, entry]) => (
        <UnfurlSection
          key={cardId}
          unfurlData={entry.ok ? entry.data : null}
          sourceType={entry.sourceType}
          error={entry.ok ? undefined : entry.error}
        />
      ))}
    </div>
  );
}
