/**
 * 서버 bfs.ts L140에서 헤딩과 같은 줄에 주석을 삽입:
 *   `## 1.2 카드 제목 <!-- node:NODE_ID card:CARD_ID -->`
 *
 * 이 함수는 마크다운에서 헤딩 줄을 파싱하여 nodeId → cardId 매핑을 생성한다.
 */
export interface SectionInfo {
  nodeId: string;
  cardId: string;
}

export type SectionMap = Map<string, SectionInfo>; // key: nodeId

const HEADING_META_RE = /^#{1,6}\s+.+?\s+<!--\s*node:(\S+)\s+card:(\S+)/;

export function parseCompileSections(markdown: string): SectionMap {
  const map: SectionMap = new Map();
  for (const line of markdown.split('\n')) {
    const m = line.match(HEADING_META_RE);
    if (m) {
      const nodeId = m[1]!;
      const cardId = m[2]!;
      map.set(nodeId, { nodeId, cardId });
    }
  }
  return map;
}
