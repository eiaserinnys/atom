import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThreePanelLayout } from './components/Layout/ThreePanelLayout';
import { TreeView } from './components/TreeView/TreeView';
import { CompileView } from './components/CompileView/CompileView';
import { CardDetail } from './components/CardDetail/CardDetail';
import { SearchBar } from './components/SearchBar/SearchBar';
import { ThemeToggle } from './components/ThemeToggle';
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
  const auth = useAuth();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useAtomEvents();

  if (auth.loading) return null;
  if (!auth.authenticated) return <LoginPage />;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar with search */}
      <div className="h-12 flex items-center gap-4 px-4 border-b border-border bg-card shrink-0">
        <span className="text-xl font-bold tracking-wide text-node-user font-display shrink-0">
          atom
        </span>
        <div className="flex-1" />
        <div className="w-full max-w-[400px]">
          <SearchBar onSelectNode={setSelectedNodeId} />
        </div>
        <ThemeToggle />
      </div>

      {/* 3-panel layout */}
      <div className="flex-1 overflow-hidden">
        <ThreePanelLayout
          left={
            <TreeView
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
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
