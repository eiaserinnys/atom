import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

interface Props {
  query: string;
  current: number;
  total: number;
  onChange: (value: string) => void;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
}

export function CompileFindBar({ query, current, total, onChange, onNavigate, onClose }: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const button = 'w-8 h-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0';
  return <div className="h-10 max-md:h-12 flex items-center px-4 gap-2 border-b border-border bg-card shrink-0">
    <div className="flex h-full min-w-0 flex-1 items-center bg-background px-3.5 gap-2.5">
      <Search size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />
      <input
        ref={input} type="text" maxLength={200} value={query} aria-label={t('compile.find_input')} data-compile-find-input
        className="min-w-0 flex-1 bg-transparent border-none outline-none text-foreground text-[14px] font-sans px-3 py-2 placeholder:text-muted-foreground"
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onNavigate(event.shiftKey ? -1 : 1); }
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        }}
      />
    </div>
    {query.trim() && <span className="text-[13px] text-muted-foreground shrink-0">{current}/{total}</span>}
    <button type="button" className={button} title={t('compile.find_previous')} aria-label={t('compile.find_previous')} onClick={() => onNavigate(-1)}><ChevronUp className="w-4 h-4" aria-hidden="true" /></button>
    <button type="button" className={button} title={t('compile.find_next')} aria-label={t('compile.find_next')} onClick={() => onNavigate(1)}><ChevronDown className="w-4 h-4" aria-hidden="true" /></button>
    <button type="button" className={button} title={t('compile.find_close')} aria-label={t('compile.find_close')} onClick={onClose}><X className="w-4 h-4" aria-hidden="true" /></button>
  </div>;
}
