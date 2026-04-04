---
name: atom-reference-digest
description: |
  외부 자료(URL, GitHub 리포, PDF, 논문 등)를 제텔카스텐 방식으로 atom에 소화(digest)하는 스킬.
  자료를 읽고 → 레퍼런스 > [유형] > [소스명] > [섹션] > 아토믹 지식 구조로 분해하고 →
  지식 트리에 symlink로 배치(유사 지식 클러스터링 + 트리 그루밍) →
  연역/귀납 인사이트가 있으면 사용자 제안 후 새 카드 생성.
  다음 요청 시 반드시 사용:
  - "이 PDF 소화해줘", "이 자료 atom에 정리해줘", "이 링크 지식 카드로 만들어줘"
  - "이 리포 분석해서 정리해줘", "이 논문 리뷰해서 정리해줘"
  - 링크를 던지면서 "정리해줘", "atom에 넣어줘"라고 할 때
  자료가 있는데 atom에 남기고 싶다는 의도가 보이면 적극적으로 이 스킬을 호출한다.
---

# atom 레퍼런스 소화 스킬

외부 자료를 읽고, 지식 구조로 분해하여 atom 레퍼런스 트리에 배치하고,
지식 트리에 symlink로 연결하는 전 과정을 안내한다.

참고: 카드 작성 원칙은 `atom-zettelkasten` 스킬을 따른다.

## 소스 유형 분류표

| 유형 노드명 | 판별 기준 | 페치 방법 |
|---|---|---|
| 웹 문서 | github.com이 아닌 일반 URL, PDF 링크 | WebFetch |
| 깃 리포 | github.com URL | shallow clone 후 분석 |
| 논문 | arxiv.org, PDF 파일, 학술 URL | Read (PDF) 또는 WebFetch |

유형이 불명확하면 사용자에게 묻거나 `웹 문서`로 기본 처리한다.
새 유형이 필요하면 이 표에 추가한다.

## 레퍼런스 트리 구조

```
레퍼런스 [structure]                     ← 루트 (없으면 생성)
├── 웹 문서 [structure]
│   └── {소스명} [structure]             ← 소스 루트, source_ref = 원본 URL
│       ├── {섹션 A} [structure]
│       │   ├── {지식 카드} [knowledge]  ← source_ref 필수
│       │   └── {지식 카드} [knowledge]
│       └── {섹션 B} [structure]
│           └── {지식 카드} [knowledge]
├── 깃 리포 [structure]
│   └── {리포명} [structure]             ← source_ref = github URL
│       └── ...
└── 논문 [structure]
    └── {논문명 (연도)} [structure]       ← source_ref = 논문 URL 또는 파일 경로
        └── ...
```

## 전체 흐름

### 1단계: 소스 유형 판별 및 페치

소스 유형에 따라 페치:

**웹 문서:**
Claude Code 내장 도구 `WebFetch`로 URL을 가져온다. 봇 차단 사이트(openai.com, x.com, linkedin.com 등) 실패 시
다른 수단(검색 등)으로 우회한다.

**깃 리포:**
```bash
# 임시 디렉토리에 클론 (Linux/macOS: /tmp, Windows: %TEMP% 또는 원하는 경로)
git clone --depth 1 "<REPO_URL>" "{임시 디렉토리}/{리포명}"
```
README → 디렉토리 구조 → 핵심 소스 순으로 분석.

**논문(PDF):**
Read 도구의 `pages` 파라미터로 직접 읽기. 10페이지 초과면 핵심 섹션(Abstract, Introduction, Method, Results, Conclusion)만 선별.

**소스 방문 후 사용자 확인 (필수):**

페치가 완료되면 반드시 사용자에게 보고하고 추가 조사 여부를 묻는다:

```
{소스명}을 읽었습니다.

개요: {1~3줄 요약}
주요 섹션: {섹션 목록}

추가 조사가 필요한 부분이 있으면 말씀해 주십시오.
없으면 다이제스트를 진행하겠습니다.
```

### 2단계: 섹션 구조 설계 (레퍼런스 트리)

