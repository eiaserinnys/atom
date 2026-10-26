import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { ThreePanelLayout, type LayoutWidths } from './components/Layout/ThreePanelLayout';
import { MobileLayout } from './components/Layout/MobileLayout';
import { CenterWorkspace } from './components/Layout/CenterWorkspace';
import type { CenterMode } from './components/Layout/CenterTabs';
import { TreeView } from './components/TreeView/TreeView';
import { CardDetail } from './components/CardDetail/CardDetail';
import { SearchBar } from './components/SearchBar/SearchBar';
import { ThemeToggle } from './components/ThemeToggle';
import { PanelState } from './components/PanelState';
import { Spinner } from './components/Spinner';
import { ConfigModal } from './components/Config/ConfigModal';
import { RestartBanner } from './components/RestartBanner';
import { ReconnectOverlay } from './components/ReconnectOverlay';
import { useAuth } from './hooks/useAuth';
import { useAtomEvents } from './hooks/useAtomEvents';
import { useMobile } from './hooks/useMobile';
import { SystemProvider } from './contexts/SystemContext';
import { LoginPage } from './pages/LoginPage';
import type { MotionNode } from './components/SearchMotionView/types';
import type { SearchRequest } from './components/SearchMotionView/stream';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } });
function AppInner() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [initialSelectedNodeId] = useState(() => window.location.hash.slice(1) || undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [widths, setWidths] = useState<LayoutWidths | null>(null);
  const [request, setRequest] = useState<SearchRequest | null>(() => {
    const query = new URLSearchParams(location.search).get('q');
    return query ? { query, requestId: 1 } : null;
  });
  const [centerMode, setCenterMode] = useState<CenterMode>(request ? 'search' : 'compile');
  const [searchResults, setSearchResults] = useState<MotionNode[]>([]);
  const [selectionVerdict, setSelectionVerdict] = useState<MotionNode | null>(null);
  const verdict = selectionVerdict ?? searchResults.find(n => n.nodeId === selectedNodeId) ?? null;
  const handleSearchResults = useCallback((nodes: MotionNode[]) => {
    const nextVerdict = verdict ? nodes.find(n => n.nodeId === verdict.nodeId) ?? null : null;
    setSearchResults(nodes);
    setSelectionVerdict(nextVerdict);
    if (verdict?.sample && !nextVerdict) setSelectedNodeId(null);
  }, [verdict]);
  const isMobile = useMobile();
  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId); setSelectionVerdict(null);
    const url = new URL(location.href); url.hash = nodeId ?? '';
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);
  const selectSearchNode = useCallback((nodeId: string, verdict: MotionNode) => {
    setSelectedNodeId(nodeId); setSelectionVerdict(verdict);
    if (!verdict.sample) { const url = new URL(location.href); url.hash = nodeId; window.history.replaceState(null, '', url); }
  }, []);
  const submitSearch = useCallback((query: string, options: { rootNodeId?: string }) => {
    setSelectionVerdict(null);
    setSearchResults([]);
    if (verdict?.sample) setSelectedNodeId(null);
    setCenterMode('search');
    setRequest(previous => ({ query, rootNodeId: options.rootNodeId, requestId: (previous?.requestId ?? 0) + 1 }));
  }, [verdict]);
  // Sample node IDs are scoped to the preset; never send them to mutation or compile APIs.
  const actualNodeId = verdict?.sample && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(selectedNodeId ?? '') ? null : selectedNodeId;
  useAtomEvents(actualNodeId);
  if (auth.loading) return <div className="h-dvh bg-background"><PanelState><Spinner label={t('common.loading')} /></PanelState></div>;
  if (!auth.authenticated) return <LoginPage />;
  const showConfigButton = auth.role !== null;
  return <SystemProvider><div className="h-dvh flex flex-col bg-background text-foreground overflow-hidden">
    <RestartBanner /><ReconnectOverlay />
    <header className="index-header">
      <div className="index-brand" style={{ width: isMobile ? undefined : widths?.leftPx ?? '25%' }}>atom</div>
      <div className="index-search" data-header-search><SearchBar currentNodeId={actualNodeId} onSelectNode={handleSelectNode} onSubmitJevSearch={submitSearch} /></div>
      <div className="index-actions" style={{ width: isMobile ? undefined : widths?.rightPx ?? '30%' }}>
        {!isMobile && showConfigButton && <button className="index-action w-8 h-8 !p-0 text-muted-foreground hover:text-foreground transition-colors shrink-0" onClick={() => setIsConfigOpen(true)} aria-label={t('app.settings')}>
          <Settings className="w-4 h-4" strokeWidth={1.75} />
        </button>}
        <ThemeToggle />
      </div>
    </header>
    {!isMobile && showConfigButton && <ConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} currentUserRole={auth.role!} currentUserEmail={auth.email ?? ''} />}
    <main className="flex-1 min-h-0 overflow-hidden">
      {isMobile ? <MobileLayout selectedNodeId={actualNodeId} onSelectNode={handleSelectNode} initialSelectedNodeId={initialSelectedNodeId} request={request} searchResults={searchResults} verdict={verdict} onSearchSelect={selectSearchNode} onResults={handleSearchResults} /> :
        <ThreePanelLayout onLayoutWidthsChange={setWidths}
          left={<TreeView selectedNodeId={actualNodeId} onSelect={handleSelectNode} initialSelectedNodeId={initialSelectedNodeId} searchResults={searchResults} />}
          center={<CenterWorkspace nodeId={actualNodeId} mode={centerMode} onModeChange={setCenterMode} request={request} onSelectNode={selectSearchNode} onResults={handleSearchResults} />}
          right={<CardDetail nodeId={actualNodeId} verdict={verdict} />} />}
    </main>
  </div></SystemProvider>;
}
function App() { return <QueryClientProvider client={queryClient}><AppInner /></QueryClientProvider>; }
export default App;
