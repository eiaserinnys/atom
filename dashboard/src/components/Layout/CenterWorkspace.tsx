import { CompileView } from '../CompileView/CompileView';
import { useState } from 'react';
import { LazySearchMotionView as SearchMotionView } from '../SearchMotionView/LazySearchMotionView';
import type { SearchRequest } from '../SearchMotionView/stream';
import type { MotionNode } from '../SearchMotionView/types';
import { CenterTabs, type CenterMode } from './CenterTabs';
interface Props {
  nodeId: string | null;
  mode: CenterMode;
  onModeChange(mode: CenterMode): void;
  request: SearchRequest | null;
  onSelectNode(nodeId: string, verdict: MotionNode): void;
  onResults(nodes: MotionNode[]): void;
  onOpenInTree?(nodeId: string): void;
}
export function CenterWorkspace({ nodeId, mode, onModeChange, request, onSelectNode, onResults, onOpenInTree }: Props) {
  const [searchVisited, setSearchVisited] = useState(mode === 'search');
  if (mode === 'search' && !searchVisited) setSearchVisited(true);
  const tabs = <CenterTabs mode={mode} onChange={onModeChange} />;
  return <div className="h-full min-h-0 flex flex-col">
    <div className="h-full min-h-0" hidden={mode !== 'compile'}>
      <CompileView nodeId={nodeId} headerTabs={tabs} />
    </div>
    <div className="h-full min-h-0 flex flex-col" hidden={mode !== 'search'}>
      <div className="h-10 px-3.5 flex items-center justify-between border-b border-border bg-card shrink-0">
        {tabs}
      </div>
      <div className="flex-1 min-h-0">{searchVisited && <SearchMotionView request={request} onSelectNode={onSelectNode} onResults={onResults} onOpenInTree={onOpenInTree} />}</div>
    </div>
  </div>;
}
