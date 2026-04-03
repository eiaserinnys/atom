import type { UnfurlEntry } from '../api/client';
import type { TrelloCardUnfurlData } from '../types/unfurl';
import { TrelloCardView } from './TrelloCardView';

interface UnfurlSectionProps {
  unfurlData: Record<string, unknown> | null | undefined;
  sourceType: string;
  error?: string;
}

export function UnfurlSection({ unfurlData, sourceType, error }: UnfurlSectionProps) {
  if (error || !unfurlData) {
    return (
      <div className="text-xs text-node-error mt-1">
        ⚠️ 외부 참조 조회 실패{error ? `: ${error}` : ''}
      </div>
    );
  }

  if (sourceType === 'trello') {
    return <TrelloCardView data={unfurlData as unknown as TrelloCardUnfurlData} />;
  }

  return (
    <pre className="text-xs bg-muted border border-border rounded p-2 overflow-x-auto">
      {JSON.stringify(unfurlData, null, 2)}
    </pre>
  );
}

interface UnfurlSectionListProps {
  unfurls: Record<string, UnfurlEntry>;
}

export function UnfurlSectionList({ unfurls }: UnfurlSectionListProps) {
  const entries = Object.entries(unfurls);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2 mt-3">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        외부 참조 ({entries.length})
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
