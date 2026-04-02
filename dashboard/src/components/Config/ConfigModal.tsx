import { useState, useEffect } from 'react';
import type { UserRole } from '../../hooks/useAuth';
import { UserManagementTab } from './UserManagementTab';
import { AgentManagementTab } from './AgentManagementTab';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUserRole: UserRole;
  currentUserEmail: string;
}

export function ConfigModal({ isOpen, onClose, currentUserRole, currentUserEmail }: Props) {
  const [activeTab, setActiveTab] = useState<'users' | 'agents'>(
    currentUserRole === 'admin' ? 'users' : 'agents'
  );

  // role이 바뀌면 기본 탭 재설정
  useEffect(() => {
    if (currentUserRole !== 'admin' && activeTab === 'users') {
      setActiveTab('agents');
    }
  }, [currentUserRole, activeTab]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="text-base font-semibold text-foreground">설정</span>
          <button
            className="text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer text-lg leading-none"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-border shrink-0">
          {currentUserRole === 'admin' && (
            <button
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'users'
                  ? 'border-node-user text-node-user'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab('users')}
            >
              사용자 관리
            </button>
          )}
          <button
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'agents'
                ? 'border-node-user text-node-user'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('agents')}
          >
            API 키 관리
          </button>
        </div>

        {/* 탭 컨텐츠 */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'users' && currentUserRole === 'admin' && (
            <UserManagementTab currentUserEmail={currentUserEmail} />
          )}
          {activeTab === 'agents' && <AgentManagementTab />}
        </div>
      </div>
    </div>
  );
}
