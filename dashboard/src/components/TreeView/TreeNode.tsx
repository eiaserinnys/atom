import { useState } from 'react';
import type { TreeNodeData } from '../../api/client';
import styles from './TreeView.module.css';

interface TreeNodeProps {
  node: TreeNodeData;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  depth?: number;
}

export function TreeNode({ node, selectedNodeId, onSelect, depth = 0 }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = node.id === selectedNodeId;
  const isStructure = node.card.card_type === 'structure';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.id);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <div className={styles.nodeWrapper}>
      <div
        className={`${styles.nodeRow} ${isSelected ? styles.selected : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={handleClick}
      >
        {/* Expand/collapse toggle */}
        <span className={styles.toggle} onClick={hasChildren ? handleToggle : undefined}>
          {hasChildren ? (expanded ? '▾' : '▸') : ' '}
        </span>

        {/* Card type icon */}
        <span
          className={styles.typeIcon}
          title={isStructure ? 'structure' : 'knowledge'}
        >
          {isStructure ? '📁' : '📄'}
        </span>

        {/* Symlink indicator */}
        {node.is_symlink && (
          <span className={styles.symlinkIcon} title="symlink">↗</span>
        )}

        {/* Title */}
        <span className={styles.nodeTitle}>{node.card.title}</span>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className={styles.children}>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
