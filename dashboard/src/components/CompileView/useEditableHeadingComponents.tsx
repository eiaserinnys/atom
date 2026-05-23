import { useMemo, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import type { SectionMap } from '../../utils/parseCompileSections';
import { EditableHeading } from './EditableHeading';

export function useEditableHeadingComponents(
  nodeId: string | null,
  sectionMap: SectionMap
): Components {
  return useMemo(() => {
    if (!nodeId) return {};

    const makeHeading = (level: number) =>
      ({ children }: { children?: ReactNode }) => (
        <EditableHeading level={level} sectionMap={sectionMap} compiledNodeId={nodeId}>
          {children}
        </EditableHeading>
      );

    return {
      h1: makeHeading(1),
      h2: makeHeading(2),
      h3: makeHeading(3),
      h4: makeHeading(4),
      h5: makeHeading(5),
      h6: makeHeading(6),
    };
  }, [nodeId, sectionMap]);
}
