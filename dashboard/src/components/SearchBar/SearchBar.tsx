import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type SearchResult } from '../../api/client';

interface SearchBarProps {
  onSelectNode: (nodeId: string) => void;
}

export function SearchBar({ onSelectNode }: SearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.search(q);
        setResults(res);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  const handleSelect = (result: SearchResult) => {
    onSelectNode(result.node_id);
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="flex items-center bg-white/10 border border-white/20 rounded-[11px] px-2.5 gap-1.5">
        <span className="text-white/60 text-base shrink-0">⌕</span>
        <input
          className="flex-1 bg-transparent border-none outline-none text-white text-[15px] font-sans py-2 placeholder:text-white/40"
          type="text"
          placeholder={t('searchbar.placeholder')}
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && <span className="text-muted-foreground text-base">⋯</span>}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-card border border-border rounded-md shadow-card z-[100] max-h-80 overflow-y-auto">
          {results.map((r) => (
            <div
              key={r.node_id}
              className="flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-muted"
              onMouseDown={() => handleSelect(r)}
            >
              <span className="text-xs shrink-0 mt-px">
                {r.card_type === 'structure' ? '📁' : '📄'}
              </span>
              {r.is_symlink && <span className="text-[10px] text-node-plan shrink-0 mt-[3px]">↗</span>}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                  {r.title}
                </div>
                {r.snippet && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                    {r.snippet}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && results.length === 0 && !loading && query && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-card border border-border rounded-md shadow-card z-[100]">
          <div className="p-3 text-sm text-muted-foreground text-center">{t('searchbar.no_results')}</div>
        </div>
      )}
    </div>
  );
}
