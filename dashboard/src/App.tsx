import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThreePanelLayout } from './components/Layout/ThreePanelLayout';
import { TreeView } from './components/TreeView/TreeView';
import { CompileView } from './components/CompileView/CompileView';
import { CardDetail } from './components/CardDetail/CardDetail';
import { SearchBar } from './components/SearchBar/SearchBar';
import { ThemeToggle } from './components/ThemeToggle';
import { ConfigModal } from './components/Config/ConfigModal';
import { useAuth } from './hooks/useAuth';
import { useAtomEvents } from './hooks/useAtomEvents';
import { LoginPage } from './pages/LoginPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

function AppInner() {
  const { t } = useTranslation();
  const auth = useAuth();
  const initialSelectedNodeId = useRef<string | null>(
    window.location.hash.length > 1 ? window.location.hash.slice(1) : null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      window.history.replaceState(null, '', '#' + nodeId);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useAtomEvents();

  if (auth.loading) return null;
  if (!auth.authenticated) return <LoginPage />;

  const showConfigButton = auth.role && auth.role !== 'viewer';

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar with search */}
      <div className="h-12 flex items-center gap-4 px-4 border-b border-border bg-card shrink-0">
        <span className="text-xl font-bold tracking-wide text-node-user font-display shrink-0">
          atom
        </span>
        <div className="flex-1" />
        <div className="w-full max-w-[400px]">
          <SearchBar onSelectNode={(id) => handleSelectNode(id)} />
        </div>
        {showConfigButton && (
          <button
            className="text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer text-lg leading-none px-1"
            onClick={() => setIsConfigOpen(true)}
            title={t('app.settings')}
            aria-label={t('app.settings')}
          >
            ⚙️
          </button>
        )}
        <ThemeToggle />
      </div>

      {showConfigButton && (
        <ConfigModal
          isOpen={isConfigOpen}
          onClose={() => setIsConfigOpen(false)}
          currentUserRole={auth.role!}
          currentUserEmail={auth.email ?? ''}
        />
      )}

      {/* 3-panel layout */}
      <div className="flex-1 overflow-hidden">
        <ThreePanelLayout
          left={
            <TreeView
              selectedNodeId={selectedNodeId}
              onSelect={handleSelectNode}
              initialSelectedNodeId={initialSelectedNodeId.current ?? undefined}
            />
          }
          center={<CompileView nodeId={selectedNodeId} />}
          right={<CardDetail nodeId={selectedNodeId} />}
        />
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}

export default App;
