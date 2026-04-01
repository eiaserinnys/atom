import { Group, Panel, Separator } from 'react-resizable-panels';
import styles from './ThreePanelLayout.module.css';

interface ThreePanelLayoutProps {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}

export function ThreePanelLayout({ left, center, right }: ThreePanelLayoutProps) {
  return (
    <Group orientation="horizontal" className={styles.layout}>
      <Panel defaultSize={30} minSize={15} className={styles.panel}>
        {left}
      </Panel>
      <Separator className={styles.resizeHandle} />
      <Panel defaultSize={40} minSize={20} className={styles.panel}>
        {center}
      </Panel>
      <Separator className={styles.resizeHandle} />
      <Panel defaultSize={30} minSize={15} className={styles.panel}>
        {right}
      </Panel>
    </Group>
  );
}
