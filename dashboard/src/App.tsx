import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThreePanelLayout } from './components/Layout/ThreePanelLayout';
import { TreeView } from './components/TreeView/TreeView';
import { CompileView } from './components/CompileView/CompileView';
import { CardDetail } from './components/CardDetail/CardDetail';
import { SearchBar } from './components/SearchBar/SearchBar';
import { ThemeToggle } from './components/ThemeToggle';
import { configApi } from './api/client';
import { ConfigModal } from './components/Config/ConfigModal';
import { RestartBanner } from './components/RestartBanner';
import { ReconnectOverlay } from './components/ReconnectOverlay';
import { useAuth } from './hooks/useAuth';
import { useAtomEvents } from './hooks/useAtomEvents';
import { SystemProvider } from './contexts/SystemContext';
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
  const [dbType, setDbType] = useState<'postgres' | 'sqlite' | null>(null);

  useEffect(() => {
    if (!auth.authenticated) return;
    configApi.getDbInfo()
      .then((data) => { if (data?.dbType) setDbType(data.dbType as 'postgres' | 'sqlite'); })
      .catch(() => {});
  }, [auth.authenticated]);

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
      <RestartBanner />
      <ReconnectOverlay />
      {/* Top bar with search */}
      <div className="h-12 flex items-center gap-4 px-4 border-b border-border bg-card shrink-0">
        <span className="text-xl font-bold tracking-wide text-node-user font-display shrink-0">
          atom
        </span>
        {dbType && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
              dbType === 'postgres'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-yellow-500/10 text-yellow-400'
            }`}
            title={dbType === 'postgres' ? 'PostgreSQL' : 'SQLite'}
          >
            {dbType === 'postgres' ? '🟢 PG' : '🟡 SQLite'}
          </span>
        )}
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
      <SystemProvider>
        <AppInner />
      </SystemProvider>
    </QueryClientProvider>
  );
}

export default App;
