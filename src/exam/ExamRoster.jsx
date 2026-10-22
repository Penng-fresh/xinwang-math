// 学生名单管理（教师后台里的一个页签）
//
// 为什么要有这一页：后面所有的成绩走势、班级统计，都靠「同一个学生」这件事。
// 家长手填名字只要错一个字，系统就会把一个人当成两个人，而且你根本不会察觉。
// 所以名单必须由老师一次性录入，之后每份答卷都挂到名单里的某个人身上。
//
// 交互只做三件事，故意做得笨一点：
//   1. 建分组（学校 + 年级 + 学期）
//   2. 从 Excel 复制一列名字，粘进框里，一键导入
//   3. 组内微调：改名、移除
//
// 颜色与 App.jsx 里教师后台保持一致（暖色调 #2a2218 / #f5f0e8 / #e8a030）

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
  goodBg: "#e8f5e8"
};

const S = {
  label: { fontSize: 10, letterSpacing: 3, color: C.muted, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "9px 12px",
    border: "1px solid " + C.border,
    borderRadius: 8,
    fontSize: 14,
    color: C.dark,
    background: C.card,
    outline: "none",
    fontFamily: "inherit"
  },
  btn: (bg, color, border) => ({
    background: bg,
    color: color,
    border: border || "none",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 600
  })
};

