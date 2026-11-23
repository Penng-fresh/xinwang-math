// 试卷分析：老师端「试卷」页签
//
// 流程：上传 DOCX → 后端规则拆题（58ms）→ 前端勾选 → 每 6 题一批交 AI 分析。
//
// 为什么拆题不用 AI：见 api/paper.js 顶部注释。规则拆得又快又准，
// AI 只干它擅长的部分——逐题教学分析。
//
// 为什么分批 6 题：一次 26 题会让思考 token 吃满配额导致输出截断，
// 分批还能让老师看到进度、单批失败只影响一批。

import { useMemo, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

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
  blue: "#2a5a8a",
  blueBg: "#e8f0f8",
};

const BATCH = 6;
const MAX_BYTES = 4_500_000;

// 把含 $...$ 的文本渲染成公式 + 文字混排
function MathText({ text, style }) {
  // 模型有时用 \(...\) 或 \[...\] 包裹公式，统一成 $...$ 再切
  const raw = String(text == null ? "" : text)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => "$" + m + "$")
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => "$" + m + "$");
  const parts = raw.split(/\$([^$]*)\$/g);
  return (
    <span style={style}>
      {parts.map((p, i) => {
        if (i % 2 === 1) {
          let html = "";
          try {
            html = katex.renderToString(p, { throwOnError: false, displayMode: false });
          } catch (_) {
            html = "";
          }
          if (!html) return <span key={i}>${p}$</span>;
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

const DIFF_COLOR = {
  易: [C.good, C.goodBg],
  中: ["#a06a10", "#fdf3dc"],
  难: ["#a04040", "#fde8e8"],
  压轴: ["#5a5a5a", "#eeeeee"],
};

function tag(text, color, bg) {
  return (
    <span
      key={text}
      style={{
        display: "inline-block",
        background: bg,
        color: color,
        border: "1px solid " + color + "33",
        borderRadius: 6,
        padding: "2px 7px",
        fontSize: 11,
        marginRight: 5,
        marginBottom: 4,
        lineHeight: 1.5,
      }}
    >
      {text}
    </span>
  );
}

export default function PaperDocx({ password }) {
  const [stage, setStage] = useState("idle"); // idle | parsing | ready | analyzing
  const [paper, setPaper] = useState(null);
  const [answers, setAnswers] = useState({}); // no -> 分析结果
  const [picked, setPicked] = useState(() => new Set());
  const [prog, setProg] = useState({ batch: 0, totalBatch: 0, msg: "" });
  const [error, setError] = useState("");
  const [openNo, setOpenNo] = useState(null);
  const [editNo, setEditNo] = useState(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef(null);

  const qs = paper ? paper.questions : [];

  async function onPick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setError("");
    if (!/\.docx$/i.test(f.name)) {
      setError("请选择 .docx 文件。老的 .doc 格式请先用 Word 另存为 .docx。");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`文件 ${(f.size / 1048576).toFixed(1)}MB，超过 4.5MB 上限。请在 Word 里删掉一些图片或压缩后重试。`);
      return;
    }

    setFileName(f.name);
    setStage("parsing");
    setPaper(null);
    setAnswers({});
    setPicked(new Set());

    try {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ""));
        fr.onerror = () => reject(new Error("读取文件失败"));
        fr.readAsDataURL(f);
      });

      const r = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", password, fileBase64: b64 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || r.statusText);

      setPaper(d.paper);
      setPicked(new Set(d.paper.questions.map((q) => q.no)));
      setStage("ready");
    } catch (err) {
      setError(err.message || "解析失败");
      setStage("idle");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function toggle(no) {
    setPicked((prev) => {
      const s = new Set(prev);
      if (s.has(no)) s.delete(no);
      else s.add(no);
      return s;
    });
  }

  async function runAnalyze(list) {
    if (!list.length) return;
    setStage("analyzing");
    setError("");

    const batches = [];
    for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
    setProg({ batch: 0, totalBatch: batches.length, msg: "" });

    let failed = 0;
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      setProg({ batch: bi + 1, totalBatch: batches.length, msg: `第 ${bi + 1}/${batches.length} 批（${batch.map((q) => q.no).join("、")} 题）` });
      try {
        const r = await fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "analyze", password, questions: batch }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || r.statusText);
        const got = Array.isArray(d.results) ? d.results : [];
        setAnswers((prev) => {
          const next = { ...prev };
          for (const it of got) next[it.no] = it;
          return next;
        });
        if (got.filter((x) => x.ok).length < batch.length) failed++;
      } catch (e) {
        failed++;
        setError((prev) => (prev ? prev + "；" : "") + `第 ${bi + 1} 批失败：${e.message}`);
      }
    }

    setProg({ batch: batches.length, totalBatch: batches.length, msg: failed ? `完成，${failed} 批失败` : "全部分析完成" });
    setStage("ready");
  }

  // 统计：知识点词频 + 难度分布
  const stats = useMemo(() => {
    const kp = new Map();
    const diff = { 易: 0, 中: 0, 难: 0, 压轴: 0 };
    let analyzed = 0;
    for (const q of qs) {
      const a = answers[q.no];
      if (!a || !a.ok) continue;
      analyzed++;
      for (const k of a.knowledgePoints || []) kp.set(k, (kp.get(k) || 0) + 1);
      if (a.difficultyLabel && diff[a.difficultyLabel] != null) diff[a.difficultyLabel]++;
    }
    return {
      analyzed,
      points: [...kp.entries()].sort((a, b) => b[1] - a[1]),
      diff,
    };
  }, [qs, answers]);

  const btn = (label, onClick, disabled, primary) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "#ddd" : primary ? C.dark : "#fff",
        color: disabled ? "#999" : primary ? "#f0e8d0" : C.dark,
        border: "1px solid " + (disabled ? "#ddd" : primary ? C.dark : C.border),
        borderRadius: 9,
        padding: "9px 16px",
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        fontWeight: primary ? 700 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ fontSize: 14, color: C.dark }}>
      {/* 上传区 */}
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.8, marginBottom: 12 }}>
          上传 Word 试卷（.docx）。系统会自动拆出每一道题，公式转成可显示的数学格式，然后逐题做教学分析。
          <br />
          支持：文字题干、LaTeX 公式、选项、表格、含图标记。不支持：整页扫描件（没有文字层）。
        </div>

        <input ref={fileRef} type="file" accept=".docx" onChange={onPick} style={{ display: "none" }} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {btn(stage === "parsing" ? "解析中…" : "选择 DOCX 文件", () => fileRef.current && fileRef.current.click(), stage === "parsing" || stage === "analyzing", true)}
          {paper && <span style={{ fontSize: 12, color: C.muted }}>{fileName}（{(paper.stats.questionCount)} 题）</span>}
        </div>

        {stage === "parsing" && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.accent }}>正在解开 Word、提取公式和图片…</div>
        )}
      </div>

      {error && (
        <div style={{ background: C.dangerBg, border: "1px solid " + C.danger + "44", color: C.danger, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, lineHeight: 1.7 }}>
          {error}
        </div>
      )}

      {/* 解析结果 */}
      {paper && (
        <>
          <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{paper.title}</div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: C.muted, marginBottom: 10 }}>
              <span>题目 <b style={{ color: C.dark }}>{paper.stats.questionCount}</b> 道</span>
              <span>公式 <b style={{ color: C.dark }}>{paper.stats.formulaCount}</b> 个</span>
              <span>图片 <b style={{ color: C.dark }}>{paper.stats.imageCount}</b> 张</span>
              <span>自带答案 <b style={{ color: C.dark }}>{paper.stats.answeredCount}</b> 道</span>
              <span>解析耗时 <b style={{ color: C.dark }}>{paper.stats.parseMs}</b> ms</span>
            </div>

            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.8 }}>
              {paper.sections.map((s) => `${s.label}（${s.count} 题）`).join("　")}
            </div>

            {paper.needsAIFallback && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#a06a10", background: "#fdf3dc", borderRadius: 8, padding: 8 }}>
                题号识别可能不完整（题数偏少或题号有大段断档），建议核对下面的题目列表，必要时手动补题。
              </div>
            )}
          </div>

          {/* 操作区 */}
          <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {btn(`分析选中的 ${picked.size} 题`, () => runAnalyze(qs.filter((q) => picked.has(q.no))), stage === "analyzing" || !picked.size, true)}
            {btn("全选", () => setPicked(new Set(qs.map((q) => q.no))), stage === "analyzing")}
            {btn("全不选", () => setPicked(new Set()), stage === "analyzing")}
            <span style={{ fontSize: 12, color: C.muted }}>
              每批 {BATCH} 题，共 {Math.ceil(picked.size / BATCH) || 0} 批
            </span>
          </div>

          {stage === "analyzing" && (
            <div style={{ background: C.blueBg, border: "1px solid " + C.blue + "33", color: C.blue, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 }}>
              正在分析：{prog.msg}
              <div style={{ marginTop: 6, fontSize: 12, color: C.muted }}>
                已出结果 {stats.analyzed} / {picked.size} 题。题目多时每批约 30-60 秒，请勿关闭页面。
              </div>
            </div>
          )}

          {/* 统计 */}
          {stats.analyzed > 0 && (
            <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                整卷概览（已分析 {stats.analyzed} / {qs.length} 题）
              </div>

              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, color: C.muted, marginRight: 8 }}>难度分布</span>
                {Object.entries(stats.diff).map(([k, v]) => {
                  const [col, bg] = DIFF_COLOR[k] || [C.muted, C.soft];
                  return v > 0 ? tag(`${k} ${v} 题`, col, bg) : null;
                })}
              </div>

              <div>
                <span style={{ fontSize: 12.5, color: C.muted, marginRight: 8, verticalAlign: "top" }}>知识点</span>
                <span style={{ display: "inline-block", maxWidth: "calc(100% - 70px)" }}>
                  {stats.points.slice(0, 24).map(([k, v]) => tag(`${k} ×${v}`, C.blue, C.blueBg))}
                </span>
              </div>
            </div>
          )}

          {/* 题目列表 */}
          {qs.map((q) => {
            const a = answers[q.no];
            const isOpen = openNo === q.no;
            const isPicked = picked.has(q.no);
            return (
              <div
                key={q.no}
                style={{
                  background: C.card,
                  border: "1px solid " + (isPicked ? C.accent + "88" : C.border),
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onChange={() => toggle(q.no)}
                    style={{ marginTop: 4, width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                      <b style={{ fontSize: 14 }}>第 {q.no} 题</b>
                      {tag(q.type, C.muted, C.soft)}
                      {q.latexCount > 0 && tag(`公式 ${q.latexCount}`, C.dim, C.soft)}
                      {q.images.length > 0 && tag(`图 ${q.images.length}`, "#a06a10", "#fdf3dc")}
                      {a && a.ok && a.difficultyLabel && tag(a.difficultyLabel, ...(DIFF_COLOR[a.difficultyLabel] || [C.muted, C.soft]))}
                      {!a && <span style={{ fontSize: 11.5, color: C.dim }}>未分析</span>}
                    </div>

                    {/* 题干 */}
                    {editNo === q.no ? (
                      <textarea
                        defaultValue={q.stem}
                        onBlur={(e) => {
                          const v = e.target.value;
                          setPaper((p) => {
                            const next = { ...p, questions: p.questions.map((x) => (x.no === q.no ? { ...x, stem: v } : x)) };
                            return next;
                          });
                          setEditNo(null);
                        }}
                        rows={4}
                        style={{ width: "100%", fontFamily: "inherit", fontSize: 13, lineHeight: 1.8, padding: 8, border: "1px solid " + C.border, borderRadius: 8, boxSizing: "border-box" }}
                      />
                    ) : (
                      <div
                        onClick={() => setOpenNo(isOpen ? null : q.no)}
                        style={{ fontSize: 13.5, lineHeight: 1.9, cursor: "pointer", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                      >
                        <MathText text={isOpen ? q.stem : q.stem.slice(0, 320) + (q.stem.length > 320 ? " …" : "")} />
                      </div>
                    )}

                    {/* 选项 */}
                    {q.options && q.options.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 2 }}>
                        {q.options.map((o) => (
                          <div key={o.tag} style={{ display: "flex", gap: 6 }}>
                            <b style={{ flexShrink: 0 }}>{o.tag}．</b>
                            <MathText text={o.text} />
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
                      <span style={{ color: C.dim, cursor: "pointer" }} onClick={() => setEditNo(q.no)}>
                        修正题干
                      </span>
                      {q.officialAnswer && (
                        <span style={{ color: C.muted }}>
                          卷面答案：<MathText text={q.officialAnswer.slice(0, 80)} />
                        </span>
                      )}
                      {a && a.ok && (
                        <span style={{ color: a.answer && q.officialAnswer && a.answer.trim() !== q.officialAnswer.trim().replace(/^故选[:：]?/, "").trim() ? C.danger : C.good }}>
                          AI 答案：<MathText text={a.answer} />
                        </span>
                      )}
                    </div>

                    {/* 分析结果 */}
                    {a && a.ok && (
                      <div style={{ marginTop: 10, borderTop: "1px dashed " + C.line, paddingTop: 10 }}>
                        {a.knowledgePoints.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: C.muted, marginRight: 6 }}>知识点</span>
                            {a.knowledgePoints.map((k) => tag(k, C.blue, C.blueBg))}
                          </div>
                        )}
                        {a.abilities.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: C.muted, marginRight: 6 }}>考查能力</span>
                            {a.abilities.map((k) => tag(k, "#6a5a8a", "#f0ecf8"))}
                          </div>
                        )}
                        {a.solution && (
                          <div style={{ fontSize: 13, lineHeight: 1.9, background: C.soft, borderRadius: 8, padding: 10, marginTop: 6 }}>
                            <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>解题过程</div>
                            <MathText text={a.solution} />
                          </div>
                        )}
                        {a.commonMistakes.length > 0 && (
                          <div style={{ marginTop: 8, background: C.dangerBg, borderRadius: 8, padding: 10 }}>
                            <div style={{ fontSize: 12, color: C.danger, marginBottom: 4 }}>易错点</div>
                            {a.commonMistakes.map((m, i) => (
                              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.8, color: "#8a3030" }}>
                                · <MathText text={m} />
                              </div>
                            ))}
                          </div>
                        )}
                        {a.note && (
                          <div style={{ marginTop: 8, fontSize: 12.5, color: "#a06a10", background: "#fdf3dc", borderRadius: 8, padding: 8, lineHeight: 1.7 }}>
                            {a.note}
                          </div>
                        )}
                      </div>
                    )}

                    {a && !a.ok && (
                      <div style={{ marginTop: 8, fontSize: 12.5, color: C.danger }}>
                        这一题 AI 没有返回结果，可以单独重试。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
