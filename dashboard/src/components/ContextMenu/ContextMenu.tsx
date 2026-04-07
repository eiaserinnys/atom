import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 화면 경계 처리: 메뉴가 뷰포트를 벗어나지 않도록 위치 조정
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 32 - 16);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      data-testid="context-menu"
      style={{ top: adjustedY, left: adjustedX }}
      className="fixed z-[100] min-w-[140px] max-w-[200px] bg-card border border-border rounded shadow-card py-1"
    >
      {items.map((item, i) => (
        <button
          key={i}
          data-testid="context-menu-item"
          onClick={() => { item.onClick(); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors truncate ${
            item.danger ? 'text-node-error' : 'text-foreground'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
