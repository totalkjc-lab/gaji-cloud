# 가지 클라우드

Google 로그인 + Supabase로 저장되는 다중 사용자 마인드맵. 빌드 과정 없음 — 폴더를 그대로 정적 호스팅에 올리면 됩니다.

## 1. Supabase 프로젝트

1. https://supabase.com 에서 새 프로젝트 생성
2. SQL Editor에 `supabase-schema.sql` 내용을 붙여넣고 실행
3. Table Editor에서 `folders`, `maps` 테이블에 RLS 자물쇠 아이콘이 켜져 있는지 확인
4. Authentication → Providers → Google 활성화. Client ID/Secret은 아래 2번 단계에서 발급받은 값을 입력
5. Authentication → URL Configuration → Redirect URLs에 배포될 도메인의 `/dashboard.html` 추가 (예: `https://내앱.vercel.app/dashboard.html`, 로컬 테스트용으로 `http://localhost:3000/dashboard.html`도 추가 가능)
6. Project Settings → API에서 Project URL과 anon public key를 복사

## 2. Google OAuth 클라이언트

1. https://console.cloud.google.com → 프로젝트 생성 → APIs & Services → Credentials
2. "Create Credentials" → "OAuth client ID" → Application type: Web application
3. Authorized redirect URIs에 Supabase가 알려주는 콜백 URL 추가 (Supabase Authentication → Providers → Google 화면에 표시됨, `https://<project>.supabase.co/auth/v1/callback` 형태)
4. 발급된 Client ID/Secret을 Supabase Google Provider 설정에 입력하고 저장

## 3. config.js 채우기

`config.js`를 열어 1번 단계에서 복사한 값으로 채웁니다.

```js
window.GAJI_CONFIG = {
  supabaseUrl: "https://xxxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

## 4. Vercel 배포

1. https://vercel.com 에 로그인 → "Add New… → Project"
2. 이 폴더(`gaji-cloud`)를 그대로 업로드하거나 GitHub 리포지토리로 연결
3. Framework Preset: "Other" (빌드 명령 없음, Output Directory는 루트)
4. 배포 완료 후 나온 도메인을 Supabase의 Redirect URLs(1-5단계)에 다시 등록

## 수동 검증 체크리스트

- [ ] `index.html` 접속 → "구글로 로그인" 클릭 → 구글 계정 선택 → `dashboard.html`로 이동하는지
- [ ] 로그인 직후 Supabase Table Editor의 `folders`에 내 `owner_id`로 된 행이 자동 생성됐는지 (트리거 확인)
- [ ] 대시보드에서 "새로 만들기" → 편집기로 이동해 노드 추가/수정 후 몇 초 뒤 "저장됨"으로 바뀌는지
- [ ] 새로고침해도 방금 만든 맵이 그대로 남아있는지 (Supabase에서 실제로 로드되는지)
- [ ] 대시보드에서 "이 폴더 공개"를 켜고, 공유 링크를 시크릿창(로그아웃 상태)으로 열어 목록이 보이는지
- [ ] 공개 목록에서 맵을 열었을 때 "읽기 전용" 배지가 뜨고 추가/삭제/색상/드래그가 안 되는지
- [ ] "공개"를 다시 끈 뒤 같은 시크릿창에서 새로고침하면 "폴더를 찾을 수 없거나 비공개입니다"가 뜨는지
- [ ] 예전 Claude 아티팩트 버전에서 "사본 저장"으로 받은 .json을 새 편집기의 "파일 열기"로 불러왔을 때 정상적으로 맵이 대체되는지
