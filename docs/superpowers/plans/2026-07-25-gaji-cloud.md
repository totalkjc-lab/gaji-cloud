# 가지 클라우드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-file local "가지5" mind map editor into a multi-user, cloud-synced web app: Google login → dashboard (per-user folder, public/private toggle) → mind map editor, backed by Supabase.

**Architecture:** Three build-free static HTML pages (`index.html`, `dashboard.html`, `map.html`) sharing small JS modules (`config.js`, `supabase-client.js`, `auth.js`, `permissions.js`) loaded via `<script>` tags — no bundler. Supabase (Postgres + Auth) is the only backend; access control lives in Postgres RLS policies, not app code. Deployed as a static folder to Vercel.

**Tech Stack:** Vanilla HTML/CSS/JS, Supabase JS SDK v2 (via CDN), Supabase Postgres + Auth (Google OAuth) + Row Level Security, Node.js built-in test runner (`node --test`) for the one pure logic unit, Vercel static hosting.

## Global Constraints

- Backend is Supabase; no custom server code. (spec: 아키텍처)
- One folder per user, auto-created by a DB trigger on `auth.users` insert — never client-side "create if missing" logic. (spec: 데이터 모델)
- Access control enforced by Postgres RLS policies, not app-level checks. (spec: 데이터 모델)
- Login is Google OAuth only. (spec: 결정 사항)
- Public folder visibility = link-only read access, not listed/searchable anywhere. (spec: 결정 사항)
- No build step; plain files deployable as-is to Vercel. (spec: 아키텍처)
- `map.html` keeps JSON export/import so maps exported from the older Claude-artifact version of 가지5 can be migrated in. (spec: map.html 변경점)
- Base `map.html` on the original desktop file `C:\Users\winne\OneDrive\Desktop\가지5.html`, not the CSP-stripped artifact variant — the hosted page has no artifact sandbox, so the Pretendard webfont CDN link can come back.

---

## File Structure

```
gaji-cloud/
  config.js                 Supabase project URL + anon key (user fills in)
  supabase-client.js         creates window.sb (Supabase client) from config.js
  auth.js                    window.Auth: getUser/signInWithGoogle/signOut/requireLogin
  permissions.js              isOwner(userId, folderOwnerId) — pure, used by map.html + unit tested
  index.html                 login screen
  dashboard.html + dashboard.js   folder listing (own + public read view)
  map.html                   mind map editor (adapted from 가지5.html)
  supabase-schema.sql        tables, RLS policies, auto-provision trigger
  tests/permissions.test.js  node --test unit test for permissions.js
  README.md                  Supabase/Google OAuth/Vercel setup steps + manual verification checklist
```

---

### Task 1: Supabase schema (tables, RLS, auto-provision trigger)

**Files:**
- Create: `supabase-schema.sql`

**Interfaces:**
- Produces: Postgres tables `public.folders(id, owner_id, is_public, created_at)` and `public.maps(id, folder_id, title, data, updated_at)`, both RLS-enabled, plus a trigger that inserts one `folders` row per new `auth.users` row. All later tasks' Supabase queries assume this schema exists in the user's project.

- [ ] **Step 1: Write the schema file**

```sql
-- gaji-cloud schema: per-user folder + maps, RLS-only access control,
-- auto-provision trigger. Run once in the Supabase SQL editor.

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  title text not null default '제목 없음',
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists maps_folder_id_idx on public.maps(folder_id);

alter table public.folders enable row level security;
alter table public.maps enable row level security;

-- folders: owner can always see their own; anyone (incl. anon) can see a public one
create policy "folders_select_own_or_public"
  on public.folders for select
  using (owner_id = auth.uid() or is_public = true);

-- folders: only the owner can flip is_public
create policy "folders_update_own"
  on public.folders for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- maps: readable if the parent folder is owned by the caller or is public
create policy "maps_select_via_folder"
  on public.maps for select
  using (
    exists (
      select 1 from public.folders f
      where f.id = maps.folder_id
        and (f.owner_id = auth.uid() or f.is_public = true)
    )
  );

-- maps: writable (insert/update/delete) only if the parent folder is owned by the caller
create policy "maps_write_own_folder"
  on public.maps for all
  using (
    exists (select 1 from public.folders f where f.id = maps.folder_id and f.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.folders f where f.id = maps.folder_id and f.owner_id = auth.uid())
  );

-- auto-provision exactly one folder per new user, at the source (not in client code)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.folders (owner_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Manual verification (no live project exists until the user creates one — do this once they have)**

In the Supabase dashboard: SQL Editor → paste the file → Run. Then check:
1. Table Editor shows `folders` and `maps` with the RLS lock icon enabled.
2. Authentication → Policies shows the four policies above.
3. Create a throwaway user (or sign in once via the app after Task 3), then check the `folders` table has exactly one row with that user's `owner_id` — confirms the trigger fired.

Document this as a checklist item in Task 6's README rather than re-running it now; there is no Supabase project yet at plan-writing time.

- [ ] **Step 3: Commit**

```bash
git add supabase-schema.sql
git commit -m "Add Supabase schema: folders/maps tables, RLS policies, auto-provision trigger"
```

---

### Task 2: Shared config, Supabase client, auth helper, permissions unit

**Files:**
- Create: `config.js`
- Create: `supabase-client.js`
- Create: `auth.js`
- Create: `permissions.js`
- Test: `tests/permissions.test.js`

**Interfaces:**
- Consumes: none (first app code task).
- Produces:
  - `window.GAJI_CONFIG = { supabaseUrl, supabaseAnonKey }` (from `config.js`)
  - `window.sb` — a Supabase JS client instance (from `supabase-client.js`)
  - `window.Auth.getUser(): Promise<User|null>`, `window.Auth.signInWithGoogle(): Promise<void>`, `window.Auth.signOut(): Promise<void>`, `window.Auth.requireLogin(): Promise<User|null>` (redirects to `index.html` and resolves `null` if not logged in) — from `auth.js`
  - `isOwner(userId: string|null|undefined, folderOwnerId: string|null|undefined): boolean` — from `permissions.js`, used by `map.html` (Task 5) to decide read-only mode.

- [ ] **Step 1: Write the failing test for `permissions.js`**

```js
// tests/permissions.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { isOwner } = require("../permissions.js");

