import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThreePanelLayout } from './components/Layout/ThreePanelLayout';
import { TreeView } from './components/TreeView/TreeView';
import { CompileView } from './components/CompileView/CompileView';
import { CardDetail } from './components/CardDetail/CardDetail';
import { SearchBar } from './components/SearchBar/SearchBar';
import { useAuth } from './hooks/useAuth';
import { useAtomEvents } from './hooks/useAtomEvents';
import { LoginPage } from './pages/LoginPage';
import styles from './App.module.css';

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
    <div className={styles.appShell}>
      {/* Top bar with search */}
      <div className={styles.topBar}>
        <span className={styles.logo}>atom</span>
        <div className={styles.searchWrapper}>
          <SearchBar onSelectNode={setSelectedNodeId} />
        </div>
      </div>

      {/* 3-panel layout */}
      <div className={styles.panels}>
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
