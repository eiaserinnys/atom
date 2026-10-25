import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Link2 } from 'lucide-react';
import { INFINITY_SLIDER_VALUE } from './compileDepth';

interface CompileToolbarProps {
  nodeId: string | null;
  headerTabs?: React.ReactNode;
  sliderValue: number;
  depthLabel: string;
  unfurlEnabled: boolean;
  onSliderChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onToggleUnfurl: () => void;
}

export function CompileToolbar({
  nodeId,
  headerTabs,
  sliderValue,
  depthLabel,
  unfurlEnabled,
  onSliderChange,
  onToggleUnfurl,
}: CompileToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="h-10 flex items-center px-3.5 gap-2 border-b border-border bg-card text-[13px] font-semibold text-muted-foreground shrink-0">
      {headerTabs ?? t('compile.header')}
      {nodeId && (
        <div className="ml-auto min-w-0 flex items-center gap-1">
          <div className="flex items-center gap-1">
            <input
              type="range"
              min={1}
              max={INFINITY_SLIDER_VALUE}
              step={1}
              value={sliderValue}
              onChange={onSliderChange}
              className="w-16 accent-primary cursor-pointer"
              title={t('compile.depth_label', { depth: depthLabel })}
            />
            <span className="text-[13px] font-mono text-muted-foreground w-4 text-center">
              {depthLabel}
            </span>
          </div>
          <span className="hidden xl:block px-2 py-0.5 text-[13px] font-mono bg-muted border border-border rounded-none text-muted-foreground">
            {nodeId.slice(0, 8)}
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(nodeId)}
            className="p-1 rounded-none hover:bg-muted text-muted-foreground"
            title={t('compile.copy_id')}
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={onToggleUnfurl}
            className={`p-1 rounded-none text-muted-foreground transition-colors ${
              unfurlEnabled ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
            }`}
            title={unfurlEnabled ? t('compile.unfurl_disable') : t('compile.unfurl_enable')}
          >
            <Link2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
