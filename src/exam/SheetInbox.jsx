// 答题卡收件箱：老师端「答题卡」页签
//
// 这一版只做「看收到了什么」，不做分析。但有两个信息是老师现在就要的，
// 少了这个页面就等于白收：
//   1) 这个班谁还没传 —— 追家长只能靠这个名单，靠翻聊天记录会漏人
//   2) 原件能下载下来 —— 分析在本地跑（图片识别成本、可复核），
//      所以必须能把 jpg 落到硬盘上，不能只能在线看
//
// 列表永远不取图片字节：一份 2000px 的答题卡 base64 有 50 万字符，
// 20 份就是 10 兆，列表一刷就卡死。点开某一份才取那一张。

import { useEffect, useMemo, useState } from "react";

const C = {
  dark: "#2a2218",
  bg: "#f5f0e8",
  card: "#fff",
  soft: "#faf6ee",
  accent: "#e8a030",
  border: "#e0d0b0",
  line: "#e8d0a0",
  muted: "#8a7a5a",
  dim: "#a08060",
  danger: "#c03030",
  dangerBg: "#fde8e8",
  good: "#3a8a3a",
  goodBg: "#e8f5e8"
};

function when(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SheetInbox({ password }) {
  const [catalog, setCatalog] = useState([]);
  const [gid, setGid] = useState("");
  const [sheets, setSheets] = useState([]);
  const [stats, setStats] = useState({ count: 0, students: 0 });
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [openId, setOpenId] = useState("");
  const [imgs, setImgs] = useState({}); // id -> [{dataUrl}] 或 {error}
  const [imgBusy, setImgBusy] = useState("");

  const load = async (filterGid) => {
    setLoading(true);
    setErr("");
    try {
      const q = filterGid ? "&gid=" + encodeURIComponent(filterGid) : "";
      const r = await fetch("/api/answer-sheets?view=list" + q + "&password=" + encodeURIComponent(password));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "读取失败");
      setSheets(Array.isArray(d.sheets) ? d.sheets : []);
      setStats(d.stats || { count: 0, students: 0 });
    } catch (e) {
      setErr(e.message || "读取失败");
      setSheets([]);
      setStats({ count: 0, students: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/roster?view=catalog");
        const d = await r.json().catch(() => ({}));
        if (r.ok && Array.isArray(d.schools)) setCatalog(d.schools);
      } catch (_) {}
    })();
    load("");
  }, []);

  // 选了班级就顺带读这个班的名单，用来算「谁还没传」
  useEffect(() => {
    setMembers([]);
    if (!gid) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/roster?view=pick&gid=" + encodeURIComponent(gid));
        const d = await r.json().catch(() => ({}));
        if (alive && r.ok && Array.isArray(d.students)) setMembers(d.students);
      } catch (_) {}
    })();
    return () => {
      alive = false;
    };
  }, [gid]);

  const missing = useMemo(() => {
    if (!gid || members.length === 0) return [];
    const got = new Set(sheets.map((s) => s.sid));
    return members.filter((m) => !got.has(m.sid));
  }, [gid, members, sheets]);

  const openSheet = async (s) => {
    if (openId === s.id) {
      setOpenId("");
      return;
    }
    setOpenId(s.id);
    if (imgs[s.id]) return;
    setImgBusy(s.id);
    const out = [];
    try {
      for (let n = 0; n < (s.imageCount || 0); n++) {
        const r = await fetch(
          "/api/answer-sheets?view=img&id=" + encodeURIComponent(s.id) + "&n=" + n + "&password=" + encodeURIComponent(password)
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || "取图失败");
        out.push({ dataUrl: `data:${d.mediaType || "image/jpeg"};base64,${d.data}` });
      }
      setImgs((cur) => ({ ...cur, [s.id]: out }));
    } catch (e) {
      setImgs((cur) => ({ ...cur, [s.id]: { error: e.message || "取图失败" } }));
    } finally {
      setImgBusy("");
    }
  };

  const remove = async (s, e) => {
    e.stopPropagation();
    if (!confirm(`删除 ${s.studentName} 的这份答题卡（${s.imageCount} 张）？删了就找不回来了。`)) return;
    try {
      const r = await fetch("/api/answer-sheets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, password })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "删除失败");
      setSheets((cur) => cur.filter((x) => x.id !== s.id));
      if (openId === s.id) setOpenId("");
    } catch (err2) {
      alert("删除失败：" + (err2.message || "网络问题"));
    }
  };

  // 分组名一般已经写了年级（初一秋季班），再把 grade 拼上去会出现「初一 初一秋季班」
  const classLabel = (s) => [s.school, s.groupName].filter(Boolean).join(" ");

  return (
    <div>
      <div style={{ background: C.card, borderRadius: 14, border: "1px solid " + C.line, padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={gid}
            onChange={(e) => {
              setGid(e.target.value);
              setOpenId("");
              load(e.target.value);
            }}
            style={{ flex: 1, minWidth: 160, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", color: C.dark, background: C.soft, border: "1px solid " + C.line, borderRadius: 9, outline: "none" }}
          >
            <option value="">全部班级</option>
            {catalog.map((s) =>
              (s.groups || []).map((g) => (
                <option key={g.gid} value={g.gid}>
                  {s.school} · {g.name}
                </option>
              ))
            )}
          </select>
          <button
            onClick={() => load(gid)}
            style={{ background: C.soft, border: "1px solid " + C.line, color: "#7a6a4a", borderRadius: 9, padding: "9px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            🔄 刷新
          </button>
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 10, lineHeight: 1.9 }}>
          已收 <b style={{ color: C.dark }}>{stats.count}</b> 份，涉及 <b style={{ color: C.dark }}>{stats.students}</b> 名学生。
          {missing.length > 0 && <> 这个班还有 <b style={{ color: C.danger }}>{missing.length}</b> 人一份都没传。</>}
        </div>
      </div>

      {err && (
        <div style={{ background: C.dangerBg, border: "1px solid #f0a0a0", borderRadius: 10, padding: "10px 14px", color: "#a03030", fontSize: 13, marginBottom: 12 }}>⚠ {err}</div>
      )}

      {missing.length > 0 && (
        <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 12.5, color: "#7a5a20", lineHeight: 1.9 }}>
          <b>还没传：</b>
          {missing.map((m) => m.name).join("、")}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "36px 0", color: C.dim, fontSize: 13 }}>正在读取…</div>
      ) : sheets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted, background: C.soft, borderRadius: 14, border: "1px dashed #c8b898" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📭</div>
          <div style={{ fontSize: 14 }}>还没有收到答题卡</div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 8, lineHeight: 1.9 }}>
            把 xinwang-math.com 的「考试答题卡上传」链接发群里，<br />家长选名字、拍照就传上来了。
          </div>
        </div>
      ) : (
        sheets.map((s) => {
          const expanded = openId === s.id;
          const mine = imgs[s.id];
          return (
            <div key={s.id} style={{ background: expanded ? "#fff8ee" : C.card, border: "1px solid " + (expanded ? C.accent : C.line), borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
              <div onClick={() => openSheet(s)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: C.soft, border: "1px solid " + C.line, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#8a6a30", flexShrink: 0 }}>
                  {s.imageCount}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>{s.studentName}</span>
                    <span style={{ fontSize: 11.5, color: C.dim }}>{classLabel(s)}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.examName || "未指定考试"} · {when(s.createdAt)}
                    {s.note ? " · 留言：" + s.note : ""}
                  </div>
                </div>
                <span style={{ color: "#b0a080", fontSize: 11, flexShrink: 0 }}>{expanded ? "收起" : "查看"}</span>
              </div>

              {expanded && (
                <div style={{ padding: "0 14px 14px", borderTop: "1px solid " + C.line }}>
                  {imgBusy === s.id && <div style={{ fontSize: 12.5, color: C.dim, padding: "12px 0" }}>正在取图…</div>}
                  {mine?.error && <div style={{ fontSize: 12.5, color: C.danger, padding: "12px 0" }}>⚠ {mine.error}</div>}
                  {Array.isArray(mine) &&
                    mine.map((im, i) => (
                      <div key={i} style={{ marginTop: 12 }}>
                        <img src={im.dataUrl} alt={"第" + (i + 1) + "张"} style={{ width: "100%", borderRadius: 8, border: "1px solid " + C.line, display: "block", background: "#fff" }} />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <a
                            href={im.dataUrl}
                            download={`${s.studentName}-${s.examName || "未指定考试"}-${i + 1}.jpg`}
                            style={{ flex: 1, textAlign: "center", background: C.dark, color: C.cream, borderRadius: 9, padding: "9px 0", fontSize: 12.5, textDecoration: "none" }}
                          >
                            下载这张
                          </a>
                          <button
                            onClick={(e) => remove(s, e)}
                            style={{ background: "transparent", border: "1px solid #e0a0a0", color: C.danger, borderRadius: 9, padding: "9px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
