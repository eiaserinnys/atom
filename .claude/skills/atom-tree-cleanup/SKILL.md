---
name: atom-tree-cleanup
description: |
  atom 지식 트리의 구조를 점검하고 정리하는 스킬.
  stale 항목 식별, 잘못 배치된 카드 이동, 관련 항목 그루핑, 섹션 논리적 재정렬을 수행한다.
  "트리 정리", "atom 정리", "트리 구조 개선", "stale 항목 정리", "카드 정리",
  "트리 재정렬", "atom 구조 점검", "트리 상태 확인" 같은 요청 시 사용.
  사용자가 특정 트리를 언급하며 "정리가 필요한지 봐줘" 같은 요청을 해도 사용.
---

# atom 트리 정리

atom 지식 트리의 구조적 품질을 유지하는 정리 워크플로우.

## 워크플로우

### 1단계: 트리 개관 확보

정리 대상 서브트리를 `compile_subtree`로 조회한다.

```
compile_subtree(node_id, titles_only=true, depth=3~4)
```

`titles_only=true`는 제목과 콘텐츠 크기만 반환하므로 큰 트리도 빠르게 파악할 수 있다.
depth는 트리 규모에 따라 조절한다. 대부분 3이면 충분하고, 깊은 트리는 4.

특정 카드의 내용을 확인해야 하면 `get_card`로 개별 조회한다.

### 1.5단계 (선택): 카드 크기 스캔

카드 본문이 과도하게 긴 경우를 찾아야 할 때 사용한다.
knowledge 카드에 여러 개념이 혼재하는지 확인하거나, 전체 그루밍 전에 분해 후보를 미리 파악할 때 활용한다.

```bash
# 프로젝트 루트(.mcp.json이 있는 디렉토리)에서 실행
python .claude/skills/atom-tree-cleanup/scripts/scan_heavy_cards.py <node_id> [--threshold 300] [--depth 10]
```

출력 예시:
```
[스캔 결과]  총 6개 카드 중 2개가 임계값(300자)을 초과합니다.

    1. compile_subtree 옵션 체계  (knowledge)  — 1,285 chars
       node: e2d66d4a-1cff-4272-8fc0-2d0cfee00610
    2. batch_op — 원자적 다중 연산  (knowledge)  — 413 chars
       node: 160055b6-bb5b-4cfa-bb8c-581504106e12
```

임계값을 초과하는 카드는 **분해 후보**다.
knowledge 카드 하나에 여러 개념이 섞인 경우 structure 카드 + 자식 knowledge 카드로 분해한다.
분해 기준은 "이 카드를 다른 맥락으로 옮겼을 때 혼자 이해되는가?" — atom-zettelkasten 스킬의 원자성 원칙과 동일하다.

### 2단계: 문제 식별 및 제안

트리를 분석하여 다음 유형의 문제를 찾는다.

**stale 항목**
- 완료된 수정 사항이 "이슈" 섹션에 남아 있는 경우
- 특정 시점의 운영 상태(날짜가 박힌 스냅샷)가 아키텍처 지식과 혼재된 경우
- 더 이상 유효하지 않은 정보 (코드가 이미 변경됨)

**잘못 배치된 항목**
- 다른 트리에 속해야 하는 카드 (예: 프로젝트 A 정보가 프로젝트 B 트리에 있음)
- 아키텍처 지식과 운영 팩트가 같은 섹션에 혼재된 경우

**구조 개선**

그루핑의 판단 기준은 숫자가 아니라 의미다.
"이 카드들 사이에 의미 단위가 보이는가?" — YES면 강박적으로 그루핑한다. NO면 건드리지 않는다.
탐색 효율은 의미 구조가 잘 잡혔을 때 자연스럽게 따라오는 부산물이므로, 효율을 판단 기준으로 삼지 않는다.

구체적인 구조 신호:
- `knowledge → knowledge` 자식 관계: 원자성 위반. knowledge 카드는 자식을 가질 수 없다.
- 빈 structure 카드 (자식이 없는 폴더): 제거 대상
- structure 자식 과밀: 의미 단위 그루핑을 탐색한다 (숫자 기준 없음, 의미로 판단)
- 섹션 순서가 논리적이지 않은 경우 (일반→구체, 아키텍처→개발→운영 순서 권장)

