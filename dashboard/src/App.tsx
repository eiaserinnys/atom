import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThreePanelLayout } from './components/Layout/ThreePanelLayout';
import { MobileLayout } from './components/Layout/MobileLayout';
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
import { useMobile } from './hooks/useMobile';
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

  const isMobile = useMobile();

  if (auth.loading) return null;
  if (!auth.authenticated) return <LoginPage />;

  const showConfigButton = auth.role && auth.role !== 'viewer';

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <RestartBanner />
      <ReconnectOverlay />
      {/* Top bar — 항상 다크 글라스 (라이트/다크 무관) */}
      <div
        className="h-12 flex items-center gap-4 px-4 shrink-0"
        style={{
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        }}
      >
        <span className="text-sm font-semibold text-white tracking-[-0.28px] font-sans shrink-0">
          atom
        </span>
        {dbType && (
          <span
            className="text-[11px] font-medium text-white/70 bg-white/[0.12] rounded-[5px] px-2 py-0.5 shrink-0 leading-none"
            title={dbType === 'postgres' ? 'PostgreSQL' : 'SQLite'}
          >
            {dbType === 'postgres' ? 'postgre' : 'sqlite'}
          </span>
        )}
        <div className="flex-1" />
        <div className="w-full max-w-[400px]">
          <SearchBar onSelectNode={(id) => handleSelectNode(id)} />
        </div>
        {/* 모바일에서는 설정 버튼 숨김 (설정 탭으로 접근) */}
        {!isMobile && showConfigButton && (
          <button
            className="text-white/70 hover:text-white bg-transparent hover:bg-white/10 border-none cursor-pointer text-lg leading-none px-2 py-1 rounded-md transition-colors"
            onClick={() => setIsConfigOpen(true)}
            title={t('app.settings')}
            aria-label={t('app.settings')}
          >
            ⚙️
          </button>
        )}
        <ThemeToggle />
      </div>

      {/* 모바일에서는 ConfigModal 마운트 자체를 방지 (MobileSettingsPage로 대체) */}
      {!isMobile && showConfigButton && (
        <ConfigModal
          isOpen={isConfigOpen}
          onClose={() => setIsConfigOpen(false)}
          currentUserRole={auth.role!}
          currentUserEmail={auth.email ?? ''}
        />
      )}

      {/* 레이아웃: 모바일 = 하단 탭바, 데스크탑 = 3패널 */}
      <div className="flex-1 overflow-hidden">
        {isMobile ? (
          <MobileLayout
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            initialSelectedNodeId={initialSelectedNodeId.current ?? undefined}
          />
        ) : (
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
        )}
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
