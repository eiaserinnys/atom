import { useLayoutEffect, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';

export interface LayoutWidths { leftPx: number; rightPx: number }
interface ThreePanelLayoutProps {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
  onLayoutWidthsChange?: (widths: LayoutWidths) => void;
}

export function ThreePanelLayout({ left, center, right, onLayoutWidthsChange }: ThreePanelLayoutProps) {
  const container = useRef<HTMLDivElement>(null);
  const centerPanel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const outer = container.current!.getBoundingClientRect();
      const middle = centerPanel.current!.getBoundingClientRect();
      onLayoutWidthsChange?.({ leftPx: middle.left - outer.left, rightPx: outer.right - middle.right });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container.current!); observer.observe(centerPanel.current!);
    measure();
    return () => observer.disconnect();
  }, [onLayoutWidthsChange]);
  return (
    <div className="h-full w-full" ref={container}>
      <Group orientation="horizontal" className="h-full w-full">
        <Panel defaultSize={25} minSize={15} className="overflow-hidden flex flex-col">{left}</Panel>
        <Separator className="w-1 bg-border cursor-col-resize hover:bg-brand shrink-0" />
        <Panel defaultSize={45} minSize={20} className="overflow-hidden flex flex-col">
          <div ref={centerPanel} data-center-panel className="h-full min-h-0">{center}</div>
        </Panel>
        <Separator className="w-1 bg-border cursor-col-resize hover:bg-brand shrink-0" />
        <Panel defaultSize={30} minSize={15} className="overflow-hidden flex flex-col">{right}</Panel>
      </Group>
    </div>
  );
}
