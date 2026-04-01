import { useState } from 'react';
import { ThreePanelLayout } from './components/Layout/ThreePanelLayout';
import { TreeView } from './components/TreeView/TreeView';
import { CompileView } from './components/CompileView/CompileView';
import { CardDetail } from './components/CardDetail/CardDetail';
import { SearchBar } from './components/SearchBar/SearchBar';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import styles from './App.module.css';

function App() {
  const auth = useAuth();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

export default App;
