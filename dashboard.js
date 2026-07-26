(() => {
  "use strict";
  const $ = s => document.querySelector(s);

  // 편집기(map.html)와 같은 가지 색을 써서, 타일 미리보기가 실제 맵과 같은 색으로 보이게 합니다.
  const PALETTE = ["#D6455C","#E2841F","#2FA37A","#2E6FD9","#8358CE","#C0357E","#0E9BA6","#7A8B2E"];

  function countNodes(n) {
    if (!n || typeof n !== "object") return 0;
    let c = 1;
    for (const k of n.children || []) c += countNodes(k);
    return c;
  }

  function ago(t) {
    if (!t) return "";
    const d = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
    if (d < 60) return "방금";
    if (d < 3600) return Math.floor(d / 60) + "분 전";
    if (d < 86400) return Math.floor(d / 3600) + "시간 전";
    if (d < 604800) return Math.floor(d / 86400) + "일 전";
    return new Date(t).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  }

  /* 맵의 실제 가지 구조를 작은 방사형 그림으로 그립니다 — 타일마다 서로 다른 모양이
     나오므로 제목을 읽지 않아도 어떤 맵인지 알아볼 수 있습니다.
     좌표·색은 전부 여기서 계산한 숫자와 고정 팔레트라 사용자 입력이 섞이지 않습니다. */
  function structureGlyph(tree) {
    const kids = (tree && Array.isArray(tree.children) ? tree.children : []).slice(0, 8);
    const cx = 48, cy = 48, r1 = 21, r2 = 33;
    const step = 360 / Math.max(kids.length, 1);
    let s = "";
    kids.forEach((k, i) => {
      const a = (-90 + step * i) * Math.PI / 180;
      const x = +(cx + Math.cos(a) * r1).toFixed(1), y = +(cy + Math.sin(a) * r1).toFixed(1);
      const col = PALETTE[i % PALETTE.length];
      s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${col}" stroke-width="2.2" stroke-linecap="round" opacity=".92"/>`;
      const gk = (Array.isArray(k.children) ? k.children : []).slice(0, 3);
      gk.forEach((_, j) => {
        const a2 = a + (j - (gk.length - 1) / 2) * 0.44;
        const x2 = +(cx + Math.cos(a2) * r2).toFixed(1), y2 = +(cy + Math.sin(a2) * r2).toFixed(1);
        s += `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.3" stroke-linecap="round" opacity=".5"/>`;
        s += `<circle cx="${x2}" cy="${y2}" r="1.9" fill="${col}" opacity=".7"/>`;
      });
      s += `<circle cx="${x}" cy="${y}" r="3.4" fill="${col}"/>`;
    });
    s += `<circle cx="${cx}" cy="${cy}" r="5.6" fill="currentColor"/>`;
    return `<svg viewBox="0 0 96 96" aria-hidden="true">${s}</svg>`;
  }

  function tile(m) {
    const a = document.createElement("a");
    a.className = "tile";
    a.href = `map.html?id=${encodeURIComponent(m.id)}`;

    const art = document.createElement("div");
    art.className = "art";
    art.innerHTML = structureGlyph(m.data);

    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = m.title || "제목 없음";

    const meta = document.createElement("div");
    meta.className = "meta";
    const n = countNodes(m.data);
    meta.textContent = (n ? `${n}개 주제 · ` : "") + ago(m.updated_at);

    a.append(art, nm, meta);
    return a;
  }

  function emptyState(title, body) {
    const d = document.createElement("div");
    d.className = "empty";
    d.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20V10"/><path d="M12 14 7.5 10.5"/><path d="M12 12 16.5 8"/>
      <circle cx="12" cy="7.6" r="2.6"/><circle cx="6.2" cy="9.2" r="2"/><circle cx="17.8" cy="6.4" r="2"/></svg>`;
    const b = document.createElement("b");
    b.textContent = title;
    const p = document.createElement("p");
    p.textContent = body;
    d.append(b, p);
    return d;
  }

  function renderList(maps, { canCreate, onCreate }) {
    const box = $("#list");
    box.innerHTML = "";
    $("#count").textContent = maps.length ? `${maps.length}개의 맵` : "";

    if (!maps.length && !canCreate) {
      box.appendChild(emptyState("맵이 없습니다", "이 폴더에는 아직 공개된 맵이 없습니다."));
      return;
    }
    for (const m of maps) box.appendChild(tile(m));

    if (canCreate) {
      const add = document.createElement("button");
      add.className = "tile add";
      add.type = "button";
      add.innerHTML = `<span class="plus"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span><span>새로 만들기</span>`;
      add.addEventListener("click", onCreate);
      box.appendChild(add);
    }
  }

  async function loadOwn() {
    const user = await Auth.requireLogin();
    if (!user) return;
    $("#who").textContent = user.email;

    const { data: folder, error } = await sb.from("folders").select("*").eq("owner_id", user.id).single();
    if (error || !folder) {
      $("#list").appendChild(emptyState("폴더를 불러오지 못했습니다", "새로고침해 보세요. 계속 실패하면 다시 로그인해 주세요."));
      return;
    }

    $("#owner-controls").style.display = "block";

    const toggle = $("#public-toggle");
    const shareRow = $("#share-row");
    const syncShareRow = () => { shareRow.style.display = toggle.checked ? "flex" : "none"; };
    toggle.checked = !!folder.is_public;
    syncShareRow();

    toggle.addEventListener("change", async (e) => {
      const checked = e.target.checked;
      syncShareRow();
      const { data, error } = await sb
        .from("folders")
        .update({ is_public: checked })
        .eq("id", folder.id)
        .select("is_public");
      if (error || !data || !data.length) {
        e.target.checked = !checked;
        syncShareRow();
        alert("설정을 저장하지 못했습니다. 다시 로그인해 주세요.");
      }
    });

    const shareUrl = `${location.origin}/dashboard.html?folder=${folder.id}`;
    $("#share-link").value = shareUrl;
    $("#copy-link").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        $("#share-link").select();  // 클립보드 권한이 없으면 직접 복사하도록 선택만 해 줍니다
        return;
      }
      const was = btn.lastChild.textContent;
      btn.lastChild.textContent = "복사했습니다";
      setTimeout(() => { btn.lastChild.textContent = was; }, 1600);
    });

    const createMap = async () => {
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
    };

    // ponytail: 타일 미리보기용으로 맵 트리 전체를 함께 받아옵니다. 맵 수가
    // 수백 개로 늘면 목록용 요약 컬럼을 따로 두는 쪽이 낫습니다.
    const { data: maps } = await sb
      .from("maps")
      .select("id,title,updated_at,data")
      .eq("folder_id", folder.id)
      .order("updated_at", { ascending: false });
    renderList(maps || [], { canCreate: true, onCreate: createMap });
  }

  async function loadPublic(folderId) {
    $("#owner-controls").style.display = "none";
    $("#readonly-badge").style.display = "inline-flex";
    $("#logout").style.display = "none";
    $("#title").textContent = "공개 폴더";

    const { data: folder, error } = await sb.from("folders").select("id,is_public").eq("id", folderId).single();
    if (error || !folder || !folder.is_public) {
      $("#list").appendChild(emptyState("폴더를 찾을 수 없습니다", "링크가 잘못되었거나, 폴더가 비공개로 바뀌었습니다."));
      return;
    }
    const { data: maps } = await sb
      .from("maps")
      .select("id,title,updated_at,data")
      .eq("folder_id", folder.id)
      .order("updated_at", { ascending: false });
    renderList(maps || [], { canCreate: false });
  }

  $("#logout").addEventListener("click", () => Auth.signOut());

  const folderParam = new URLSearchParams(location.search).get("folder");
  if (folderParam) loadPublic(folderParam);
  else loadOwn();
})();
