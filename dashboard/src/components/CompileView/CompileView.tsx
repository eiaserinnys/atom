import { useQuery } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import { api } from '../../api/client';

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
    <div className="h-full flex flex-col bg-background border-r border-border">
      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground border-b border-border shrink-0">
        컴파일 문서 (BFS+2)
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!nodeId && (
          <div className="text-muted-foreground text-sm">노드를 선택하면 컴파일된 문서가 표시됩니다.</div>
        )}
        {isLoading && <div className="text-muted-foreground text-sm">컴파일 중...</div>}
        {error && <div className="text-node-error text-sm">오류: {error.message}</div>}
        {markdown && !isLoading && (
          <div className="
            text-foreground text-base leading-[1.7]
            [&_h1]:mt-[1.4em] [&_h1]:mb-[0.4em] [&_h1]:font-semibold [&_h1]:text-[1.4em]
            [&_h2]:mt-[1.4em] [&_h2]:mb-[0.4em] [&_h2]:font-semibold [&_h2]:text-[1.2em]
            [&_h3]:mt-[1.4em] [&_h3]:mb-[0.4em] [&_h3]:font-semibold [&_h3]:text-[1.05em]
            [&_h4]:mt-[1.4em] [&_h4]:mb-[0.4em] [&_h4]:font-semibold
            [&_p]:mb-[0.8em]
            [&_ul]:mb-[0.8em] [&_ul]:pl-6
            [&_ol]:mb-[0.8em] [&_ol]:pl-6
            [&_li]:mb-[0.2em]
            [&_code]:font-mono [&_code]:text-[0.88em] [&_code]:bg-muted [&_code]:border [&_code]:border-border [&_code]:rounded [&_code]:px-[0.35em] [&_code]:py-[0.1em]
            [&_pre]:bg-card [&_pre]:border [&_pre]:border-border [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:mb-[1em]
            [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0 [&_pre_code]:text-[0.88em]
            [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:ml-0 [&_blockquote]:mb-[0.8em] [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
            [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border [&_hr]:my-4
            [&_a]:text-node-user [&_a]:no-underline hover:[&_a]:underline
          ">
            <Markdown>{markdown}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
