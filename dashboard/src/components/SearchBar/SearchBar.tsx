import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Folder, Search, SlidersHorizontal } from 'lucide-react';
import { api, type SearchResult } from '../../api/client';
import { Spinner } from '../Spinner';
import {
  buildSearchFilters,
  formatBreadcrumb,
  hasSearchFilters,
  snippetParts,
  type SearchFilterDraft,
} from './searchBarLogic';

interface SearchBarProps {
  onSelectNode: (nodeId: string) => void;
  currentNodeId?: string | null;
  onSubmitJevSearch?: (query: string, options: { rootNodeId?: string }) => void;
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

export function SearchBar({ onSelectNode, currentNodeId, onSubmitJevSearch }: SearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<SearchFilterState>(EMPTY_FILTERS);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLFormElement>(null);
  const composingRef = useRef(false);
  const requestVersion = useRef(0);
  const invalidateSearch = useCallback(() => {
    requestVersion.current += 1;
  }, []);
  const closeResults = useCallback(() => {
    invalidateSearch();
    setLoading(false);
    setOpen(false);
  }, [invalidateSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeResults();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closeResults]);

  const makeFilters = (draft: SearchFilterState = filterDraft) =>
    buildSearchFilters({ ...draft, currentNodeId });

  const runSearch = async (nextQuery: string, draft: SearchFilterState = filterDraft) => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const res = await api.search(nextQuery, makeFilters(draft));
      if (version !== requestVersion.current) return;
      setResults(res);
      setOpen(true);
    } catch {
      if (version === requestVersion.current) setResults([]);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  const scheduleSearch = (nextQuery: string, draft: SearchFilterState = filterDraft) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    invalidateSearch();
    if (!nextQuery.trim()) {
      setResults([]);
      setOpen(filtersOpen);
      setLoading(false);
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
    closeResults();
    onSelectNode(result.node_id);
    setQuery('');
    setResults([]);
  };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); requestVersion.current += 1; }, []);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (composingRef.current || !query.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const filters = makeFilters();
    const { rootNodeId, ...bm25 } = filters;
    if (hasSearchFilters(bm25) || !onSubmitJevSearch) { void runSearch(query.trim()); return; }
    closeResults();
    onSubmitJevSearch(query.trim(), { rootNodeId });
  };

  const activeFilters = hasSearchFilters(makeFilters());
  const shouldShowPanel = open && (filtersOpen || results.length > 0 || (!loading && Boolean(query.trim())));

  return (
    <form className="relative h-full w-full" ref={containerRef} onSubmit={submit}>
      <div className="flex h-full w-full items-center bg-background px-3.5 gap-2.5">
        <Search size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />
        <input
          className="min-w-0 flex-1 bg-transparent border-none outline-none text-foreground text-[14px] font-sans px-3 py-2 placeholder:text-muted-foreground"
          type="text"
          enterKeyHint="search"
          placeholder={t('searchbar.placeholder')}
          value={query}
          onChange={handleChange}
          aria-label={t('searchbar.placeholder')}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || composingRef.current)) e.preventDefault(); if (e.key === 'Escape') closeResults(); }}
          onFocus={() => (results.length > 0 || query.trim() || filtersOpen) && setOpen(true)}
        />
        {loading && <Spinner size="sm" label={t('common.loading')} />}
        <button
          type="button"
          className={`relative grid size-7 place-items-center rounded-none border-none bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${filtersOpen || activeFilters ? 'bg-muted text-foreground' : ''}`}
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
          {activeFilters && <span className="absolute right-1 top-1 size-1.5 rounded-none bg-brand" />}
        </button>
        <button type="submit" className="index-action bg-foreground text-background">{t('common.search')}</button>
      </div>

      {shouldShowPanel && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-card border border-border rounded-none shadow-card z-[100] max-h-[26rem] overflow-y-auto">
          {filtersOpen && (
            <div className="border-b border-border p-2.5">
              <label className="flex items-center gap-2 text-[13px] text-foreground">
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
                  className="min-w-0 rounded-none border border-border bg-input px-2 py-1.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                  aria-label={t('searchbar.card_type', { defaultValue: 'Card type' })}
                  value={filterDraft.cardType}
                  onChange={(e) => updateFilters({ cardType: e.target.value as SearchFilterState['cardType'] })}
                >
                  <option value="">{t('searchbar.type_all', { defaultValue: 'All' })}</option>
                  <option value="structure">{t('searchbar.type_structure', { defaultValue: 'Structure' })}</option>
                  <option value="knowledge">{t('searchbar.type_knowledge', { defaultValue: 'Knowledge' })}</option>
                </select>
                <input
                  className="min-w-0 rounded-none border border-border bg-input px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                  type="text"
                  placeholder={t('searchbar.tags', { defaultValue: 'Tags' })}
                  value={filterDraft.tagsText}
                  onChange={(e) => updateFilters({ tagsText: e.target.value })}
                />
                <input
                  className="min-w-0 rounded-none border border-border bg-input px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                  type="text"
                  placeholder={t('searchbar.source_type', { defaultValue: 'Source' })}
                  value={filterDraft.sourceType}
                  onChange={(e) => updateFilters({ sourceType: e.target.value })}
                />
                <label className="min-w-0 text-[13px] text-muted-foreground">
                  <span>{t('searchbar.updated_after', { defaultValue: 'Updated after' })}</span>
                  <input
                    className="mt-1 w-full min-w-0 rounded-none border border-border bg-input px-2 py-1.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                    type="datetime-local"
                    value={filterDraft.updatedAfter}
                    onChange={(e) => updateFilters({ updatedAfter: e.target.value })}
                  />
                </label>
                <label className="min-w-0 text-[13px] text-muted-foreground">
                  <span>{t('searchbar.updated_before', { defaultValue: 'Updated before' })}</span>
                  <input
                    className="mt-1 w-full min-w-0 rounded-none border border-border bg-input px-2 py-1.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
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
                  <button
                    type="button"
                    key={r.node_id ?? r.card_id}
                    className={`w-full text-left flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted ${r.node_id ? 'cursor-pointer' : 'cursor-default opacity-70'}`}
                    onClick={() => handleSelect(r)}
                  >
                    {r.card_type === 'structure'
                      ? <Folder className="w-3.5 h-3.5 text-[var(--blue)] shrink-0 mt-0.5" strokeWidth={1.75} />
                      : <FileText className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" strokeWidth={1.75} />}
                    {r.is_symlink && <span className="text-[13px] text-muted-foreground shrink-0 mt-[3px]">↗</span>}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                        {r.title}
                      </div>
                      {breadcrumb && (
                        <div className="text-[13px] text-brand mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                          {breadcrumb}
                        </div>
                      )}
                      {r.snippet && (
                        <div className="text-[13px] text-muted-foreground mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                          {snippetParts(r.snippet).map((part, index) => part.match
                            ? <strong key={index} className="font-semibold text-foreground">{part.text}</strong>
                            : <span key={index}>{part.text}</span>)}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {results.length === 0 && !loading && query && (
            <div className="p-3 text-sm text-muted-foreground text-center">
              <div>{t('searchbar.no_results')}</div>
              <div className="mt-1 text-[13px]">
                {t('searchbar.no_results_hint', { defaultValue: 'Try OR terms or filters.' })}
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
