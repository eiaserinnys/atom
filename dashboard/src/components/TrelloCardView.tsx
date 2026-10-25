import type { TrelloCardUnfurlData } from '../types/unfurl';
import { Calendar, CheckCircle2, User } from 'lucide-react';

interface TrelloCardViewProps {
  data: TrelloCardUnfurlData;
}

const TRELLO_LABEL_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
  blue: 'bg-blue-500',
  sky: 'bg-sky-400',
  lime: 'bg-lime-400',
  pink: 'bg-pink-400',
  black: 'bg-zinc-700',
};

export function TrelloCardView({ data }: TrelloCardViewProps) {
  const dueDate = data.due ? new Date(data.due) : null;
  const dueDateStr = dueDate
    ? dueDate.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="rounded-none border border-border bg-card p-3 text-sm space-y-2">
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-foreground hover:underline leading-snug"
      >
        {data.name}
      </a>

      {data.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.labels.map((label, i) => (
            <span
              key={i}
              className={`inline-block px-2 py-0.5 rounded-none text-[13px] font-medium text-primary-foreground ${TRELLO_LABEL_COLORS[label.color] ?? 'bg-muted-foreground'}`}
            >
              {label.name || label.color}
            </span>
          ))}
        </div>
      )}

      {data.desc && (
        <p className="text-muted-foreground text-[13px] leading-snug whitespace-pre-wrap line-clamp-3">
          {data.desc}
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-[13px] text-muted-foreground">
        {data.members.length > 0 && (
          <span><User className="w-3.5 h-3.5 inline-block mr-1 align-text-bottom" strokeWidth={1.75} />{data.members.map((m) => m.fullName).join(', ')}</span>
        )}
        {dueDateStr && (
          <span className={data.dueComplete ? 'text-brand' : ''}>
            {data.dueComplete
              ? <CheckCircle2 className="w-3.5 h-3.5 inline-block mr-1 align-text-bottom" strokeWidth={1.75} />
              : <Calendar className="w-3.5 h-3.5 inline-block mr-1 align-text-bottom" strokeWidth={1.75} />}
            {dueDateStr}
          </span>
        )}
      </div>

      {data.checklists.length > 0 && (
        <div className="space-y-1.5">
          {data.checklists.map((cl, i) => {
            const total = cl.items.length;
            const done = cl.items.filter((it) => it.state === 'complete').length;
            return (
              <div key={i}>
                <div className="flex items-center justify-between text-[13px] font-medium text-foreground mb-1">
                  <span>{cl.name}</span>
                  <span className="text-muted-foreground">{done}/{total}</span>
                </div>
                <div className="h-1 rounded-none bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-none bg-primary transition-all"
                    style={{ width: total > 0 ? `${(done / total) * 100}%` : '0%' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