발견한 문제를 번호를 매겨 사용자에게 제시하고 확인을 받는다.
사용자가 동의하면 다음 단계로 진행한다.

### 3단계: 정리 실행

정리 작업은 두 종류의 연산으로 나뉜다. 각각 적합한 도구가 다르다.

#### 구조 변경: `batch_op` 사용

structure 카드 신설, 항목 이동(다른 부모로), 삭제를 `batch_op` 하나로 원자적 처리한다.

```
batch_op(
  creates: [
    {temp_id: "new-group", card_type: "structure", title: "...",
     parent_node_id: "...", position: 9000}
  ],
  moves: [
    {node_id: "...", parent_temp_id: "new-group", new_position: 100},
    {node_id: "...", new_parent_node_id: "other-tree-id", new_position: 900}
  ]
)
```

**position 충돌 방지**: creates의 position은 기존 자식과 겹치지 않도록 높은 값(9000 등)을 사용한다.
이후 재정렬 단계에서 올바른 위치로 옮긴다.

#### 같은 부모 내 재정렬: `move_node` 개별 호출

같은 부모 아래 자식 노드의 순서를 변경할 때는 `batch_op`의 moves를 사용하면
position conflict가 발생한다 (3회 retry 후 실패).

대신 `move_node`를 개별로 호출한다.

**⚠️ position은 raw 값이다 — ordinal index가 아니다.**

`move_node`의 `position` 파라미터는 "N번째에 삽입"이 아니라 DB에 저장되는 raw sort key다.
기존 노드들은 생성 방식에 따라 0/1/2 같은 작은 값이나 100/200/300, 1000/2000처럼
큰 간격의 값을 가질 수 있다. **이동 전에 반드시 `list_children`으로 실제 position 값을 확인한다.**

```python
# 1. 실제 position 값 확인
children = mcp__atom__list_children(parent_node_id="parent-id")
# → [{"id": "a", "position": 0}, {"id": "b", "position": 300}, {"id": "c", "position": 700}, ...]

# 2. 삽입 위치 계산: b(300)와 c(700) 사이에 넣으려면 500
move_node(node_id: "target", parent_node_id: "parent", position: 500)
```

전체 순서를 재설정해야 할 때는 간격을 두어 일괄 설정한다:

```python
# 간격 100으로 전체 재설정 — 병렬 호출 가능
move_node(node_id: "first",  parent_node_id: "parent", position: 100)
move_node(node_id: "second", parent_node_id: "parent", position: 200)
move_node(node_id: "third",  parent_node_id: "parent", position: 300)
...
```

스크립트는 설정을 다음 순서로 로드한다:
1. 환경변수 `ATOM_BASE_URL`, `ATOM_API_KEY`
2. `.mcp.json` (스크립트 위치 또는 cwd에서 상위 방향 탐색)

`.mcp.json` 예시:
```json
{
  "mcpServers": {
    "atom": {
      "url": "http://localhost:4200/mcp",
      "headers": { "x-api-key": "your-api-key" }
    }
  }
}
```

### 4단계: 결과 검증

정리 후 `compile_subtree(titles_only=true)`로 최종 상태를 확인하고 사용자에게 보여준다.

## 논리적 순서 가이드

프로젝트 트리의 섹션 배치 권장 순서:

1. **구조/아키텍처** — 전체 구조 개관, 컴포넌트 역할
2. **소스 경로** — 파일 위치
3. **핵심 규칙/불변량** — 변하지 않는 원칙
4. **핵심 도메인** — 주요 비즈니스 로직 (라이프사이클, 데이터 흐름 등)
5. **인터페이스** — API, 이벤트, 프로토콜
6. **클라이언트** — 프론트엔드 아키텍처
7. **개발 방법** — 패턴, 컨벤션
8. **테스트** — 테스트 패턴, 주의사항
9. **환경 설정** — 개발 환경
10. **현행 이슈** — 활성 버그, 코드 부채
11. **수정 이력** — 완료된 수정 (재발 시 참고용)

모든 트리에 이 순서를 강제하지 않는다. 트리의 성격에 맞게 판단한다.