자료의 대목차를 atom 트리 구조로 변환한다.
섹션당 knowledge 카드 3~7개가 적당하며, 10개가 넘으면 섹션을 세분화한다.

**중복 확인:**
```python
mcp__atom__search_cards(query="{소스명 또는 핵심 키워드}", limit=10)
```
이미 유사 카드가 있으면 생성 대신 갱신을 검토한다.

**레퍼런스 루트 탐색 및 생성:**
```python
mcp__atom__get_tree()                                    # 루트 확인
mcp__atom__list_children(parent_node_id="{루트 ID}")     # 레퍼런스 노드 탐색
# 없으면 생성
mcp__atom__create_card(title="레퍼런스", card_type="structure", parent_node_id="{루트 ID}")
# 유형 노드 탐색/생성 (웹 문서 / 깃 리포 / 논문)
mcp__atom__list_children(parent_node_id="{레퍼런스 노드 ID}")
```

**카드 생성 (top-down):**
```python
# 소스 루트 structure 카드
mcp__atom__create_card(
    title="{소스명}",
    content="{소스의 목적/주제 1문장}",
    card_type="structure",
    source_ref="{원본 URL 또는 파일 경로}",  # 필수
    parent_node_id="{유형 노드 ID}"
)

# 섹션 structure 카드
mcp__atom__create_card(
    title="{섹션 제목}",
    card_type="structure",
    parent_node_id="{소스 루트 노드 ID}"
)

# knowledge 카드 (원자적 아이디어, 내 언어로)
mcp__atom__create_card(
    title="{아이디어를 요약한 제목 ≤50자}",
    content="{내 언어로 쓴 원자적 지식 1~3문장}",
    card_type="knowledge",
    source_ref="{원본 URL}",  # 필수 — 클릭 가능한 URL
    parent_node_id="{섹션 노드 ID}"
)
```

모든 knowledge 카드의 source_ref에는 클릭 가능한 URL을 반드시 기록한다:
```
✅ https://github.com/foo/bar
✅ https://arxiv.org/abs/2301.00000
❌ (source_ref 없음)
```

### 3단계: 지식 트리 배치 (symlink + 클러스터링)

이 단계가 제텔카스텐의 핵심이다.
레퍼런스 폴더에 쌓인 지식이 살아있는 지식 네트워크로 연결되는 순간이다.

**지식 루트 탐색:**
```python
mcp__atom__list_children(parent_node_id="{루트 ID}")  # 지식 노드 탐색
# 없으면 생성
mcp__atom__create_card(title="지식", card_type="structure", parent_node_id="{루트 ID}")
```

각 knowledge 카드에 대해 스스로에게 묻는다:
> *"이 카드가 지식 트리의 어느 맥락에 속할 수 있는가?"*

**클러스터링 원칙 (단순 배치 금지):**
- 같은 주제의 기존 카드가 있는 범주에 배치
- 인접 카드들과 개념적으로 연결되는 위치 선택
- 단독 orphan이 되는 배치는 피하고, 2개 이상 관련 카드가 모인 범주를 선호
- 적절한 범주가 없으면 새 분류 structure 카드를 생성

**⚠️ structure 카드 없이 knowledge 카드 직접 배치 금지:**

knowledge 카드(symlink 포함)는 반드시 **structure 카드의 자식**으로 배치한다.
카테고리 structure 카드(예: "시스템 설계") 바로 아래에 knowledge 카드를 두는 것은 금지다.
배치 전에 `list_children`으로 해당 structure 카드의 자식을 확인하고,
knowledge 카드를 담을 하위 structure 카드가 없으면 먼저 생성한다.

```python
# ✅ 올바른 구조
지식 > 시스템 설계 [structure]
  └── 상주형 검색 엔진 패턴 [structure]  ← 먼저 생성
      └── 바이그램 역 인덱스 [knowledge/symlink]

# ❌ 금지
지식 > 시스템 설계 [structure]
  └── 바이그램 역 인덱스 [knowledge/symlink]  ← structure 없이 직접 배치
```

**배치 전 트리 구조 타당성 검토 (필수):**

