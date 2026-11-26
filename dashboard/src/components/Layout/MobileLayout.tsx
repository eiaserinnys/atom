import { useState, useCallback } from 'react';
import { useAuth, BYPASS_USER_ID } from '../../hooks/useAuth';
import { TreeView } from '../TreeView/TreeView';
import { CompileView } from '../CompileView/CompileView';
import { CardDetail } from '../CardDetail/CardDetail';
import { LazySearchMotionView as SearchMotionView } from '../SearchMotionView/LazySearchMotionView';
import type { MotionNode } from '../SearchMotionView/types';
import type { SearchRequest } from '../SearchMotionView/stream';
import type { SearchMotionViewProps } from '../SearchMotionView/SearchMotionView';
import { MobileSettingsPage } from '../Config/MobileSettingsPage';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { SearchBar } from '../SearchBar/SearchBar';
interface Props {
  explorationState?: SearchMotionViewProps['explorationState'];
  selectedNodeId: string | null;
  onSelectNode(nodeId: string | null): void;
  initialSelectedNodeId?: string;
  request: SearchRequest | null;
  searchResults: MotionNode[];
  verdict: MotionNode | null;
  onSearchSelect(nodeId: string | null, verdict: MotionNode | null): void;
  onSubmitSearch(query: string, options: { rootNodeId?: string }): void;
  onResults(nodes: MotionNode[]): void;
  revealRequest?: number;
  onOpenInTree?(nodeId: string): void;
  visualSearch?: boolean;
}
export function MobileLayout({ selectedNodeId, onSelectNode, initialSelectedNodeId, request, searchResults, verdict, onSearchSelect, onSubmitSearch, onResults, revealRequest, onOpenInTree, explorationState, visualSearch = true }: Props) {
  const auth = useAuth();
  const [activeTab, setActiveTab] = useState<MobileTab>(request && visualSearch ? 'search' : 'tree');
  const [previousRequest, setPreviousRequest] = useState(request);
  if (request !== previousRequest) { setPreviousRequest(request); if (request && visualSearch) setActiveTab('search'); }
  const [searchVisited, setSearchVisited] = useState(Boolean(request));
  if (activeTab === 'search' && !searchVisited) setSearchVisited(true);
  const handleSelectNode = useCallback((nodeId: string | null) => { onSelectNode(nodeId); if (nodeId) setActiveTab('compile'); }, [onSelectNode]);
  return <div className="flex h-full flex-col overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
    <div className="flex-1 min-h-0 overflow-hidden">
      <div hidden={activeTab !== 'tree'} className="h-full"><TreeView selectedNodeId={selectedNodeId} onSelect={handleSelectNode} initialSelectedNodeId={initialSelectedNodeId} searchResults={searchResults} showLogout={false} revealRequest={revealRequest} /></div>
      <div hidden={activeTab !== 'compile'} className="h-full"><CompileView nodeId={selectedNodeId} /></div>
      <div hidden={activeTab !== 'search'} className="h-full flex flex-col">
        <div className="h-12 shrink-0 border-b border-border bg-background">
          <SearchBar currentNodeId={selectedNodeId} onSelectNode={handleSelectNode} onSubmitJevSearch={visualSearch ? onSubmitSearch : undefined} />
        </div>
        <div className="flex-1 min-h-0">{visualSearch && searchVisited && <SearchMotionView explorationState={explorationState} request={request} onResults={onResults} onSelectNode={onSearchSelect} onOpenInTree={id => { onOpenInTree?.(id); setActiveTab('tree'); }} />}</div>
      </div>
      <div hidden={activeTab !== 'detail'} className="h-full"><CardDetail nodeId={selectedNodeId} verdict={verdict} /></div>
      {activeTab === 'settings' && <div className="h-full flex flex-col"><MobileSettingsPage currentUserRole={auth.role!} currentUserEmail={auth.email ?? ''} showLogout={auth.id !== BYPASS_USER_ID} /></div>}
    </div>
    <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} showSettings={auth.role !== null} visualSearch={visualSearch} />
  </div>;
}
