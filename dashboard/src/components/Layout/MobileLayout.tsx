import { useState, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { TreeView } from '../TreeView/TreeView';
import { CompileView } from '../CompileView/CompileView';
import { CardDetail } from '../CardDetail/CardDetail';
import { MobileSettingsPage } from '../Config/MobileSettingsPage';
import { MobileTabBar, type MobileTab } from './MobileTabBar';

interface Props {
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  initialSelectedNodeId?: string;
}

export function MobileLayout({ selectedNodeId, onSelectNode, initialSelectedNodeId }: Props) {
  const auth = useAuth();
  const [activeTab, setActiveTab] = useState<MobileTab>('tree');

  const showSettings = auth.role !== null && auth.role !== 'viewer';

  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      onSelectNode(nodeId);
      if (nodeId) setActiveTab('compile'); // 노드 선택 시 컴파일 탭으로 자동 전환
    },
    [onSelectNode]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* tree/compile/detail: unmount 방지 (display:none) */}
      <div
        style={{ display: activeTab === 'tree' ? 'flex' : 'none' }}
        className="flex-1 flex-col overflow-hidden pb-14"
      >
        <TreeView
          selectedNodeId={selectedNodeId}
          onSelect={handleSelectNode}
          initialSelectedNodeId={initialSelectedNodeId}
        />
      </div>
      <div
        style={{ display: activeTab === 'compile' ? 'flex' : 'none' }}
        className="flex-1 flex-col overflow-hidden pb-14"
      >
        <CompileView nodeId={selectedNodeId} />
      </div>
      <div
        style={{ display: activeTab === 'detail' ? 'flex' : 'none' }}
        className="flex-1 flex-col overflow-hidden pb-14"
      >
        <CardDetail nodeId={selectedNodeId} />
      </div>

      {/* settings: lazy mount (activeTab === 'settings' 시에만 마운트, API 즉시 발화 방지) */}
      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto pb-14">
          <MobileSettingsPage
            currentUserRole={auth.role!}
            currentUserEmail={auth.email ?? ''}
          />
        </div>
      )}

      <MobileTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        showSettings={showSettings}
      />
    </div>
  );
}