symlink를 달기 전에 해당 카테고리의 현재 구조를 `compile_subtree`로 확인하고,
기존 구조와 새 카드들이 잘 어울리는지 검토한다.
기존 카드들이 흩어져 있거나 범주가 어색하면, symlink 추가 전에 그루밍을 먼저 수행한다.

**트리 그루밍 (배치 전 선행):**
- 관련 카드들이 흩어져 있으면 적절한 상위 structure 카드로 묶기
- 너무 희박한 섹션은 인접 섹션과 합치기
- 중복 개념이 다른 이름으로 존재하면 통합 검토

```python
# 연결할 위치 탐색 + 구조 타당성 확인
mcp__atom__compile_subtree(node_id="{관련 섹션 노드}", depth=2)

# symlink 생성
mcp__atom__create_symlink(
    card_id="{knowledge 카드 UUID}",
    parent_node_id="{지식 트리 내 연결할 위치 노드 UUID}"
)
```

**symlink 판단 기준:**
- 이 지식이 다른 맥락의 의사결정에 직접 영향을 줄 수 있는가?
- 다른 주제 탐색 중 이 카드를 만나면 통찰이 생기는가?
- 현재 진행 중인 작업이나 관심 주제와 연결되는가?

억지로 연결하지 않는다. 자연스러운 연결이 없으면 레퍼런스 폴더에만 두어도 충분하다.

### 4단계: 인사이트 도출 (선택, 사용자 제안 필수)

새로 추가된 카드와 기존 카드를 연결했을 때,
연역적(알려진 전제들 → 새로운 결론) 또는 귀납적(개별 사례들 → 일반 법칙)으로
도출되는 유의미한 사실이 있는지 검토한다.

인사이트가 있으면 **반드시 사용자에게 먼저 제안**하고 승인받은 후 생성한다:

```
다음 인사이트를 도출했습니다. 지식 트리에 추가할까요?

제목: {인사이트 제목}
내용: {1~3문장, 도출 근거 포함}
연결 카드: {카드 A}, {카드 B}
배치 위치: {지식 트리 내 위치}
```

사용자가 승인하면:
```python
mcp__atom__create_card(
    title="{인사이트 제목}",
    content="{내 언어로 쓴 1~3문장}",
    card_type="knowledge",
    source_ref="{활용된 카드들의 원본 소스}"
)
# 활용된 기존 카드들에 symlink로 연결
```

### 5단계: 완료 보고

```
소화 완료: {소스명} ({유형})

레퍼런스 트리:
  레퍼런스 > {유형} > {소스명}
    {섹션 A}: N개 카드
    {섹션 B}: N개 카드

지식 트리 연결:
  - "{카드 제목}" → {연결된 위치}
  - "{카드 제목}" → {연결된 위치}

{인사이트가 있으면}
신규 인사이트: "{인사이트 제목}" 추가됨

총 N개 knowledge 카드 생성
```

## 개념: 자료 카드와 지식 카드의 차이

| 구분 | 자료 카드 (Reference Note) | 지식 카드 (Permanent Note) |
|------|--------------------------|--------------------------|
| 역할 | 자료의 존재를 기록 | 소화된 지식을 기록 |
| 내용 | 출처, 제목, 주제 1문장 | 원자적 아이디어 1~3문장, 내 언어로 |
| atom 유형 | `structure` 카드 (섹션 역할 겸함) | `knowledge` 카드 |
| source_ref | 자료 자체가 출처 | 자료의 위치 또는 섹션 URL |

자료 카드를 **별도로 만들지 않는다.** 자료의 섹션 구조 자체가 자료 카드를 대신한다.

## 작업 순서 요약

1. 소스 페치 → 사용자에게 개요 보고 + 추가 조사 여부 확인
2. `search_cards`로 중복 확인
3. `get_tree` + `list_children`으로 레퍼런스 루트 및 유형 노드 탐색/생성
4. structure → knowledge 카드 top-down 생성
5. 지식 트리에서 연결할 위치 `compile_subtree`로 확인 → 구조 타당성 검토 + 그루밍 → structure 카드 확보 → `create_symlink`
6. 연역/귀납 인사이트 검토 → 사용자 제안 → 승인 시 생성
7. 완료 보고
