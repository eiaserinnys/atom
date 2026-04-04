---
name: atom-zettelkasten
description: |
  atom MCP 시스템에 지식 카드를 제텔카스텐 방식으로 작성하는 범용 방법론 가이드.
  atom에 카드를 기록하거나, 기존 카드를 갱신하거나, 지식 구조를 구성할 때 반드시 참조한다.
  "atom에 기록해줘", "카드 만들어줘", "atom에 저장해줘", "지식 정리해줘" 같은 요청 시 사용.
  atom 카드를 작성하는 모든 스킬이 이 스킬의 원칙을 따른다.
---

# atom 제텔카스텐 카드 작성 가이드

## 세 가지 원칙

### 1. 원자성 (Atomicity) — 가장 중요

카드 하나에는 아이디어 하나만. **1문장이 이상적이고, 최대 3문장**이다.

기준은 하나다: *"이 카드를 다른 맥락의 트리로 옮겨도 혼자 이해되는가?"*

카드가 원자적이어야 재배치가 가능하다. 너무 많은 것을 담은 카드는 특정 맥락에 묶여버려 다른 곳에 연결할 수 없게 된다. 원자성이 곧 이동성이다.

### 2. 출처 필수 (Source Attribution)

모든 knowledge 카드의 `source_ref`에 **출처를 반드시 기록한다**.

출처가 없으면 나중에 재검증이 불가능하다. 출처 미기재 카드는 미완성 카드다.

| 상황 | source_ref 형태 |
|------|----------------|
| 웹 URL이 있음 | `https://example.com/path` |
| 로컬 문서 | `file://{절대경로}` 또는 파일명 |
| URL 없는 내부 소스 | `{소스이름}:{식별자}` (예: `internal:meeting-2024-03`) |

### 3. 나의 언어로 (Own Words)

원문을 복사하지 않는다. 내가 이해한 방식으로 다시 쓴다.
맥락 없이 읽어도 의미가 살아있어야 한다. 그래야 나중에 꺼냈을 때 다시 원문을 찾아볼 필요가 없다.

## 좋은 카드 vs 나쁜 카드

### 원자성

```
❌ 나쁜 카드: "프로젝트 현황"
  content: "A팀은 일정 지연 중. B팀은 정상 진행.
            C팀은 이번 주 릴리즈 예정. 전체 진행률 42%.
            주요 블로커는 QA 인력 부족과 외주 납기 지연.
            이 외에도 3개 미완료 항목이 있다."
→ 5개 이상의 아이디어가 섞여 있다. 어디에도 연결하기 어렵다.

✅ 좋은 카드: "QA 인력 부족이 현재 릴리즈 일정의 주요 블로커다."
  content: "QA 인력 부족이 현재 릴리즈 일정의 주요 블로커다."
  source_ref: "https://..."
→ 하나의 사실. 다른 '블로커' 카드들과 연결 가능하다.
```

### 출처

```
❌ 나쁜 카드: source_ref 없음
  content: "신규 기능 A 구현 완료율 40%"
→ 언제 측정한 값인지, 어디서 확인할 수 있는지 알 수 없다.

✅ 좋은 카드: source_ref: "https://github.com/myorg/myrepo/issues/42"
  content: "신규 기능 A 구현 완료율 40% (2024-03-01 기준)"
→ 원본에서 언제든 재검증 가능하다.
```

### 나의 언어로

```
❌ 나쁜 카드: content: "PRD v2 마감: 프론트엔드+백엔드 코드 조립완료 + 1차 QA 외주 적용"
→ 원문 복사. 맥락 없이는 의미 파악이 어렵다.

✅ 좋은 카드: content: "4월 말 v2 마감은 '플레이 가능한 전체 흐름'을 목표로 한다.
              외주 QA가 처음 들어가는 마일스톤이기도 하다."
→ 내 이해가 담겼다. 다른 '마일스톤' 카드와 연결될 맥락이 생겼다.
```

## 카드 유형

### structure 카드 (`card_type: "structure"`)

목차, 섹션, 폴더 역할. 트리에서 다른 카드들의 컨테이너다.
내용이 없거나 레이블 수준의 짧은 텍스트만 갖는다. `source_ref` 불필요.

