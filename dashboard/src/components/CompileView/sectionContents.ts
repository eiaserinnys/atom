import type { CompileSection } from '../../api/types';

type Contents = Record<string, { version: number; content: string | null }>;

export function createSectionContentsStore(fetchContents: (ids: string[]) => Promise<Contents>, changed: () => void) {
  const cache = new Map<string, string | null>();
  const pending = new Set<string>();
  let attempted = new Set<string>();
  let sections: CompileSection[] = [];
  let indices: number[] = [];
  let active = 0;

  const key = (section: CompileSection) => `${section.card_id}:${section.card_version}`;
  const get = (section: CompileSection) => section.content !== undefined ? section.content : cache.get(key(section));

  function drain() {
    while (active < 2) {
      const batch: CompileSection[] = [];
      const cardIds = new Set<string>();
      let chars = 0;
      for (const index of indices) {
        const section = sections[index];
        if (!section || section.cycle || section.chars === 0 || get(section) !== undefined) continue;
        const cacheKey = key(section);
        if (pending.has(cacheKey) || attempted.has(cacheKey) || cardIds.has(section.card_id)) continue;
        if (batch.length >= 100 || chars + section.chars > 300000) break;
        batch.push(section);
        cardIds.add(section.card_id);
        chars += section.chars;
      }
      if (batch.length === 0) return;
      for (const section of batch) {
        pending.add(key(section));
        attempted.add(key(section));
      }
      active++;
      void fetchContents([...cardIds]).then(contents => {
        for (const [id, entry] of Object.entries(contents)) cache.set(`${id}:${entry.version}`, entry.content);
      }).catch(() => {
        // A later visible-range request may try these cards again.
      }).finally(() => {
        for (const section of batch) pending.delete(key(section));
        active--;
        changed();
        drain();
      });
    }
  }

  return {
    get,
    setSections(value: CompileSection[]) {
      sections = value;
      for (const section of value) if (section.content !== undefined) cache.set(key(section), section.content);
    },
    request(value: number[]) {
      indices = value;
      attempted = new Set();
      drain();
    },
  };
}
