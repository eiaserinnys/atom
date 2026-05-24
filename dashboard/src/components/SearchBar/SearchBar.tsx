import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal } from 'lucide-react';
import { api, type SearchResult } from '../../api/client';
import {
  buildSearchFilters,
  formatBreadcrumb,
  hasSearchFilters,
  type SearchFilterDraft,
} from './searchBarLogic';

interface SearchBarProps {
  onSelectNode: (nodeId: string) => void;
  currentNodeId?: string | null;
}

type SearchFilterState = Omit<SearchFilterDraft, 'currentNodeId'>;

const EMPTY_FILTERS: SearchFilterState = {
  scopeToCurrentNode: false,
  cardType: '',
  tagsText: '',
  sourceType: '',
  updatedAfter: '',
  updatedBefore: '',
};

export function SearchBar({ onSelectNode, currentNodeId }: SearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<SearchFilterState>(EMPTY_FILTERS);
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

  const makeFilters = (draft: SearchFilterState = filterDraft) =>
    buildSearchFilters({ ...draft, currentNodeId });

  const runSearch = async (nextQuery: string, draft: SearchFilterState = filterDraft) => {
    setLoading(true);
    try {
      const res = await api.search(nextQuery, makeFilters(draft));
      setResults(res);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const scheduleSearch = (nextQuery: string, draft: SearchFilterState = filterDraft) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!nextQuery.trim()) {
      setResults([]);
      setOpen(filtersOpen);
      return;
    }

    debounceRef.current = setTimeout(() => {
      void runSearch(nextQuery, draft);
    }, 250);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    scheduleSearch(q);
  };

  const updateFilters = (patch: Partial<SearchFilterState>) => {
    const nextDraft = { ...filterDraft, ...patch };
    setFilterDraft(nextDraft);
    if (query.trim()) scheduleSearch(query, nextDraft);
  };

  const handleSelect = (result: SearchResult) => {
    if (!result.node_id) return;
    onSelectNode(result.node_id);
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  const activeFilters = hasSearchFilters(makeFilters());
  const shouldShowPanel = open && (filtersOpen || results.length > 0 || (!loading && Boolean(query.trim())));

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="flex items-center bg-white/10 border border-white/20 rounded-[11px] px-2.5 gap-1.5">
        <Search size={16} className="text-white/60 shrink-0" aria-hidden="true" />
        <input
          className="min-w-0 flex-1 bg-transparent border-none outline-none text-white text-[15px] font-sans py-2 placeholder:text-white/40"
          type="text"
          placeholder={t('searchbar.placeholder')}
          value={query}
          onChange={handleChange}
          onFocus={() => (results.length > 0 || query.trim() || filtersOpen) && setOpen(true)}
        />
        {loading && <span className="text-muted-foreground text-base">⋯</span>}
        <button
          type="button"
          className={`relative grid size-7 place-items-center rounded-md border-none bg-transparent text-white/70 transition-colors hover:bg-white/10 hover:text-white ${filtersOpen || activeFilters ? 'bg-white/15 text-white' : ''}`}
          title={t('searchbar.filters', { defaultValue: 'Filters' })}
          aria-label={t('searchbar.filters', { defaultValue: 'Filters' })}
          aria-pressed={filtersOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setFiltersOpen((value) => !value);
            setOpen(true);
          }}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {activeFilters && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-brand" />}
        </button>
      </div>

      {shouldShowPanel && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-card border border-border rounded-md shadow-card z-[100] max-h-[26rem] overflow-y-auto">
          {filtersOpen && (
            <div className="border-b border-border p-2.5">
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  className="size-3.5 accent-brand"
                  disabled={!currentNodeId}
                  checked={filterDraft.scopeToCurrentNode && Boolean(currentNodeId)}
                  onChange={(e) => updateFilters({ scopeToCurrentNode: e.target.checked })}
                />
                <span>{t('searchbar.scope_current', { defaultValue: 'Current node' })}</span>
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  className="min-w-0 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                  aria-label={t('searchbar.card_type', { defaultValue: 'Card type' })}
                  value={filterDraft.cardType}
                  onChange={(e) => updateFilters({ cardType: e.target.value as SearchFilterState['cardType'] })}
                >
                  <option value="">{t('searchbar.type_all', { defaultValue: 'All' })}</option>
                  <option value="structure">{t('searchbar.type_structure', { defaultValue: 'Structure' })}</option>
                  <option value="knowledge">{t('searchbar.type_knowledge', { defaultValue: 'Knowledge' })}</option>
                </select>
                <input
                  className="min-w-0 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                  type="text"
                  placeholder={t('searchbar.tags', { defaultValue: 'Tags' })}
                  value={filterDraft.tagsText}
                  onChange={(e) => updateFilters({ tagsText: e.target.value })}
                />
                <input
                  className="min-w-0 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                  type="text"
                  placeholder={t('searchbar.source_type', { defaultValue: 'Source' })}
                  value={filterDraft.sourceType}
                  onChange={(e) => updateFilters({ sourceType: e.target.value })}
                />
                <label className="min-w-0 text-[11px] text-muted-foreground">
                  <span>{t('searchbar.updated_after', { defaultValue: 'Updated after' })}</span>
                  <input
                    className="mt-1 w-full min-w-0 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                    type="datetime-local"
                    value={filterDraft.updatedAfter}
                    onChange={(e) => updateFilters({ updatedAfter: e.target.value })}
                  />
                </label>
                <label className="min-w-0 text-[11px] text-muted-foreground">
                  <span>{t('searchbar.updated_before', { defaultValue: 'Updated before' })}</span>
                  <input
                    className="mt-1 w-full min-w-0 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                    type="datetime-local"
                    value={filterDraft.updatedBefore}
                    onChange={(e) => updateFilters({ updatedBefore: e.target.value })}
                  />
                </label>
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div>
              {results.map((r) => {
                const breadcrumb = formatBreadcrumb(r.node_path);
                return (
                  <div
                    key={r.node_id ?? r.card_id}
                    className={`flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted ${r.node_id ? 'cursor-pointer' : 'cursor-default opacity-70'}`}
                    onMouseDown={() => handleSelect(r)}
                  >
                    <span className="text-xs shrink-0 mt-px">
                      {r.card_type === 'structure' ? '📁' : '📄'}
                    </span>
                    {r.is_symlink && <span className="text-[10px] text-muted-foreground shrink-0 mt-[3px]">↗</span>}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                        {r.title}
                      </div>
                      {breadcrumb && (
                        <div className="text-[11px] text-brand mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                          {breadcrumb}
                        </div>
                      )}
                      {r.snippet && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                          {r.snippet}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {results.length === 0 && !loading && query && (
            <div className="p-3 text-sm text-muted-foreground text-center">
              <div>{t('searchbar.no_results')}</div>
              <div className="mt-1 text-[11px]">
                {t('searchbar.no_results_hint', { defaultValue: 'Try OR terms or filters.' })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
