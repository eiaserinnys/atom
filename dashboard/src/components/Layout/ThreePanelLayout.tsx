import { Group, Panel, Separator } from 'react-resizable-panels';

interface ThreePanelLayoutProps {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}

export function ThreePanelLayout({ left, center, right }: ThreePanelLayoutProps) {
  return (
    <Group orientation="horizontal" className="h-full w-full">
      <Panel defaultSize={30} minSize={15} className="overflow-hidden flex flex-col">
        {left}
      </Panel>
      <Separator className="w-1 bg-border cursor-col-resize transition-colors hover:bg-foreground/20 data-[resize-handle-active]:bg-foreground/20 shrink-0" />
      <Panel defaultSize={40} minSize={20} className="overflow-hidden flex flex-col">
        {center}
      </Panel>
      <Separator className="w-1 bg-border cursor-col-resize transition-colors hover:bg-foreground/20 data-[resize-handle-active]:bg-foreground/20 shrink-0" />
      <Panel defaultSize={30} minSize={15} className="overflow-hidden flex flex-col">
        {right}
      </Panel>
    </Group>
  );
}
