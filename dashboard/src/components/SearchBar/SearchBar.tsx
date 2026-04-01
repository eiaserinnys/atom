import { useState, useRef, useEffect } from 'react';
import { api, type SearchResult } from '../../api/client';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  onSelectNode: (nodeId: string) => void;
}

export function SearchBar({ onSelectNode }: SearchBarProps) {
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
    <div className={styles.wrapper} ref={containerRef}>
      <div className={styles.inputRow}>
        <span className={styles.searchIcon}>⌕</span>
        <input
          className={styles.input}
          type="text"
          placeholder="검색..."
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && <span className={styles.spinner}>⋯</span>}
      </div>

      {open && results.length > 0 && (
        <div className={styles.dropdown}>
          {results.map((r) => (
            <div
              key={r.node_id}
              className={styles.resultItem}
              onMouseDown={() => handleSelect(r)}
            >
              <span className={styles.resultType}>
                {r.card_type === 'structure' ? '📁' : '📄'}
              </span>
              {r.is_symlink && <span className={styles.symlinkIcon}>↗</span>}
              <div className={styles.resultText}>
                <div className={styles.resultTitle}>{r.title}</div>
                {r.snippet && (
                  <div className={styles.resultSnippet}>{r.snippet}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && results.length === 0 && !loading && query && (
        <div className={styles.dropdown}>
          <div className={styles.noResults}>결과 없음</div>
        </div>
      )}
    </div>
  );
}
