import { useMemo, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { EditableHeading, type SectionMap } from './EditableHeading';

export function useEditableHeadingComponents(
  nodeId: string | null,
  sectionMap: SectionMap,
  onEditCard: (cardId: string) => Promise<void>
): Components {
  return useMemo(() => {
    if (!nodeId) return {};

    const makeHeading = (level: number) =>
      ({ children }: { children?: ReactNode }) => (
        <EditableHeading level={level} sectionMap={sectionMap} onEditCard={onEditCard}>
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
  }, [nodeId, onEditCard, sectionMap]);
}
