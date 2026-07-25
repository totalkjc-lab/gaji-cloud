# 가지 클라우드 — 설계 문서

날짜: 2026-07-25

## 배경

`가지5`는 기존에 단일 HTML 파일로 만든 마인드맵 편집기로, 지금은 Claude 아티팩트로 배포되어 있다 (로그인한 본인 계정, 단일 브라우저 로컬 저장). 이번 요청은 여러 기기·사용자 간 데이터 동기화, 구글 로그인, 사용자별 클라우드 폴더, 폴더 단위 공개/비공개 설정, 로그인→대시보드→편집기로 이어지는 흐름을 추가하는 것이다.

Claude 아티팩트는 정적 페이지로 자체 로그인/DB를 가질 수 없으므로, 이 기능은 별도로 호스팅되는 웹앱으로 만든다.

## 결정 사항 (사용자 확인 완료)

- 백엔드: **Supabase** (Auth + Postgres). 계정 생성은 사용자가 직접 한다.
- 폴더 구조: **사용자당 폴더 1개**, 가입 시 자동 생성.
- 로그인: **구글 OAuth**.
- 공개 범위: 폴더가 공개면 **링크를 아는 사람만 조회 가능** (목록/검색에 노출되지 않음), 조회자는 읽기 전용.
- 호스팅: **Vercel** (정적 파일 그대로 배포, 빌드 스텝 없음).

## 아키텍처

빌드 도구 없는 순수 HTML/JS 3개 페이지 + Supabase JS SDK(CDN script 태그로 로드, 기존 가지5의 무빌드 방식을 그대로 유지).

```
index.html      로그인 화면 (구글 로그인 버튼 하나)
dashboard.html  내 폴더의 맵 목록, 공개/비공개 토글, 새로 만들기
map.html        마인드맵 편집기 (가지5 기반, 저장소만 Supabase로 교체)
supabase-schema.sql   테이블 + RLS 정책 + 트리거 정의 (Supabase SQL 편집기에 붙여넣어 실행)
```

## 데이터 모델 (Supabase / Postgres)

```sql
folders
  id          uuid primary key default gen_random_uuid()
  owner_id    uuid not null unique references auth.users(id) on delete cascade
  is_public   boolean not null default false
  created_at  timestamptz not null default now()

maps
  id          uuid primary key default gen_random_uuid()
  folder_id   uuid not null references folders(id) on delete cascade
  title       text not null default '제목 없음'
  data        jsonb not null            -- 기존 root 트리(JSON)를 그대로 저장
  updated_at  timestamptz not null default now()
```

**자동 폴더 생성**: `auth.users`에 새 행이 생기면 트리거가 `folders` 행을 자동으로 만든다. 클라이언트 코드가 "폴더 있는지 확인 후 없으면 생성" 같은 분기를 매번 할 필요가 없다 — 한 곳(DB)에서 한 번만 보장한다.

**접근 제어(RLS)**: 앱 코드에 권한 분기를 넣지 않고 Postgres 정책으로 처리한다.

- `folders` select: `owner_id = auth.uid() OR is_public = true` (비로그인 anon role도 공개 폴더는 읽을 수 있어야 함)
- `folders` update: `owner_id = auth.uid()` (공개 토글용, is_public 컬럼만)
- `maps` select: 상위 folder가 `owner_id = auth.uid()` 이거나 `is_public = true`
- `maps` insert/update/delete: 상위 folder가 `owner_id = auth.uid()`

## 화면 흐름

1. `index.html` — 미로그인 상태로 열리면 구글 로그인 버튼만 보임. 로그인 성공 시 `dashboard.html`로 이동. 이미 로그인돼 있으면 바로 넘어감.
2. `dashboard.html` (파라미터 없음, 로그인 필요) — 내 폴더의 맵 목록(제목·수정 시각), 상단 "이 폴더 공개" 스위치, "새로 만들기" 버튼. 목록 클릭 시 `map.html?id=<mapId>`.
3. `dashboard.html?folder=<folderId>` (로그인 불필요) — 남의 공개 폴더를 링크로 열람. 소유자 controls(공개 스위치, 새로 만들기) 없이 목록만 읽기 전용으로 표시.
4. `map.html?id=<mapId>` — 편집기. 요청한 사용자가 해당 맵이 속한 폴더의 소유자면 편집 모드(지금의 가지5와 동일한 전체 기능), 아니면(공개 폴더를 통한 접근) 읽기 전용 모드 — 추가/삭제/색상/드래그/이름수정 버튼과 단축키 비활성화, 이동·확대축소·접기·내보내기는 그대로 동작.

## map.html — 가지5 대비 변경점

- **제거**: `Store`(localStorage/window.storage), "내 맵" 라이브러리 시트, "PC 파일 연결"(File System Access 자동저장). 이 역할은 이제 대시보드와 Supabase 자동저장이 담당.
- **교체**: 자동저장 로직(기존 600ms 디바운스 유지)이 `Store.save`/`Store.load` 대신 Supabase `maps` 테이블 update/select 호출.
- **유지**: "사본 저장"(JSON/MD/PNG 내보내기), "파일 열기"(JSON 불러오기). 특히 JSON 불러오기는 기존 아티팩트 버전에서 내려받은 맵을 새 버전으로 옮기는 이관 경로로 그대로 활용한다.
- **추가**: 읽기 전용 모드 — 소유자가 아니면 편집 관련 버튼/단축키를 비활성화하고 상단에 "읽기 전용" 표시.

## 배포/설정 (사용자가 직접 수행)

1. Supabase 프로젝트 생성 → `supabase-schema.sql` 실행 → Google Auth Provider 활성화(Google Cloud Console에서 OAuth 클라이언트 ID 발급 후 등록)
2. 프로젝트 URL/anon key를 `index.html`/`dashboard.html`/`map.html`에 설정
3. Vercel에 리포지토리 연결 또는 폴더 드래그 앤 드롭 배포

각 단계의 구체적 클릭 경로는 구현 완료 후 별도로 안내한다.

## 범위 밖 (지금은 안 함)

- 사용자가 폴더를 여러 개 만드는 기능 (사용자당 1폴더로 확정)
- 공개 폴더의 서비스 내 검색/탐색 노출 (링크 기반 공개만)
- 맵 단위 개별 공유 설정 (폴더 단위로만 공개/비공개)
- 협업 편집(동시 편집, 커서 공유 등)
