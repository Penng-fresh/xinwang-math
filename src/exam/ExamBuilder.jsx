// 建卷：老师端「考试」页签
//
// 一场考试 = 一个分组（学校+年级+班）+ 一张卷子结构。
// 卷子结构就是 8-12 行：这个大题叫什么、多少分、属于哪档、考的是什么。
//
// 为什么不用传 Word：报告只写到「第21题 有理数混合运算 4/24」，
// 不展示题干和图形。为这点信息去解析 Word 的题号、分值写法，出错概率
// 比手填高得多。
//
// 一个硬校验：各大题满分加起来必须等于卷子总分。对不上就不让保存，
// 因为后面每份答卷的「得分之和 = 总分」校验全靠这个总分。

import { useEffect, useState } from "react";

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
  goodBg: "#e8f5e8",
};

// 按钮上只用两三个字：四个字在这个宽度里会折行，看起来像坏掉了。
// 完整含义放在表格上方那行说明里。
const LEVELS = [
  ["base", "不该丢", "#c03030", "#fde8e8"],
  ["mid", "讲过", "#a06a10", "#fdf3dc"],
  ["hard", "压轴", "#6a6a6a", "#eeeeee"],
];
const LEVEL_HINT = "不该丢 = 应知应会，丢了要补；讲过 = 课上讲过同类，还没练熟；压轴 = 本来就难，丢了正常";

const STATUS_TEXT = { draft: "未开放", open: "已开放", closed: "已结束" };