export default function ExamRoster({ password }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [gid, setGid] = useState("");
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const [form, setForm] = useState({ name: "", school: "", grade: "初一", term: "2026秋季" });
  const [pasteText, setPasteText] = useState("");
  const [editingSid, setEditingSid] = useState("");
  const [editingName, setEditingName] = useState("");

  // ── 接口封装 ──────────────────────────────────────
  async function get(qs) {
    const r = await fetch("/api/roster?" + qs + "&password=" + encodeURIComponent(password));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || "请求失败 " + r.status);
    return d;
  }

  async function post(payload) {
    const r = await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, ...payload })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || "请求失败 " + r.status);
    return d;
  }

  async function del(payload) {
    const r = await fetch("/api/roster", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, ...payload })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || "请求失败 " + r.status);
    return d;
  }

  // ── 数据加载 ──────────────────────────────────────
  const loadGroups = async () => {
    setLoading(true);
    setErr("");
    try {
      const d = await get("view=groups");
      setGroups(d.groups || []);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  };

  const loadMembers = async (id) => {
    setMembersLoading(true);
    setErr("");
    try {
      const d = await get("view=group&gid=" + encodeURIComponent(id));
      setGroup(d.group);
      setMembers(d.members || []);
    } catch (e) {
      setErr(e.message);
      setGroup(null);
      setMembers([]);
    }
    setMembersLoading(false);
  };

  useEffect(() => {
    loadGroups();
  }, []);

  // 选中的分组被删掉时，清空右侧
  useEffect(() => {
    if (gid && !groups.some((g) => g.gid === gid)) {
      setGid("");
      setGroup(null);
      setMembers([]);
    }
  }, [groups]);

  // ── 动作 ──────────────────────────────────────────
  const createGroup = async () => {
    setMsg("");
    setErr("");
    if (!form.name.trim()) return setErr("请填分组名");
    if (!form.school.trim()) return setErr("请填学校");
    setBusy(true);
    try {
      const d = await post({ action: "createGroup", ...form });
      setForm({ ...form, name: "" });
      await loadGroups();
      setGid(d.group.gid);
      await loadMembers(d.group.gid);
      setMsg("分组已建好，接着把学生名字粘进来");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const importNames = async () => {
    setMsg("");
    setErr("");
    if (!gid) return setErr("先选一个分组");
    if (!pasteText.trim()) return setErr("先把名字粘进框里");
    setBusy(true);
    try {
      const d = await post({ action: "importNames", gid, text: pasteText });
      setPasteText("");
      await loadMembers(gid);
      await loadGroups();
      const renamed = (d.added || []).filter((x) => x.renamedFrom);
      let m = `导入 ${d.count} 人`;
      if (renamed.length) {
        m += `。其中 ${renamed.length} 个重名已自动加尾号：` +
          renamed.map((x) => `${x.renamedFrom}→${x.name}`).join("、");
      }
      setMsg(m);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const saveRename = async (sid) => {
    const name = editingName.trim();
    if (!name) return;
    setBusy(true);
    setErr("");
    try {
      await post({ action: "renameStudent", sid, displayName: name });
      setEditingSid("");
      setEditingName("");
      await loadMembers(gid);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const removeStudent = async (sid, name) => {
    if (!confirm(`把「${name}」从这个分组移除？\n（他的历史成绩不会消失，重新加回来还能接着用）`)) return;
    setBusy(true);
    setErr("");
    try {
      await post({ action: "removeStudent", sid });
      await loadMembers(gid);
      await loadGroups();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const removeGroup = async () => {
    if (!group) return;
    if (!confirm(`删除分组「${group.name}」？\n（组里还有学生时会删不掉，这是故意的）`)) return;
    setBusy(true);
    setErr("");
    try {
      await del({ gid });
      setGid("");
      setGroup(null);
      setMembers([]);
      await loadGroups();
      setMsg("分组已删除");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const schoolOptions = [...new Set(groups.map((g) => g.school))];

  // ── 界面 ──────────────────────────────────────────
  return (
    <div>
      {err && (
        <div style={{ background: C.dangerBg, border: "1px solid #f0a0a0", borderRadius: 10, padding: "10px 14px", color: C.danger, fontSize: 13, marginBottom: 12 }}>
          ⚠ {err}
        </div>
      )}
      {msg && (
        <div style={{ background: C.goodBg, border: "1px solid #a0d0a0", borderRadius: 10, padding: "10px 14px", color: C.good, fontSize: 13, marginBottom: 12 }}>
          ✓ {msg}
        </div>
      )}

      {/* ① 新建分组 */}
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 12 }}>① 建一个分组</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={S.label}>分组名</div>
            <input style={S.input} value={form.name} placeholder="如：初一秋季周末班"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <div style={S.label}>学校</div>
            <input style={S.input} value={form.school} placeholder="如：宝一中" list="xw-schools"
              onChange={(e) => setForm({ ...form, school: e.target.value })} />
            <datalist id="xw-schools">
              {schoolOptions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <div style={S.label}>年级</div>
            <input style={S.input} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
          </div>
          <div>
            <div style={S.label}>学期</div>
            <input style={S.input} value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} />
          </div>
        </div>
        <button disabled={busy} onClick={createGroup}
          style={{ ...S.btn(C.dark, "#f0e8d0"), marginTop: 12, opacity: busy ? 0.6 : 1 }}>
          新建分组
        </button>
      </div>

      {/* ② 选分组 */}
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>② 选一个分组</div>
          <button onClick={loadGroups} style={{ ...S.btn("transparent", C.muted, "1px solid " + C.border), padding: "5px 12px", fontWeight: 400 }}>
            🔄 刷新
          </button>
        </div>
        {loading ? (
          <div style={{ color: C.muted, fontSize: 13, padding: "10px 0" }}>加载中...</div>
        ) : groups.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13, padding: "10px 0" }}>还没有分组，先在上面建一个</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {groups.map((g) => (
              <button key={g.gid}
                onClick={() => { setGid(g.gid); setMsg(""); loadMembers(g.gid); }}
                style={{
                  background: gid === g.gid ? C.dark : C.soft,
                  color: gid === g.gid ? "#f0e8d0" : C.dark,
                  border: "1px solid " + (gid === g.gid ? C.dark : C.border),
                  borderRadius: 20, padding: "7px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit"
                }}>
                {g.school} · {g.name}
                <span style={{ opacity: 0.7, marginLeft: 6 }}>{g.count || 0}人</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ③ 名单 */}
      {gid && (
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>
              ③ {group ? `${group.school} · ${group.name}` : "名单"}
              <span style={{ fontSize: 12, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
                {members.length} 人{group && group.grade ? ` · ${group.grade}` : ""}{group && group.term ? ` · ${group.term}` : ""}
              </span>
            </div>
            <button onClick={removeGroup} disabled={busy}
              style={{ ...S.btn(C.dangerBg, C.danger), padding: "5px 12px", fontWeight: 400 }}>
              删除分组
            </button>
          </div>

          <div style={{ ...S.label, marginTop: 14 }}>批量粘贴名单（从 Excel 复制一列名字，直接粘进来，一行一个）</div>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
            placeholder={"张三\n李四\n王五\n\n带序号也行：1.张三 / 1、张三 / 序号+姓名的两列都能识别"}
            style={{ ...S.input, height: 108, resize: "vertical", lineHeight: 1.7 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <button disabled={busy} onClick={importNames}
              style={{ ...S.btn(C.accent, "#fff"), opacity: busy ? 0.6 : 1 }}>
              导入名单
            </button>
            <span style={{ fontSize: 11.5, color: C.dim }}>已经导入过的名字不会重复加，同名的会自动加 (2)</span>
          </div>

          <div style={{ height: 1, background: C.line, margin: "16px 0" }} />

          {membersLoading ? (
            <div style={{ color: C.muted, fontSize: 13 }}>加载中...</div>
          ) : members.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 10px", color: C.muted, background: C.soft, borderRadius: 10, border: "1px dashed #c8b898", fontSize: 13 }}>
              这个分组还没有学生，把名字粘进来导入
            </div>
          ) : (
            <div>
              {members.map((m, i) => (
                <div key={m.sid} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 4px", borderBottom: i === members.length - 1 ? "none" : "1px solid #f0e8d8"
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: C.soft, border: "1px solid " + C.border,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, color: C.dim, flexShrink: 0
                  }}>{i + 1}</div>

                  {editingSid === m.sid ? (
                    <>
                      <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRename(m.sid); if (e.key === "Escape") setEditingSid(""); }}
                        style={{ ...S.input, flex: 1, padding: "6px 10px", fontSize: 13.5 }} />
                      <button onClick={() => saveRename(m.sid)} style={{ ...S.btn(C.dark, "#f0e8d0"), padding: "5px 12px" }}>存</button>
                      <button onClick={() => setEditingSid("")} style={{ ...S.btn("transparent", C.muted, "1px solid " + C.border), padding: "5px 12px", fontWeight: 400 }}>取消</button>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1, fontSize: 14, color: C.dark }}>
                        {m.displayName || m.name}
                        {m.displayName && m.displayName !== m.name && (
                          <span style={{ fontSize: 11, color: C.dim, marginLeft: 6 }}>原名 {m.name}</span>
                        )}
                        {m.subCount > 0 && (
                          <span style={{ background: "#f0e8d0", color: "#8a6a30", fontSize: 10, padding: "1px 7px", borderRadius: 10, marginLeft: 6 }}>
                            {m.subCount} 次考试
                          </span>
                        )}
                      </div>
                      <button onClick={() => { setEditingSid(m.sid); setEditingName(m.displayName || m.name); }}
                        style={{ ...S.btn("transparent", C.muted, "1px solid " + C.border), padding: "4px 10px", fontSize: 11.5, fontWeight: 400 }}>
                        改名
                      </button>
                      <button onClick={() => removeStudent(m.sid, m.displayName || m.name)}
                        style={{ ...S.btn(C.dangerBg, C.danger), padding: "4px 10px", fontSize: 11.5, fontWeight: 400 }}>
                        移除
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
