import { useQuery } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import { api } from '../../api/client';
import styles from './CompileView.module.css';

interface CompileViewProps {
  nodeId: string | null;
}

export function CompileView({ nodeId }: CompileViewProps) {
  const { data: markdown, isLoading, error } = useQuery({
    queryKey: ['compile', nodeId],
    queryFn: async () => {
      const result = await api.compile(nodeId!);
      return result.markdown;
    },
    enabled: !!nodeId,
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>컴파일 문서 (BFS+2)</div>
      <div className={styles.content}>
        {!nodeId && (
          <div className={styles.empty}>노드를 선택하면 컴파일된 문서가 표시됩니다.</div>
        )}
        {isLoading && <div className={styles.status}>컴파일 중...</div>}
        {error && <div className={styles.statusError}>오류: {error.message}</div>}
        {markdown && !isLoading && (
          <div className={styles.markdownBody}>
            <Markdown>{markdown}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
