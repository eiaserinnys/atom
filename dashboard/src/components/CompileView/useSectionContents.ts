import { useCallback, useEffect, useState } from 'react';
import { compileApi } from '../../api/compileApi';
import type { CompileSection } from '../../api/types';
import { createSectionContentsStore } from './sectionContents';

export function useSectionContents(sections: CompileSection[]) {
  const [, setVersion] = useState(0);
  const [store] = useState(() => createSectionContentsStore(
    async ids => (await compileApi.contents(ids)).contents,
    () => setVersion(version => version + 1),
  ));
  useEffect(() => { store.setSections(sections); }, [sections, store]);
  const request = useCallback((indices: number[]) => store.request(indices), [store]);
  return { get: store.get, request };
}
