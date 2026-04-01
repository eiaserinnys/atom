import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { api } from '../../api/client';
import styles from './CompileView.module.css';

interface CompileViewProps {
  nodeId: string | null;
}

export function CompileView({ nodeId }: CompileViewProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeId) {
      setMarkdown(null);
      return;
    }
    setLoading(true);
    setError(null);
    api.compile(nodeId)
      .then((res) => setMarkdown(res.markdown))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [nodeId]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>컴파일 문서 (BFS+2)</div>
      <div className={styles.content}>
        {!nodeId && (
          <div className={styles.empty}>노드를 선택하면 컴파일된 문서가 표시됩니다.</div>
        )}
        {loading && <div className={styles.status}>컴파일 중...</div>}
        {error && <div className={styles.statusError}>오류: {error}</div>}
        {markdown && !loading && (
          <div className={styles.markdownBody}>
            <Markdown>{markdown}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