test("same id is owner", () => {
  assert.equal(isOwner("u1", "u1"), true);
});
test("different id is not owner", () => {
  assert.equal(isOwner("u1", "u2"), false);
});
test("missing current user is not owner", () => {
  assert.equal(isOwner(null, "u2"), false);
  assert.equal(isOwner(undefined, "u2"), false);
});
test("missing folder owner is not owner", () => {
  assert.equal(isOwner("u1", null), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/permissions.test.js`
Expected: FAIL — `Cannot find module '../permissions.js'`

- [ ] **Step 3: Write `permissions.js`**

```js
// permissions.js — pure, no dependencies. Loaded as a plain <script> in
// map.html (defines the global `isOwner`) and required directly from Node
// for the unit test below.
function isOwner(userId, folderOwnerId) {
  return !!userId && !!folderOwnerId && userId === folderOwnerId;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { isOwner };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/permissions.test.js`
Expected: PASS — 4 tests passing

- [ ] **Step 5: Write `config.js`**

```js
// config.js — fill these in from Supabase project settings
// (Project Settings → API). The anon key is safe to publish; RLS is what
// actually protects data (see supabase-schema.sql).
window.GAJI_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY"
};
```

- [ ] **Step 6: Write `supabase-client.js`**

```js
// supabase-client.js — must load after config.js and the Supabase CDN
// script tag (<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js">).
window.sb = supabase.createClient(
  window.GAJI_CONFIG.supabaseUrl,
  window.GAJI_CONFIG.supabaseAnonKey
);
```

- [ ] **Step 7: Write `auth.js`**

```js
// auth.js — must load after supabase-client.js (uses window.sb).
window.Auth = {
  async getUser() {
    const { data } = await sb.auth.getUser();
    return data.user || null;
  },
  async signInWithGoogle() {
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/dashboard.html" }
    });
  },
  async signOut() {
    await sb.auth.signOut();
    location.href = "index.html";
  },
  async requireLogin() {
    const user = await this.getUser();
    if (!user) {
      location.href = "index.html";
      return null;
    }
    return user;
  }
};
```

- [ ] **Step 8: Commit**

```bash
git add config.js supabase-client.js auth.js permissions.js tests/permissions.test.js
git commit -m "Add shared Supabase config/client/auth helpers and permissions unit"
```

---

### Task 3: Login page (`index.html`)

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: `window.Auth.getUser()`, `window.Auth.signInWithGoogle()` (Task 2)
- Produces: entry page that redirects logged-in visitors straight to `dashboard.html`.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>가지 클라우드 — 로그인</title>
<style>
  :root{ --paper:#ECEEE8; --ink:#1B2029; --ink-soft:#5C6570; --focus:#2E6FD9; }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:var(--paper);color:var(--ink)}
  .card{text-align:center;padding:40px 36px;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(27,32,41,.12)}
  h1{margin:0 0 6px;font-size:22px}
  p{margin:0 0 24px;color:var(--ink-soft);font-size:14px}
  button{appearance:none;border:0;border-radius:10px;background:var(--focus);color:#fff;
    font:600 14px system-ui;padding:12px 22px;cursor:pointer}
  button:disabled{opacity:.6;cursor:default}
</style>
</head>
<body>
  <div class="card">
    <h1>가지 클라우드</h1>
    <p>구글 계정으로 로그인하세요</p>
    <button id="google">구글로 로그인</button>
  </div>
  <script src="config.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script src="supabase-client.js"></script>
  <script src="auth.js"></script>
  <script>
    (async () => {
      const user = await Auth.getUser();
      if (user) { location.href = "dashboard.html"; return; }
      document.getElementById("google").addEventListener("click", async (e) => {
        e.target.disabled = true;
        await Auth.signInWithGoogle();
      });
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manual check**

This page needs a live Supabase project with Google auth configured to fully exercise (that's Task 6). For now, verify it at least loads without console errors: open `index.html` directly in a browser (`file://` is fine for this static check) and confirm the card renders and the button is clickable (the actual `Auth.signInWithGoogle()` call will fail until `config.js` has real values — expected at this stage).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add Google login page"
```

---

### Task 4: Dashboard (`dashboard.html` + `dashboard.js`)

**Files:**
- Create: `dashboard.html`
- Create: `dashboard.js`

**Interfaces:**
- Consumes: `window.sb` (Task 2), `window.Auth.requireLogin()`, `window.Auth.signOut()` (Task 2)
- Produces: `dashboard.html` (no query param) = owner view of the caller's folder; `dashboard.html?folder=<id>` = public read-only view of someone else's public folder. Both list maps as links to `map.html?id=<mapId>` (consumed by Task 5).

- [ ] **Step 1: Write `dashboard.html`**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>가지 클라우드 — 내 맵</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
  :root{ --paper:#ECEEE8; --ink:#1B2029; --ink-soft:#5C6570; --line:#DCE0D6; --focus:#2E6FD9; }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:var(--paper);color:var(--ink);
    font-family:"Pretendard Variable",Pretendard,system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
  header{display:flex;align-items:center;gap:12px;padding:20px 24px;border-bottom:1px solid var(--line)}
  header h1{font-size:18px;margin:0;flex:1}
  #who{font-size:13px;color:var(--ink-soft)}
  #readonly-badge{display:none;font:600 12px system-ui;color:#fff;background:#8358CE;padding:4px 10px;border-radius:20px}
  #owner-controls{display:none;align-items:center;gap:10px;padding:16px 24px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  #owner-controls label{display:flex;align-items:center;gap:6px;font-size:13px}
  #share-link{font:12px ui-monospace,monospace;padding:6px 8px;border:1px solid var(--line);border-radius:6px;width:280px;max-width:60vw}
  button{appearance:none;border:0;border-radius:8px;background:var(--ink);color:var(--paper);
    font:600 13px system-ui;padding:8px 14px;cursor:pointer}
  button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
  #list{display:grid;gap:10px;padding:20px 24px;max-width:640px}
  .item{display:block;padding:14px 16px;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(27,32,41,.08);
    text-decoration:none;color:var(--ink)}
  .item .nm{font-weight:700;font-size:14px}
  .item .sub{font-size:12px;color:var(--ink-soft);margin-top:4px}
  .empty{padding:24px;text-align:center;color:var(--ink-soft);font-size:13px}
</style>
</head>
<body>
  <header>
    <h1>가지 클라우드</h1>
    <span id="readonly-badge">읽기 전용 — 공개 폴더</span>
    <span id="who"></span>
    <button class="ghost" id="logout">로그아웃</button>
  </header>
  <div id="owner-controls">
    <label><input type="checkbox" id="public-toggle"> 이 폴더 공개</label>
    <input id="share-link" readonly>
    <button id="newmap">+ 새로 만들기</button>
  </div>
  <div id="list"></div>
  <script src="config.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script src="supabase-client.js"></script>
  <script src="auth.js"></script>
  <script src="dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `dashboard.js`**

```js
(() => {
  "use strict";
  const $ = s => document.querySelector(s);

  function fmtTime(t) {
    return new Date(t).toLocaleString("ko-KR");
  }

  function renderList(maps) {
    const box = $("#list");
    box.innerHTML = "";
    if (!maps.length) {
      box.innerHTML = '<div class="empty">아직 맵이 없습니다.</div>';
      return;
    }
    for (const m of maps) {
      const a = document.createElement("a");
      a.className = "item";
      a.href = `map.html?id=${m.id}`;
      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = m.title || "제목 없음";
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = fmtTime(m.updated_at);
      a.append(nm, sub);
      box.appendChild(a);
    }
  }

  async function loadOwn() {
    const user = await Auth.requireLogin();
    if (!user) return;
    $("#who").textContent = user.email;
    $("#owner-controls").style.display = "flex";

    const { data: folder, error } = await sb.from("folders").select("*").eq("owner_id", user.id).single();
    if (error || !folder) {
      $("#list").innerHTML = '<div class="empty">폴더를 불러오지 못했습니다. 새로고침해 보세요.</div>';
      return;
    }

    $("#public-toggle").checked = !!folder.is_public;
    $("#public-toggle").addEventListener("change", async (e) => {
      await sb.from("folders").update({ is_public: e.target.checked }).eq("id", folder.id);
    });
    $("#share-link").value = `${location.origin}/dashboard.html?folder=${folder.id}`;

    $("#newmap").addEventListener("click", async () => {
      const { data, error } = await sb
        .from("maps")
        .insert({
          folder_id: folder.id,
          title: "중심 주제",
          data: { id: "n1", text: "중심 주제", children: [], collapsed: false, color: null, side: null }
        })
        .select()
        .single();
      if (error) {
        alert("맵을 만들지 못했습니다: " + error.message);
        return;
      }
      location.href = `map.html?id=${data.id}`;
    });

    const { data: maps } = await sb
      .from("maps")
      .select("id,title,updated_at")
      .eq("folder_id", folder.id)
      .order("updated_at", { ascending: false });
    renderList(maps || []);
  }

  async function loadPublic(folderId) {
    $("#owner-controls").style.display = "none";
    $("#readonly-badge").style.display = "inline";
    $("#logout").style.display = "none";

    const { data: folder, error } = await sb.from("folders").select("id,is_public").eq("id", folderId).single();
    if (error || !folder || !folder.is_public) {
      $("#list").innerHTML = '<div class="empty">폴더를 찾을 수 없거나 비공개입니다.</div>';
      return;
    }
    const { data: maps } = await sb
      .from("maps")
      .select("id,title,updated_at")
      .eq("folder_id", folder.id)
      .order("updated_at", { ascending: false });
    renderList(maps || []);
  }

  $("#logout").addEventListener("click", () => Auth.signOut());

  const folderParam = new URLSearchParams(location.search).get("folder");
  if (folderParam) loadPublic(folderParam);
  else loadOwn();
})();
```

- [ ] **Step 3: Manual check**

Same caveat as Task 3 — full behavior needs a live Supabase project (Task 6). For now confirm the file parses and renders its static shell: open in a browser and check the header/controls appear with no JS syntax errors in devtools console (network calls to Supabase will fail until `config.js` is real — expected).

- [ ] **Step 4: Commit**

```bash
git add dashboard.html dashboard.js
git commit -m "Add dashboard: own-folder management and public read-only folder view"
```

---

### Task 5: Mind map editor (`map.html`)

**Files:**
- Create: `map.html` (start from `C:\Users\winne\OneDrive\Desktop\가지5.html`, then apply the patches below)
- Modify (within the new file): remove all local-storage/library/PC-file-link code, add Supabase load/save and read-only mode

**Interfaces:**
- Consumes: `window.sb`, `window.Auth.getUser()` (Task 2), `isOwner(userId, folderOwnerId)` (Task 2), the `maps` table schema (Task 1)
- Produces: `map.html?id=<mapId>` — the only way this page is entered (from Task 4's dashboard links)

- [ ] **Step 1: Copy the original file as the starting point**

```bash
cp "/c/Users/winne/OneDrive/Desktop/가지5.html" "/c/Users/winne/Downloads/gaji-cloud/map.html"
```

- [ ] **Step 2: Update the title**

Find:
```html
<title>가지5 — 마인드맵</title>
```
Replace with:
```html
<title>가지 클라우드 — 편집기</title>
```

- [ ] **Step 3: Load the shared Supabase/auth/permissions scripts**

Find:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
```
Replace with:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<script src="config.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="supabase-client.js"></script>
<script src="auth.js"></script>
<script src="permissions.js"></script>
```

- [ ] **Step 4: Trim the toolbar — drop the local-library and PC-file-link buttons**

Find:
```html
  <button class="btn" data-act="lib">내 맵</button>
  <button class="btn" data-act="import">파일 열기</button>
  <button class="btn" data-act="export">사본 저장</button>
  <button class="btn" id="linkbtn" data-act="link">PC 파일 연결</button>
  <div class="sep"></div>
```
Replace with:
```html
  <button class="btn" data-act="import">파일 열기</button>
  <button class="btn" data-act="export">사본 저장</button>
  <div class="sep"></div>
```

Find:
```html
  <button id="docname" title="맵 목록 열기">맵</button>
```
Replace with:
```html
  <button id="docname" title="대시보드로">맵</button>
```

- [ ] **Step 5: Delete the "내 맵" library sheet**

Find and delete this entire block:
```html
<div id="lib" class="sheet">
  <div class="card">
    <header><h2>내 맵</h2><span class="note" id="storenote"></span></header>
    <div id="liblist"></div>
    <div class="row">
      <button class="btn primary" data-act="newmap">새 맵</button>
      <button class="btn" data-act="import">파일 열기</button>
      <button class="btn" data-act="export">사본 내려받기</button>
      <div class="spacer"></div>
      <button class="btn" data-act="closesheet">닫기</button>
    </div>
  </div>
</div>
```

- [ ] **Step 6: Update the help sheet text and shortcut table**

Find:
```html
        <tr><td><kbd>Ctrl</kbd>+<kbd>O</kbd></td><td>내 맵 목록 열기</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>사본을 .json 파일로 내려받기</td></tr>
      </table>
      <p class="sub" style="margin-top:18px">
        고칠 때마다 자동으로 저장됩니다. 맵 이름은 중심 주제를 따라갑니다.
        「PC 파일 연결」을 하면 지정한 <b>.json 파일에도 같이</b> 기록되어, 그 파일 하나로 옮기고 백업할 수 있습니다.
      </p>
```
Replace with:
```html
        <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>사본을 .json 파일로 내려받기</td></tr>
      </table>
      <p class="sub" style="margin-top:18px">
        고칠 때마다 자동으로 클라우드에 저장됩니다. 맵 이름은 중심 주제를 따라갑니다.
        상단의 「맵」을 누르면 대시보드로 돌아갑니다.
      </p>
```

- [ ] **Step 7: Replace the entire script** — this is the big one. Find the whole block starting at `<script>` and ending at `</script>` (the original ~900-line IIFE) and replace it with:

```html
<script>
(() => {
"use strict";

/* ===================== 기본값 ===================== */
const PALETTE = ["#D6455C","#E2841F","#2FA37A","#2E6FD9","#8358CE","#C0357E","#0E9BA6","#7A8B2E"];
const ROOT_INK = "#232B36";
const HGAP = 58, VGAP = 14, MAXW = 200;
const stage = document.getElementById("stage");
const world = document.getElementById("world");
const svg   = document.getElementById("edges");
const $ = s => document.querySelector(s);

let uid = 1;
const nid = () => "n" + (uid++);
function mk(text, color){ return { id:nid(), text, children:[], collapsed:false, color:color||null, side:null }; }

/* ===================== 상태 ===================== */
const mapId = new URLSearchParams(location.search).get("id");
let ownerId = null, readOnly = true;
let root = null;
let selected = null;
let editing = null;
let view = { x:0, y:0, z:1 };
let dark = false;
const undoStack = [], redoStack = [];
const nodeEls = new Map();

function mapTitle(){ return (root && root.text ? root.text : "제목 없음").split("\n")[0]; }

/* ===================== Supabase 연동 ===================== */
async function loadMap(){
  if(!mapId){
    document.body.innerHTML = '<p style="padding:40px;font:15px system-ui">잘못된 주소입니다. <a href="dashboard.html">대시보드로</a></p>';
    throw new Error("no id");
  }
  const { data: mapRow, error } = await sb.from("maps").select("id,folder_id,title,data,updated_at").eq("id", mapId).single();
  if(error || !mapRow){
    document.body.innerHTML = '<p style="padding:40px;font:15px system-ui">맵을 찾을 수 없거나 접근 권한이 없습니다. <a href="dashboard.html">대시보드로</a></p>';
    throw new Error("not found");
  }
  const { data: folder } = await sb.from("folders").select("owner_id").eq("id", mapRow.folder_id).single();
  ownerId = folder ? folder.owner_id : null;
  const user = await Auth.getUser();
  readOnly = !isOwner(user && user.id, ownerId);
  root = mapRow.data;
  reindex(root);
  selected = root.id;
  if(readOnly) applyReadOnly();
}
function applyReadOnly(){
  document.body.classList.add("readonly");
  ["child","sibling","color","del","undo","import"].forEach(act => {
    const b = document.querySelector(`[data-act="${act}"]`);
    if(b) b.style.display = "none";
  });
  const badge = document.createElement("span");
  badge.textContent = "읽기 전용";
  badge.style.cssText = "font:600 11px system-ui;color:#fff;background:#8358CE;padding:4px 10px;border-radius:20px;margin-left:8px";
  $("#status").after(badge);
}

/* ===================== 트리 도구 ===================== */
function walk(n, fn, parent=null, depth=0){
  fn(n, parent, depth);
  n.children.forEach(c => walk(c, fn, n, depth+1));
}
function find(id){ let r=null; walk(root, n => { if(n.id===id) r=n; }); return r; }
function parentOf(id){ let r=null; walk(root, (n,p) => { if(n.id===id) r=p; }); return r; }
function depthOf(id){ let r=0; walk(root, (n,p,d) => { if(n.id===id) r=d; }); return r; }
function isAncestor(a,b){ let hit=false; walk(a, n => { if(n===b) hit=true; }); return hit; }
function countAll(n){ let c=0; walk(n, () => c++); return c; }
function reindex(r){ let max=0; walk(r, n => { const v = parseInt(String(n.id).slice(1),10); if(v>max) max=v; }); uid = max+1; }
function branchColor(n){
  let cur = n, chain = [];
  while(cur && cur !== root){ chain.push(cur); cur = parentOf(cur.id); }
  for(const c of chain){ if(c.color) return c.color; }
  const top = chain[chain.length-1];
  if(!top) return ROOT_INK;
  const i = root.children.indexOf(top);
  return PALETTE[(i<0?0:i) % PALETTE.length];
}

/* ===================== 글자 계측 ===================== */
const mc = document.createElement("canvas").getContext("2d");
function styleOf(depth){
  if(depth===0) return { size:17, weight:700, padX:20, padY:13, cls:"lv0" };
  if(depth===1) return { size:15, weight:600, padX:15, padY:10, cls:"lv1" };
  return { size:14, weight:500, padX:12, padY:8, cls:"lvN" };
}
function wrap(text, st){
  mc.font = `${st.weight} ${st.size}px ${getComputedStyle(document.body).fontFamily}`;
  const out = [];
  for(const para of String(text).split("\n")){
    if(mc.measureText(para).width <= MAXW){ out.push(para); continue; }
    let line = "";
    for(const ch of para){
      if(mc.measureText(line+ch).width > MAXW && line){ out.push(line); line = ch; }
      else line += ch;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}
function measure(n, depth){
  const st = styleOf(depth);
  const lines = wrap(n.text || " ", st);
  let w = 0;
  for(const l of lines) w = Math.max(w, mc.measureText(l).width);
  n._lines = lines; n._st = st;
  n.w = Math.round(Math.max(w,24) + st.padX*2);
  n.h = Math.round(lines.length*(st.size+6) + st.padY*2);
}

/* ===================== 배치 ===================== */
function subtreeH(n){
  if(n.collapsed || !n.children.length) return n.h;
  let t = 0;
  n.children.forEach((c,i) => { t += subtreeH(c) + (i ? VGAP : 0); });
  return Math.max(t, n.h);
}
function place(n, cx, cy, dir){
  n.cx = cx; n.cy = cy; n.dir = dir;
  if(n.collapsed || !n.children.length) return;
  let y = cy - subtreeH(n)/2;
  for(const c of n.children){
    const h = subtreeH(c);
    place(c, cx + dir*(n.w/2 + HGAP + c.w/2), y + h/2, dir);
    y += h + VGAP;
  }
}
function layout(){
  walk(root, (n,p,d) => measure(n,d));
  root.cx = 0; root.cy = 0; root.dir = 1;
  const R = [], L = [];
  root.children.forEach(c => {
    if(c.side !== "L" && c.side !== "R") c.side = (R.length <= L.length) ? "R" : "L";
    (c.side === "L" ? L : R).push(c);
  });
  const side = (list, dir) => {
    let total = 0;
    list.forEach((c,i) => { total += subtreeH(c) + (i ? VGAP : 0); });
    let y = -total/2;
    for(const c of list){
      const h = subtreeH(c);
      place(c, dir*(root.w/2 + HGAP + c.w/2), y + h/2, dir);
      y += h + VGAP;
    }
  };
  side(R,1); side(L,-1);
}

/* ===================== 그리기 ===================== */
function taper(p,c){
  const dir = c.cx > p.cx ? 1 : -1;
  const x1 = p.cx + dir*p.w/2, y1 = p.cy;
  const x2 = c.cx - dir*c.w/2, y2 = c.cy;
  const dx = Math.abs(x2-x1)*0.5;
  const d1 = depthOf(c.id);
  const w1 = Math.max(2.2, 7 - d1*1.4), w2 = Math.max(1.4, w1*0.5);
  const cp1x = x1 + dir*dx, cp2x = x2 - dir*dx;
  return `M ${x1} ${y1-w1/2} C ${cp1x} ${y1-w1/2}, ${cp2x} ${y2-w2/2}, ${x2} ${y2-w2/2}`
       + ` L ${x2} ${y2+w2/2} C ${cp2x} ${y2+w2/2}, ${cp1x} ${y1+w1/2}, ${x1} ${y1+w1/2} Z`;
}
function render(){
  layout();
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  const visible = [];
  (function collect(n,d){
    visible.push([n,d]);
    minX=Math.min(minX,n.cx-n.w/2); maxX=Math.max(maxX,n.cx+n.w/2);
    minY=Math.min(minY,n.cy-n.h/2); maxY=Math.max(maxY,n.cy+n.h/2);
    if(!n.collapsed) n.children.forEach(c => collect(c,d+1));
  })(root,0);
  const pad = 60;
  svg.style.left = (minX-pad)+"px"; svg.style.top = (minY-pad)+"px";
  svg.setAttribute("width", maxX-minX+pad*2); svg.setAttribute("height", maxY-minY+pad*2);
  svg.setAttribute("viewBox", `${minX-pad} ${minY-pad} ${maxX-minX+pad*2} ${maxY-minY+pad*2}`);

  let paths = "";
  for(const [n] of visible){
    if(n.collapsed) continue;
    for(const c of n.children) paths += `<path d="${taper(n,c)}" fill="${branchColor(c)}" />`;
  }
  svg.innerHTML = paths;

  const alive = new Set();
  for(const [n,d] of visible){
    alive.add(n.id);
    let el = nodeEls.get(n.id);
    if(!el){
      el = document.createElement("div");
      el.className = "node"; el.dataset.id = n.id;
      world.appendChild(el); nodeEls.set(n.id, el);
    }
    const col = branchColor(n);
    el.className = "node " + n._st.cls + (n.id===selected ? " sel" : "") + (n.id===editing ? " editing" : "");
    el.style.left = (n.cx-n.w/2)+"px"; el.style.top = (n.cy-n.h/2)+"px";
    if(n.id !== editing){ el.style.width = n.w+"px"; el.style.height = n.h+"px"; }
    el.style.font = `${n._st.weight} ${n._st.size}px/${n._st.size+6}px var(--font)`;
    el.style.padding = `${n._st.padY}px ${n._st.padX}px`;
    if(d===0){ el.style.background = n.color || ROOT_INK; el.style.borderBottom = ""; }
    else if(d===1){ el.style.background = col; el.style.borderBottom = ""; }
    else { el.style.background = ""; el.style.borderBottom = `2px solid ${col}`; }
    if(n.id !== editing) el.textContent = n._lines.join("\n");

    let tg = el._tg;
    if(n.children.length){
      if(!tg){
        tg = document.createElement("div");
        tg.className = "toggle";
        tg.addEventListener("pointerdown", e => e.stopPropagation());
        tg.addEventListener("click", e => { e.stopPropagation(); push(); n.collapsed = !n.collapsed; render(); });
        world.appendChild(tg); el._tg = tg;
      }
      const dir = n===root ? 1 : n.dir;
      tg.style.left = (n.cx + dir*(n.w/2) - 9 + dir*10)+"px";
      tg.style.top = (n.cy-9)+"px";
      tg.style.background = col;
      tg.textContent = n.collapsed ? String(countAll(n)-1) : "−";
      tg.style.display = "flex";
    } else if(tg){ tg.style.display = "none"; }
  }
  for(const [id,el] of nodeEls){
    if(!alive.has(id)){ el.remove(); if(el._tg) el._tg.remove(); nodeEls.delete(id); }
  }
  applyView();
  if(editing){ const en = find(editing); if(en && en.cx !== undefined) showBadge(en); }
  $("#docname").textContent = mapTitle();
  persist();
}
function applyView(){
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  $("#zlabel").textContent = Math.round(view.z*100)+"%";
}
function clearNodes(){
  for(const [,el] of nodeEls){ el.remove(); if(el._tg) el._tg.remove(); }
  nodeEls.clear();
}

/* ===================== 자동 저장 ===================== */
let saveTimer = null, lastSaved = null, lastSer = null;
function setStatus(text, cls){
  const s = $("#status");
  s.textContent = text; s.className = cls || "";
}
function stamp(d){
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2,"0");
  return `${h<12?"오전":"오후"} ${((h+11)%12)+1}:${m}`;
}
function persist(){
  if(readOnly) return;
  const ser = JSON.stringify(root);
  if(ser === lastSer) return;
  lastSer = ser;
  setStatus("저장 중…","saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { error } = await sb.from("maps")
      .update({ title: mapTitle(), data: root, updated_at: new Date().toISOString() })
      .eq("id", mapId);
    lastSaved = new Date();
    setStatus(error ? "자동 저장 꺼짐" : "저장됨 · " + stamp(lastSaved), error ? "off" : "");
  }, 600);
}

/* ===================== 되돌리기 ===================== */
function snap(){ return JSON.stringify({ root, selected }); }
function push(){ undoStack.push(snap()); if(undoStack.length>80) undoStack.shift(); redoStack.length = 0; }
function restore(s){
  const o = JSON.parse(s);
  root = o.root; selected = o.selected; reindex(root);
  clearNodes(); render();
}
function undo(){ if(!undoStack.length) return toast("되돌릴 작업이 없습니다"); redoStack.push(snap()); restore(undoStack.pop()); }
function redo(){ if(!redoStack.length) return toast("다시 실행할 작업이 없습니다"); undoStack.push(snap()); restore(redoStack.pop()); }

/* ===================== 편집 ===================== */
function addChild(){
  if(readOnly) return;
  const n = find(selected); if(!n) return;
  push(); n.collapsed = false;
  const c = mk("새 주제"); n.children.push(c); selected = c.id;
  render(); startEdit();
}
function addSibling(){
  if(readOnly) return;
  const n = find(selected); if(!n) return;
  if(n === root) return addChild();
  push();
  const p = parentOf(n.id), c = mk("새 주제");
  if(p === root) c.side = n.side;
  p.children.splice(p.children.indexOf(n)+1, 0, c);
  selected = c.id; render(); startEdit();
}
function removeNode(){
  if(readOnly) return;
  const n = find(selected);
  if(!n || n === root) return toast("중심 주제는 지울 수 없습니다");
  push();
  const p = parentOf(n.id), i = p.children.indexOf(n);
  p.children.splice(i,1);
  selected = (p.children[i] || p.children[i-1] || p).id;
  render();
}
function toggleCollapse(){
  const n = find(selected);
  if(!n || !n.children.length) return;
  push(); n.collapsed = !n.collapsed; render();
}
let badge = null;
function showBadge(n){
  if(!badge){
    badge = document.createElement("div");
    badge.className = "editbadge";
    badge.innerHTML = '<span class="bar"></span>수정 중<span class="dim">Enter 저장 · Esc 취소</span>';
    world.appendChild(badge);
  }
  badge.style.left = n.cx + "px";
  badge.style.top = (n.cy - n.h/2 - 30) + "px";
  badge.style.display = "flex";
}
function hideBadge(){ if(badge) badge.style.display = "none"; }

function startEdit(){
  if(readOnly) return;
  const n = find(selected); if(!n) return;
  const el = nodeEls.get(n.id); if(!el) return;
  editing = n.id;
  el.classList.add("editing");
  el.contentEditable = "true";
  el.spellcheck = false;
  el.style.width = "auto"; el.style.minWidth = MAXW+"px"; el.style.height = "auto";
  el.style.userSelect = "text"; el.style.webkitUserSelect = "text"; el.style.caretColor = "var(--focus)";
  el.textContent = n.text;
  const selectAll = () => {
    el.focus();
    try{
      const r = document.createRange(); r.selectNodeContents(el);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }catch{}
  };
  selectAll();
  requestAnimationFrame(() => { if(editing === n.id && document.activeElement !== el) selectAll(); });
  showBadge(n);
}
function commitEdit(save=true){
  if(!editing) return;
  const n = find(editing), el = nodeEls.get(editing);
  editing = null; hideBadge();
  if(el){
    if(save && n) n.text = el.textContent.replace(/\u00a0/g," ").trim() || "빈 주제";
    el.contentEditable = "false"; el.style.minWidth = "";
    el.style.userSelect = ""; el.style.webkitUserSelect = ""; el.style.caretColor = "";
  }
  render();
}

/* ===================== 이동 ===================== */
function move(dir){
  const n = find(selected); if(!n) return;
  const out = n===root ? 1 : n.dir;
  const p = parentOf(n.id);
  let t = null;
  if((dir==="right" && out===1) || (dir==="left" && out===-1)){
    if(n.children.length && !n.collapsed) t = n.children[0];
    else if(n===root) t = root.children.find(c => c.side===(dir==="right"?"R":"L"));
  } else if(dir==="left" || dir==="right"){
    t = n===root ? root.children.find(c => c.side===(dir==="right"?"R":"L")) : p;
  } else if(p){
    const sib = p.children.filter(c => p!==root || c.side===n.side);
    const i = sib.indexOf(n);
    t = dir==="up" ? sib[i-1] : sib[i+1];
  }
  if(t){ selected = t.id; render(); ensureVisible(t); }
}
function ensureVisible(n){
  const sx = n.cx*view.z + view.x, sy = n.cy*view.z + view.y, m = 120;
  let dx=0, dy=0;
  if(sx < m) dx = m-sx;
  if(sx > innerWidth-m) dx = innerWidth-m-sx;
  if(sy < m) dy = m-sy;
  if(sy > innerHeight-m) dy = innerHeight-m-sy;
  if(dx||dy){ view.x += dx; view.y += dy; applyView(); }
}

/* ===================== 화면 ===================== */
function fit(){
  layout();
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  (function c(n){
    minX=Math.min(minX,n.cx-n.w/2); maxX=Math.max(maxX,n.cx+n.w/2);
    minY=Math.min(minY,n.cy-n.h/2); maxY=Math.max(maxY,n.cy+n.h/2);
    if(!n.collapsed) n.children.forEach(c);
  })(root);
  const pad = 90;
  const z = Math.min(1.2, (innerWidth-pad*2)/(maxX-minX), (innerHeight-pad*2-100)/(maxY-minY));
  view.z = Math.max(0.2, Math.min(2, z));
  view.x = innerWidth/2 - ((minX+maxX)/2)*view.z;
  view.y = (innerHeight/2+22) - ((minY+maxY)/2)*view.z;
  applyView();
}
function zoomAt(f,px,py){
  const z2 = Math.max(0.2, Math.min(3, view.z*f));
  view.x = px - (px-view.x)*(z2/view.z);
  view.y = py - (py-view.y)*(z2/view.z);
  view.z = z2; applyView();
}

/* ===================== 포인터 ===================== */
let pan=null, drag=null, dropTarget=null, pinch=null, lastTap=null;
stage.addEventListener("pointerdown", e => {
  const nodeEl = e.target.closest(".node");
  if(editing && (!nodeEl || nodeEl.dataset.id !== editing)) commitEdit();
  if(nodeEl){
    if(nodeEl.dataset.id === editing) return;
    const n = find(nodeEl.dataset.id); if(!n) return;
    const now = Date.now();
    const twice = lastTap && lastTap.id === n.id && (now - lastTap.t) < 450
                  && Math.hypot(e.clientX-lastTap.x, e.clientY-lastTap.y) < 12;
    lastTap = { id:n.id, t:now, x:e.clientX, y:e.clientY };
    selected = n.id; render();
    if(twice){ lastTap = null; startEdit(); return; }
    if(readOnly){ drag = null; return; }
    drag = { n, sx:e.clientX, sy:e.clientY, on:false, pid:e.pointerId };
  } else {
    lastTap = null;
    pan = { x:e.clientX, y:e.clientY, vx:view.x, vy:view.y };
    stage.classList.add("panning"); stage.setPointerCapture(e.pointerId);
  }
});
stage.addEventListener("pointermove", e => {
  if(pan){ view.x = pan.vx + (e.clientX-pan.x); view.y = pan.vy + (e.clientY-pan.y); applyView(); return; }
  if(!drag) return;
  if(!drag.on && Math.hypot(e.clientX-drag.sx, e.clientY-drag.sy) > 6){
    if(drag.n === root){ drag = null; return; }
    drag.on = true;
    try{ stage.setPointerCapture(drag.pid); }catch{}
    const el = nodeEls.get(drag.n.id); if(el) el.classList.add("ghost");
  }
  if(!drag.on) return;
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const el = hit ? hit.closest(".node") : null;
  const t = el ? find(el.dataset.id) : null;
  const ok = t && t !== drag.n && !isAncestor(drag.n, t);
  if(dropTarget && dropTarget !== t){ const p = nodeEls.get(dropTarget.id); if(p) p.classList.remove("drop"); }
  dropTarget = ok ? t : null;
  if(dropTarget){ const p = nodeEls.get(dropTarget.id); if(p) p.classList.add("drop"); }
});
function endPointer(){
  stage.classList.remove("panning"); pan = null; pinch = null;
  if(drag && drag.on){
    const g = nodeEls.get(drag.n.id); if(g) g.classList.remove("ghost");
    if(dropTarget){
      push();
      const p = parentOf(drag.n.id);
      p.children.splice(p.children.indexOf(drag.n),1);
      dropTarget.collapsed = false;
      dropTarget.children.push(drag.n);
      drag.n.side = dropTarget === root
        ? (root.children.filter(c=>c.side==="R").length <= root.children.filter(c=>c.side==="L").length ? "R" : "L")
        : null;
      const d = nodeEls.get(dropTarget.id); if(d) d.classList.remove("drop");
    }
  }
  dropTarget = null; drag = null; render();
}
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);
stage.addEventListener("dblclick", e => {
  if(editing) return;
  let el = e.target.closest(".node");
  if(!el){
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    el = hit ? hit.closest(".node") : null;
  }
  if(el){ selected = el.dataset.id; render(); startEdit(); }
});
stage.addEventListener("wheel", e => {
  e.preventDefault();
  if(e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40) zoomAt(e.deltaY < 0 ? 1.12 : 1/1.12, e.clientX, e.clientY);
  else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
}, {passive:false});
stage.addEventListener("touchstart", e => {
  if(e.touches.length === 2){
    const [a,b] = e.touches;
    pinch = { d: Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY) }; pan = null;
  }
}, {passive:true});
stage.addEventListener("touchmove", e => {
  if(pinch && e.touches.length === 2){
    const [a,b] = e.touches;
    const d = Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
    zoomAt(d/pinch.d, (a.clientX+b.clientX)/2, (a.clientY+b.clientY)/2);
    pinch.d = d;
  }
}, {passive:true});
stage.addEventListener("touchend", () => { pinch = null; }, {passive:true});

/* ===================== 키보드 ===================== */
addEventListener("keydown", e => {
  if(readOnly && !["ArrowRight","ArrowLeft","ArrowUp","ArrowDown","Escape"," "].includes(e.key)
     && !((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="s")) return;
  if(editing){
    if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); commitEdit(true); }
    else if(e.key === "Escape"){ e.preventDefault(); commitEdit(false); }
    else if(e.key === "Tab"){ e.preventDefault(); commitEdit(true); addChild(); }
    return;
  }
  const sheetOpen = !!document.querySelector(".sheet.open");
  const k = e.key;
  if((e.ctrlKey||e.metaKey) && k.toLowerCase()==="z"){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if((e.ctrlKey||e.metaKey) && k.toLowerCase()==="s"){ e.preventDefault(); exportJSON(); return; }
  if(k === "Escape"){ closeSheets(); closePalette(); return; }
  if(sheetOpen) return;
  if(k === "Tab"){ e.preventDefault(); addChild(); }
  else if(k === "Enter"){ e.preventDefault(); addSibling(); }
  else if(k === "F2"){ e.preventDefault(); startEdit(); }
  else if(k === "Delete" || k === "Backspace"){ e.preventDefault(); removeNode(); }
  else if(k === " "){ e.preventDefault(); toggleCollapse(); }
  else if(k === "ArrowRight"){ e.preventDefault(); move("right"); }
  else if(k === "ArrowLeft"){ e.preventDefault(); move("left"); }
  else if(k === "ArrowUp"){ e.preventDefault(); move("up"); }
  else if(k === "ArrowDown"){ e.preventDefault(); move("down"); }
  else if(!e.ctrlKey && !e.metaKey && !e.altKey
          && (k.length === 1 || k === "Process" || e.keyCode === 229)){
    const n = find(selected); if(!n) return;
    push(); startEdit();
    if(k.length === 1){
      e.preventDefault();
      const el = nodeEls.get(selected);
      if(el){
        el.textContent = k;
        const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
    }
  }
});

/* ===================== 색상 ===================== */
const pal = $("#palette");
PALETTE.concat([ROOT_INK]).forEach(c => {
  const b = document.createElement("button");
  b.className = "swatch"; b.style.background = c; b.title = c;
  b.onclick = () => { const n = find(selected); if(n){ push(); n.color = c; render(); } closePalette(); };
  pal.appendChild(b);
});
const rst = document.createElement("button");
rst.className = "swatch";
rst.style.cssText = "background:transparent;border:1px dashed var(--panel-line);color:var(--ink-soft);font-size:11px";
rst.textContent = "↺"; rst.title = "가지 색 되돌리기";
rst.onclick = () => { const n = find(selected); if(n){ push(); n.color = null; render(); } closePalette(); };
pal.appendChild(rst);
function openPalette(btn){
  const r = btn.getBoundingClientRect();
  pal.style.left = r.left+"px"; pal.style.top = (r.bottom+8)+"px";
  pal.classList.add("open");
}
function closePalette(){ pal.classList.remove("open"); }
addEventListener("pointerdown", e => {
  if(!e.target.closest("#palette") && !e.target.closest('[data-act="color"]')) closePalette();
});

/* ===================== 파일 입출력 ===================== */
function download(name, blob){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function safeName(s){ return String(s).replace(/[\\/:*?"<>|\n]/g,"_").slice(0,60).trim() || "마인드맵"; }
function exportJSON(){
  download(safeName(mapTitle())+".json",
    new Blob([JSON.stringify({app:"gaji",v:2,root},null,2)],{type:"application/json"}));
  toast("사본을 내려받았습니다");
}
function importFile(){ if(readOnly) return; $("#file").click(); }
$("#file").addEventListener("change", ev => {
  const f = ev.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    try{
      const obj = JSON.parse(r.result);
      const r2 = obj && (obj.root || (obj.children ? obj : null));
      if(!r2 || !r2.children) throw new Error("bad");
      push(); root = r2; reindex(root); selected = root.id; editing = null;
      clearNodes(); render(); fit();
      toast("맵을 불러왔습니다");
    }catch{ toast("이 파일은 열 수 없습니다"); }
  };
  r.readAsText(f); ev.target.value = "";
});
function exportMD(){
  let out = "";
  walk(root, (n,p,d) => { out += d===0 ? `# ${n.text}\n\n` : `${"  ".repeat(d-1)}- ${n.text.replace(/\n/g," ")}\n`; });
  download(safeName(mapTitle())+".md", new Blob([out],{type:"text/markdown"}));
  toast("마크다운으로 내보냈습니다");
}
function exportPNG(){
  layout();
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  const list = [];
  (function c(n,d){
    list.push([n,d]);
    minX=Math.min(minX,n.cx-n.w/2); maxX=Math.max(maxX,n.cx+n.w/2);
    minY=Math.min(minY,n.cy-n.h/2); maxY=Math.max(maxY,n.cy+n.h/2);
    if(!n.collapsed) n.children.forEach(x => c(x,d+1));
  })(root,0);
  const pad = 48, W = maxX-minX+pad*2, H = maxY-minY+pad*2;
  const bg = dark ? "#12171D" : "#ECEEE8";
  const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  let body = "";
  for(const [n] of list){
    if(n.collapsed) continue;
    for(const ch of n.children) body += `<path d="${taper(n,ch)}" fill="${branchColor(ch)}"/>`;
  }
  for(const [n,d] of list){
    const col = branchColor(n), st = n._st;
    const x = n.cx-n.w/2, y = n.cy-n.h/2;
    if(d===0) body += `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="14" fill="${n.color||ROOT_INK}"/>`;
    else if(d===1) body += `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="10" fill="${col}"/>`;
    else body += `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="8" fill="${dark?"#1A212A":"#ffffff"}"/>`
               + `<rect x="${x}" y="${y+n.h-2}" width="${n.w}" height="2" fill="${col}"/>`;
    const fill = d<=1 ? "#ffffff" : (dark ? "#E7EBF0" : "#1B2029");
    const lh = st.size+6, top = n.cy - (n._lines.length-1)*lh/2;
    n._lines.forEach((l,i) => {
      body += `<text x="${n.cx}" y="${top+i*lh}" fill="${fill}" font-size="${st.size}" font-weight="${st.weight}"`
            + ` font-family="Pretendard, system-ui, sans-serif" text-anchor="middle" dominant-baseline="central">${esc(l)}</text>`;
    });
  }
  const src = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minX-pad} ${minY-pad} ${W} ${H}">`
            + `<rect x="${minX-pad}" y="${minY-pad}" width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = W*2; cv.height = H*2;
    const g = cv.getContext("2d"); g.scale(2,2); g.drawImage(img,0,0);
    cv.toBlob(b => { download(safeName(mapTitle())+".png", b); toast("이미지를 내려받았습니다"); });
  };
  img.onerror = () => toast("이미지를 만들지 못했습니다");
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
}

/* ===================== 알림 ===================== */
let tt = null;
function toast(msg){
  const t = $("#toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), 2200);
}
function closeSheets(){ document.querySelectorAll(".sheet").forEach(s => s.classList.remove("open")); }

/* ===================== 조작 연결 ===================== */
document.body.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if(!b) return;
  const a = b.dataset.act;
  if(a !== "color") b.blur();
  if(a==="child") addChild();
  else if(a==="sibling") addSibling();
  else if(a==="del") removeNode();
  else if(a==="color") pal.classList.contains("open") ? closePalette() : openPalette(b);
  else if(a==="fit") fit();
  else if(a==="undo") undo();
  else if(a==="import") importFile();
  else if(a==="export") exportJSON();
  else if(a==="png") exportPNG();
  else if(a==="md") exportMD();
  else if(a==="closesheet") closeSheets();
  else if(a==="theme"){ dark = !dark; document.body.classList.toggle("dark", dark); b.textContent = dark ? "주간" : "야간"; render(); }
  else if(a==="zin") zoomAt(1.15, innerWidth/2, innerHeight/2);
  else if(a==="zout") zoomAt(1/1.15, innerWidth/2, innerHeight/2);
  else if(a==="help") $("#help").classList.add("open");
});
$("#docname").addEventListener("click", () => { location.href = "dashboard.html"; });
document.querySelectorAll(".sheet").forEach(s => {
  s.addEventListener("click", e => { if(e.target === s) closeSheets(); });
});
addEventListener("resize", applyView);

/* ===================== 시작 ===================== */
(async () => {
  try{ await loadMap(); } catch { return; }
  render(); fit();
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => { render(); fit(); });
})();

})();
</script>
```

- [ ] **Step 8: Manual check**

Full functional check needs a live Supabase project and a real `mapId` (Task 6). For now, confirm the file has no leftover references to removed identifiers: search the file for `Store`, `IDB`, `handle`, `linkFile`, `openLib`, `drawLib`, `openMap(`, `newMap(`, `dupMap(`, `delMap(`, `mapId()` (the old id-generator, not the new `const mapId`), `curMap`, `setRoot`, `starter(`, `blank(` — none should remain.

```bash
grep -nE "Store|IDB|linkFile|openLib|drawLib|dupMap\(|delMap\(|curMap\(|setRoot\(|starter\(|blank\(" "/c/Users/winne/Downloads/gaji-cloud/map.html"
```
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add map.html
git commit -m "Adapt map.html editor for Supabase storage and read-only public viewing"
```

---

### Task 6: Setup/deployment README + manual end-to-end verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: all previous tasks' files.
- Produces: nothing consumed by other tasks — this is the terminal task that turns the file set into a working deployed app and records how to verify it.

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add Supabase/Google OAuth/Vercel setup guide and manual verification checklist"
```

---

## Self-Review Notes

- **Spec coverage:** Supabase backend ✓ (Task 1,2), auto folder-per-user via trigger ✓ (Task 1), Google login ✓ (Task 2,3), dashboard with public/private toggle + link-only visibility ✓ (Task 4), login → dashboard → editor flow ✓ (Task 3,4,5), read-only for non-owners ✓ (Task 5), JSON export/import kept for migration ✓ (Task 5), deployment steps ✓ (Task 6).
- **Placeholder scan:** none found — every step has literal code or an exact grep/manual-check command.
- **Type consistency:** `isOwner(userId, folderOwnerId)` signature matches between Task 2's definition/test and Task 5's call site (`isOwner(user && user.id, ownerId)`). `mapTitle()` name is consistent everywhere it replaced the old `mapName(curMap())`. `readOnly`/`ownerId`/`mapId` names are consistent between `loadMap()`, `applyReadOnly()`, `persist()`, and the UI guards.
- **Scope check:** single cohesive deliverable (one small app), not split further.
