/* 노드 겹침 검사 — 배치(layout/place/subtreeH/placeSummaries)를 건드릴 때마다 돌린다.
 *
 * 쓰는 법: 편집기 화면(map.html)을 열고 브라우저 콘솔에 이 파일 내용을 붙여넣은 뒤
 *   overlapCheck()          현재 화면의 겹침 쌍을 센다
 *   overlapCheck({verbose:true})   겹친 쌍의 글자와 좌표까지 출력
 *
 * 통과 기준: pairs === 0. 눈으로 판단하지 않는다.
 */
function overlapCheck(opt) {
  opt = opt || {};
  const pad = opt.pad || 0;                 // 여유를 두고 보려면 pad를 준다

  // 겹침은 layout 이 만든 월드 좌표로 결정된다. 확대·이동과 무관하고, 화면이
  // 아직 그려지지 않은 상태에서도 잰다. 접근자가 없는 옛 빌드에서는 DOM 으로 돈다.
  const boxes = (typeof window.gajiLayoutBoxes === "function")
    ? window.gajiLayoutBoxes().map(x => ({
        t: x.text.trim().slice(0, 20), id: x.id, summary: x.summary, kind: x.kind || "node",
        l: x.l + pad, r: x.r - pad, top: x.t + pad, bot: x.b - pad,
        w: Math.round(x.r - x.l), h: Math.round(x.b - x.t)
      }))
    : [...document.querySelectorAll(".node")].map(el => {
        const r = el.getBoundingClientRect();
        return {
          t: el.textContent.trim().slice(0, 20), id: el.dataset.id,
          l: r.left + pad, r: r.right - pad, top: r.top + pad, bot: r.bottom - pad,
          w: Math.round(r.width), h: Math.round(r.height)
        };
      });

  const hits = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.r <= b.l || b.r <= a.l || a.bot <= b.top || b.bot <= a.top) continue;
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const oy = Math.min(a.bot, b.bot) - Math.max(a.top, b.top);
      // 요약의 괄호는 자기가 감싸는 대상 위를 지나가지 않는다. 다만 대상 노드와
      // 세로 구간이 겹치는 것은 정상이므로, 괄호↔노드는 x가 실제로 파고들 때만 센다.
      hits.push({ a: a.t, b: b.t, aKind: a.kind, bKind: b.kind,
                  aId: a.id, bId: b.id, overlapX: Math.round(ox), overlapY: Math.round(oy) });
    }
  }

  const byKind = {};
  for (const h of hits) { const k = [h.aKind, h.bKind].sort().join("↔"); byKind[k] = (byKind[k] || 0) + 1; }
  const out = { nodes: boxes.length, pairs: hits.length, byKind,
                hits: opt.verbose ? hits : hits.slice(0, 8) };
  if (opt.verbose) console.table(hits);
  return out;
}

/* 괄호(요약을 감싸는 선)가 노드 위를 지나가는지 본다.
 * 괄호는 #edges 안의 stroke 있는 path 로 그려지므로 그 bbox 와 노드 사각형을 비교한다. */
function bracketOverlapCheck() {
  const paths = [...document.querySelectorAll("#edges path")].filter(p => p.getAttribute("stroke"));
  const nodes = [...document.querySelectorAll(".node")].map(el => {
    const r = el.getBoundingClientRect();
    return { t: el.textContent.trim().slice(0, 20), l: r.left, r: r.right, top: r.top, bot: r.bottom };
  });
  const hits = [];
  for (const p of paths) {
    const r = p.getBoundingClientRect();
    for (const n of nodes) {
      if (r.right <= n.l || n.r <= r.left || r.bottom <= n.top || n.bot <= r.top) continue;
      hits.push({ node: n.t, bracket: Math.round(r.width) + "x" + Math.round(r.height) });
    }
  }
  return { brackets: paths.length, pairs: hits.length, hits: hits.slice(0, 8) };
}

if (typeof module !== "undefined" && module.exports) module.exports = { overlapCheck, bracketOverlapCheck };
