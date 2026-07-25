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
