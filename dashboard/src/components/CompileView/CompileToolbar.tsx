import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, ListTree } from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu';
import { INFINITY_SLIDER_VALUE } from './compileDepth';

interface CompileToolbarProps {
  nodeId: string | null;
  headerTabs?: React.ReactNode;
  sliderValue: number;
  depthLabel: string;
  unfurlEnabled: boolean;
  selectDepth: (value: number) => void;
  onToggleUnfurl: () => void;
}

export function CompileToolbar({
  nodeId,
  headerTabs,
  sliderValue,
  depthLabel,
  unfurlEnabled,
  selectDepth,
  onToggleUnfurl,
}: CompileToolbarProps) {
  const { t } = useTranslation();
  const depthButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  const openDepthMenu = () => {
    const rect = depthButton.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPosition({ x: rect.left, y: rect.bottom + 4 });
    setMenuOpen(true);
  };

  const depthItems: ContextMenuItem[] = Array.from({ length: INFINITY_SLIDER_VALUE }, (_, index) => {
    const depth = index + 1;
    return {
      label: depth === INFINITY_SLIDER_VALUE
        ? t('compile.depth_all')
        : t('compile.depth_option', { count: depth }),
      checked: sliderValue === depth,
      onClick: () => {
        selectDepth(depth);
        setMenuOpen(false);
      },
    };
  });

  return (
    <div className="h-10 max-md:h-12 flex items-center px-4 gap-2 border-b border-border bg-card shrink-0">
      {headerTabs}
      {nodeId && (
        <div className="ml-auto -mr-2 min-w-0 flex items-center">
          <button
            type="button"
            ref={depthButton}
            onClick={openDepthMenu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('compile.depth_label', { depth: depthLabel })}
            title={t('compile.depth_label', { depth: depthLabel })}
            className="h-8 px-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ListTree className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            <span className="text-[13px] font-mono">{depthLabel}</span>
          </button>
          <button
            type="button"
            onClick={onToggleUnfurl}
            aria-pressed={unfurlEnabled}
            aria-label={unfurlEnabled ? t('compile.unfurl_disable') : t('compile.unfurl_enable')}
            title={unfurlEnabled ? t('compile.unfurl_disable') : t('compile.unfurl_enable')}
            className={`w-8 h-8 inline-flex items-center justify-center transition-colors ${unfurlEnabled ? 'bg-brand/10 text-brand' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
          >
            <Link2 className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}
      {menuOpen && menuPosition && (
        <ContextMenu
          x={menuPosition.x}
          y={menuPosition.y}
          items={depthItems}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