```
예: "릴리즈 로드맵", "팀원", "알 수 없는 것들"
```

### knowledge 카드 (`card_type: "knowledge"`)

실제 지식을 담는 단위. 원자성 원칙이 적용된다. `source_ref` 필수.

```
예: "v2 마감 D-28 기준 전체 진행률 16% (19/117 항목)"
    source_ref: "https://github.com/myorg/roadmap/issues/10"
```

## atom MCP 도구 사용법

### 카드 작성

```python
mcp__atom__create_card(
    title="제목 (≤50자, 필수)",
    content="내용 (1~3문장)",
    card_type="knowledge",          # 또는 "structure"
    source_ref="https://...",       # knowledge 카드는 필수
    parent_node_id="<node-uuid>",   # 트리 위치 지정
    references=["<card-uuid>", ...] # 연결할 카드들
)
```

### 카드 갱신

```python
mcp__atom__update_card(
    card_id="<card-uuid>",
    content="갱신된 내용",
    source_ref="https://...",
    content_timestamp="2024-03-01T10:00:00+00:00"
)
```

### 트리 탐색

```python
# 서브트리 전체를 마크다운으로 읽기 (목차 파악에 유용)
mcp__atom__compile_subtree(node_id="<node-uuid>", depth=3)

# 특정 노드의 자식 목록
mcp__atom__list_children(parent_node_id="<node-uuid>")
```

### 카드 검색 (기존 카드 확인용)

```python
# 생성 전에 먼저 검색해서 중복 방지
mcp__atom__search_cards(query="검색어", limit=10)
```

## 카드 연결 방법

### references — 의미적 연결

"이 카드를 이해하려면 저 카드도 알아야 한다"는 관계.
`create_card`의 `references` 필드에 UUID를 넣으면 양방향 백링크가 자동 생성된다.

```python
# "QA 인력 부족" 카드가 "v2 마감 위험" 카드와 연결
mcp__atom__create_card(
    title="QA 인력 부족이 릴리즈 블로커",
    content="...",
    references=["<v2 마감 위험 카드 UUID>"]
)
```

### symlink — 같은 카드를 여러 맥락에

카드를 복사하지 않고 여러 트리 위치에 배치한다.
내용은 하나지만 위치는 여럿 — 한 곳에서 갱신하면 모든 위치에 반영된다.

```python
mcp__atom__create_symlink(
    card_id="<카드 UUID>",
    parent_node_id="<새로운 위치 노드 UUID>"
)
```

### structure 카드로 묶기 — 목차 구성

관련 카드들을 structure 카드 아래에 모으면 트리 자체가 목차가 된다.

## 목차 구성 패턴

```
[루트 structure]
├── [섹션 A structure]    ← 레이블만, 내용 없음
│   ├── [knowledge 카드]  ← 원자적 지식 1개 + source_ref
│   └── [knowledge 카드]
└── [섹션 B structure]
    ├── [knowledge 카드]
    └── [하위 섹션 structure]
        └── [knowledge 카드]
```

`mcp__atom__compile_subtree(node_id, depth=3)` 으로 목차 전체를 한 번에 읽는다.
루트 노드는 `mcp__atom__get_tree()`로 조회한다.

## 갱신 원칙

- 내용이 달라지면 **갱신**하되, `source_ref`도 함께 최신으로 확인한다
- `content_timestamp`를 갱신 시점 ISO 문자열로 설정한다
- 카드를 삭제하기보다 내용을 갱신하거나 첫 줄에 `[무효화됨 YYYY-MM-DD]` 표시를 남긴다
  - 백링크가 있는 카드를 삭제하면 연결이 끊어진다

## 작업 순서 요약

1. `mcp__atom__search_cards`로 기존 카드 확인 (중복 방지)
2. 없으면 `mcp__atom__create_card`로 생성
3. 있으면 `mcp__atom__update_card`로 갱신
4. 연결이 필요하면 `references`에 UUID 추가 또는 `create_symlink`
5. `mcp__atom__compile_subtree`로 결과 확인