const S = {
  label: { fontSize: 11, color: C.muted, marginBottom: 5, letterSpacing: "0.5px" },
  input: {
    width: "100%",
    padding: "8px 11px",
    border: "1px solid " + C.border,
    borderRadius: 8,
    fontSize: 13.5,
    color: C.dark,
    background: "#fff",
    boxSizing: "border-box",
    fontFamily: "inherit",
    outline: "none",
  },
  btn: {
    background: C.dark,
    color: "#fef3dc",
    border: "none",
    borderRadius: 9,
    padding: "10px 18px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  btnGhost: {
    background: "transparent",
    color: C.muted,
    border: "1px solid " + C.border,
    borderRadius: 9,
    padding: "9px 16px",
    fontSize: 12.5,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  card: {
    background: C.card,
    border: "1px solid " + C.line,
    borderRadius: 12,
    padding: "16px 16px",
    marginBottom: 12,
  },
};

let rowSeq = 100;
const newRow = () => ({ key: "s" + ++rowSeq, label: "", fullScore: "", level: "base", name: "" });

export default function ExamBuilder({ password }) {
  const [groups, setGroups] = useState([]);
  const [gid, setGid] = useState("");
  const [exams, setExams] = useState([]);
  const [mode, setMode] = useState("list");
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // 新建表单
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");

  // 编辑中的卷子结构
  const [paperTitle, setPaperTitle] = useState("");
  const [totalScore, setTotalScore] = useState("");
  const [rows, setRows] = useState([newRow()]);

  async function get(qs) {
    const r = await fetch("/api/exams?" + qs + "&password=" + encodeURIComponent(password));
    return r.json();
  }
  async function post(payload) {
    const r = await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, password }),
    });
    return r.json();
  }
  async function del(payload) {
    const r = await fetch("/api/exams", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, password }),
    });
    return r.json();
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/roster?view=groups&password=" + encodeURIComponent(password));
        const d = await r.json();
        // 注意：roster 的分组接口只返回 {groups:[...]}，没有 ok 字段，
        // 不能按 d.ok 判断，否则永远进 else 分支。
        if (Array.isArray(d.groups)) {
          setGroups(d.groups);
          if (d.groups[0]) setGid(d.groups[0].gid);
        } else setErr(d.error || "读取分组失败");
      } catch (e) {
        setErr("读取分组失败：" + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [password]);

  useEffect(() => {
    if (!gid) return;
    loadExams(gid);
  }, [gid]);

  async function loadExams(g) {
    try {
      const d = await get("view=list&gid=" + encodeURIComponent(g));
      if (d.ok) setExams(d.exams || []);
      else setErr(d.error || "读取考试列表失败");
    } catch (e) {
      setErr("读取考试列表失败：" + e.message);
    }
  }

  async function createExam() {
    if (!gid) return setErr("请先建一个分组（在「学生名单」页签里）");
    if (!newName.trim()) return setErr("考试名称要填，比如「期中考试」");
    setErr("");
    setBusy(true);
    try {
      const d = await post({ action: "create", gid, name: newName.trim(), date: newDate });
      if (!d.ok) return setErr(d.error || "新建失败");
      setNewName("");
      setNewDate("");
      await loadExams(gid);
      openEdit(d.exam);
    } finally {
      setBusy(false);
    }
  }

  function openEdit(e) {
    setEditing(e);
    setPaperTitle(e.paper?.title || "");
    setTotalScore(e.paper?.totalScore ? String(e.paper.totalScore) : "");
    const rs = (e.paper?.sections || []).map((s) => ({ ...s, fullScore: String(s.fullScore) }));
    setRows(rs.length ? rs : [newRow()]);
    setMode("edit");
    setErr("");
    setMsg("");
  }

  function updateRow(i, patch) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  const sum = rows.reduce((n, r) => {
    const v = parseFloat(r.fullScore);
    return n + (isFinite(v) ? v : 0);
  }, 0);
  const totalNum = parseFloat(totalScore);
  const sumOk = isFinite(totalNum) && Math.abs(sum - totalNum) < 0.01;

  async function savePaper() {
    setErr("");
    setMsg("");
    const payload = {
      action: "save",
      id: editing.id,
      paper: {
        title: paperTitle.trim() || editing.name,
        totalScore: parseFloat(totalScore),
        sections: rows.map((r) => ({
          key: r.key,
          label: r.label.trim(),
          fullScore: parseFloat(r.fullScore),
          level: r.level,
          name: (r.name || "").trim(),
        })),
      },
    };
    setBusy(true);
    try {
      const d = await post(payload);
      if (!d.ok) return setErr(d.error || "保存失败");
      setEditing(d.exam);
      setMsg("已保存");
      await loadExams(gid);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(st) {
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const d = await post({ action: "save", id: editing.id, status: st });
      if (!d.ok) return setErr(d.error || "操作失败");
      setEditing(d.exam);
      setMsg(st === "open" ? "已开放，家长端现在能看到这场考试" : "已更新");
      await loadExams(gid);
    } finally {
      setBusy(false);
    }
  }

  async function copyPrev() {
    const prev = exams.filter((e) => e.id !== editing.id && e.sectionCount > 0)[0];
    if (!prev) return setErr("这个分组还没有别的考试可以复制");
    const d = await get("view=one&id=" + encodeURIComponent(prev.id));
    if (!d.ok) return setErr(d.error || "读取失败");
    const p = d.exam.paper;
    setPaperTitle(p.title || "");
    setTotalScore(String(p.totalScore));
    setRows(
      p.sections.map((s) => ({
        key: "c" + ++rowSeq,
        label: s.label,
        fullScore: String(s.fullScore),
        level: s.level,
        name: s.name || "",
      }))
    );
    setMsg("已复制「" + d.exam.name + "」的卷子结构，改完记得保存");
  }

  if (loading) return <div style={{ padding: 30, color: C.muted, fontSize: 13 }}>读取分组…</div>;

  // ── 编辑卷子结构 ──
  if (mode === "edit" && editing) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <button onClick={() => { setMode("list"); setErr(""); setMsg(""); }} style={S.btnGhost}>‹ 返回考试列表</button>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.dark }}>{editing.name}</div>
          <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 10, background: editing.status === "open" ? C.goodBg : C.soft, color: editing.status === "open" ? C.good : C.dim, border: "1px solid " + C.border }}>
            {STATUS_TEXT[editing.status]}
          </span>
        </div>

        {err && <div style={{ background: C.dangerBg, border: "1px solid #f0a0a0", borderRadius: 9, padding: "9px 12px", color: C.danger, fontSize: 12.5, marginBottom: 12, lineHeight: 1.7 }}>{err}</div>}
        {msg && <div style={{ background: C.goodBg, border: "1px solid #a0d0a0", borderRadius: 9, padding: "9px 12px", color: C.good, fontSize: 12.5, marginBottom: 12 }}>{msg}</div>}

        <div style={S.card}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={S.label}>卷子名称（家长会看到）</div>
              <input value={paperTitle} onChange={(e) => setPaperTitle(e.target.value)} placeholder="如：七年级数学素质拓展训练" style={S.input} />
            </div>
            <div>
              <div style={S.label}>卷子总分</div>
              <input value={totalScore} onChange={(e) => setTotalScore(e.target.value)} placeholder="120" inputMode="decimal" style={S.input} />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: C.muted }}>
              各大题满分合计 <b style={{ color: sumOk ? C.good : C.danger, fontSize: 14 }}>{sum}</b> 分
              {totalScore !== "" && !sumOk && <span style={{ color: C.danger }}>　≠ 总分 {totalNum || 0}，先改到一致</span>}
              {sumOk && <span style={{ color: C.good }}>　与总分一致 ✓</span>}
            </div>
            <button onClick={copyPrev} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }}>从上一场复制</button>
          </div>

          <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.7, marginBottom: 10 }}>{LEVEL_HINT}</div>

          <div style={{ borderTop: "1px solid " + C.line, paddingTop: 10 }}>
            {rows.map((r, i) => (
              <div key={r.key} style={{ display: "grid", gridTemplateColumns: "1.5fr 62px 1.6fr 26px", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <input value={r.label} onChange={(e) => updateRow(i, { label: e.target.value })} placeholder="大题名称，如 单选题 1-12" style={{ ...S.input, padding: "7px 9px", fontSize: 12.5 }} />
                <input value={r.fullScore} onChange={(e) => updateRow(i, { fullScore: e.target.value })} placeholder="满分" inputMode="decimal" style={{ ...S.input, padding: "7px 6px", fontSize: 12.5, textAlign: "center" }} />
                <div style={{ display: "flex", gap: 4 }}>
                  {LEVELS.map(([k, txt, fg, bg]) => (
                    <button
                      key={k}
                      onClick={() => updateRow(i, { level: k })}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        fontSize: 11,
                        borderRadius: 7,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        border: "1px solid " + (r.level === k ? fg : C.border),
                        background: r.level === k ? bg : "#fff",
                        color: r.level === k ? fg : C.dim,
                        fontWeight: r.level === k ? 600 : 400,
                      }}
                    >
                      {txt}
                    </button>
                  ))}
                </div>
                <button onClick={() => removeRow(i)} title="删掉这一行" style={{ background: "transparent", border: "none", color: C.dim, cursor: "pointer", fontSize: 15, padding: 0 }}>×</button>
                <div style={{ gridColumn: "1 / 4", marginTop: -4 }}>
                  <input value={r.name || ""} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="考的是什么（家长看得懂的话），如 有理数混合运算" style={{ ...S.input, padding: "6px 9px", fontSize: 12, color: C.muted, borderStyle: "dashed" }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => setRows((p) => [...p, newRow()])} style={{ ...S.btnGhost, padding: "7px 14px", fontSize: 12.5 }}>+ 加一个大题</button>
            <button onClick={savePaper} disabled={busy || !sumOk} style={{ ...S.btn, opacity: busy || !sumOk ? 0.5 : 1, cursor: busy || !sumOk ? "default" : "pointer" }}>
              {busy ? "保存中…" : "保存卷子结构"}
            </button>
          </div>
        </div>

        <div style={{ ...S.card, background: C.soft }}>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.9, marginBottom: 10 }}>
            卷子结构填完整后点「开放给家长」，家长端才会出现这场考试。开放之后还能改结构，但已经提交的答卷不会自动重算——结构错了要先改对，再通知家长重传。
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {editing.status === "draft" && (
              <button onClick={() => setStatus("open")} disabled={busy || !sumOk} style={{ ...S.btn, background: sumOk ? C.good : C.dim, opacity: busy ? 0.5 : 1 }}>开放给家长</button>
            )}
            {editing.status === "open" && (
              <button onClick={() => setStatus("closed")} disabled={busy} style={{ ...S.btnGhost }}>结束这场考试</button>
            )}
            {editing.status === "closed" && (
              <button onClick={() => setStatus("open")} disabled={busy} style={{ ...S.btn, background: C.good }}>重新开放</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 考试列表 ──
  return (
    <div>
      {err && <div style={{ background: C.dangerBg, border: "1px solid #f0a0a0", borderRadius: 9, padding: "9px 12px", color: C.danger, fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      <div style={S.card}>
        <div style={{ ...S.label, fontSize: 11.5, marginBottom: 8 }}>先选一个分组（学校 + 年级 + 班）</div>
        {groups.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.danger, lineHeight: 1.9 }}>
            还没有分组。请先去「学生名单」页签建一个分组、把名字导进去，再回来建考试。
          </div>
        ) : (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {groups.map((g) => (
              <button
                key={g.gid}
                onClick={() => setGid(g.gid)}
                style={{
                  padding: "7px 13px",
                  borderRadius: 18,
                  fontSize: 12.5,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  border: "1px solid " + (gid === g.gid ? C.accent : C.border),
                  background: gid === g.gid ? "#fef3dc" : "#fff",
                  color: gid === g.gid ? "#8a5a10" : C.muted,
                  fontWeight: gid === g.gid ? 600 : 400,
                }}
              >
                {g.school || "未填学校"} · {g.grade} {g.name}（{g.count || g.memberCount || 0}人）
              </button>
            ))}
          </div>
        )}
      </div>

      {gid && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>这个班的考试（{exams.length}）</div>
          </div>

          {exams.length === 0 && (
            <div style={{ ...S.card, textAlign: "center", color: C.dim, fontSize: 12.5, padding: "26px 16px" }}>
              还没有考试。在下面新建一场。
            </div>
          )}

          {exams.map((e) => (
            <div key={e.id} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.dark, marginBottom: 3 }}>{e.name}</div>
                <div style={{ fontSize: 11.5, color: C.dim }}>
                  {e.date || "未填日期"} · {e.sectionCount ? e.sectionCount + " 个大题 · 满分 " + e.totalScore : "还没填卷子结构"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 10, background: e.status === "open" ? C.goodBg : C.soft, color: e.status === "open" ? C.good : C.dim, border: "1px solid " + C.border }}>
                  {STATUS_TEXT[e.status]}
                </span>
                <button onClick={async () => { const d = await get("view=one&id=" + encodeURIComponent(e.id)); if (d.ok) openEdit(d.exam); else setErr(d.error || "读取失败"); }} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }}>
                  {e.sectionCount ? "编辑" : "填卷子结构"}
                </button>
              </div>
            </div>
          ))}

          <div style={{ ...S.card, background: C.soft, marginTop: 14 }}>
            <div style={{ ...S.label, fontSize: 11.5, marginBottom: 8 }}>新建一场考试</div>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr auto", gap: 10, alignItems: "end" }}>
              <div>
                <div style={S.label}>考试名称</div>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如：期中考试" style={S.input} />
              </div>
              <div>
                <div style={S.label}>考试日期</div>
                <input value={newDate} onChange={(e) => setNewDate(e.target.value)} type="date" style={S.input} />
              </div>
              <button onClick={createExam} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>{busy ? "…" : "新建"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
