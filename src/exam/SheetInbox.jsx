// 答题卡收件箱：老师端「答题卡」页签
//
// 两个视角，顶部切换：
//   按学生 —— 一个孩子一行，点开是这学期交过的每一次。这是唯一能看出
//             "这个孩子这两次都交了没"的视角，逐份清单看不出来。
//   按提交 —— 按收到时间倒序，用来核对"群里说传完了的那几个，到底传上没有"。
//
// 现在这一页不只看「收到了什么」，还要看 AI 读分和三档丢分结论。
// 但底下两件事仍然一个都不能少：
//   1) 这个班谁没交 —— 追家长只能靠这个，靠翻聊天记录会漏人；
//      不预导名单，所以这里的"没交"是"上次交过、这次没交"，不是"从没交过"
//   2) 原件能下载下来 —— AI 也会读错，老师要能对着原卷复核；
//      所以必须能把 jpg 落到硬盘上，不能只能在线看
//
// 列表永远不取图片字节：一份 2000px 的答题卡 base64 有 50 万字符，
// 20 份就是 10 兆，列表一刷就卡死。点开某一份才取那一张。
//
// 取回来的图不再纵向铺满，改成缩略图宫格，点开进 SheetImageViewer 看细节：
// 以前一份 5 张全尺寸铺下去要滚五屏、还带 15 个按钮，缩略图一屏看完。
// 看图器里不放置删除按钮 —— 放大拖动的时候最容易误触，原件删了找不回来。

import { useEffect, useMemo, useState } from "react";
import ExamUpload from "./ExamUpload.jsx";
import SheetImageViewer from "./SheetImageViewer.jsx";

const C = {
  dark: "#2a2218",
  bg: "#f5f0e8",
  cream: "#fff8ee",
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

// 三档顺序固定：老师配卷子结构时就是这个顺序，报告里不要按别的方式重排。
const AI_LEVELS = [
  ["base", "不该丢", "#c03030", "#fde8e8", "#f0a0a0"],
  ["mid", "讲过", "#a06a10", "#fdf3dc", "#e8c870"],
  ["hard", "压轴", "#5a5a5a", "#eeeeee", "#c8c8c8"]
];

function analysisBadge(a, hasExam) {
  if (!hasExam) return { text: "未挂考试", bg: C.soft, color: C.dim, border: C.line };
  if (!a) return { text: "待分析", bg: C.soft, color: C.dim, border: C.line };
  if (a.status === "running") return { text: "AI 分析中", bg: "#eef2ff", color: "#4050a0", border: "#b8c2ee" };
  if (a.status === "error") return { text: "分析失败", bg: C.dangerBg, color: C.danger, border: "#e8a0a0" };
  if (a.status === "done" && a.ok) return { text: "AI 已完成", bg: C.goodBg, color: C.good, border: "#a8d0a8" };
  if (a.status === "pending") {
    return {
      text: (a.error || "").includes("卷子结构") ? "待配卷子" : "待分析",
      bg: "#fdf3dc",
      color: "#a06810",
      border: "#e8c870"
    };
  }
  return { text: "待分析", bg: C.soft, color: C.dim, border: C.line };
}

function AnalysisBadge({ analysis, hasExam }) {
  const b = analysisBadge(analysis, hasExam);
  return (
    <span
      style={{
        background: b.bg,
        border: "1px solid " + b.border,
        color: b.color,
        borderRadius: 6,
        padding: "0 6px",
        fontSize: 10.5,
        lineHeight: "18px",
        whiteSpace: "nowrap",
        flexShrink: 0
      }}
    >
      {b.text}
    </span>
  );
}

// 一份答题卡的 AI 报告。两个视角共用，避免改一处忘一处。
function AnalysisReport({ sheet, manualScore, analysis, busy, onRetry }) {
  const a = analysis;
  const manual = manualScore === undefined || manualScore === null || manualScore === "" ? null : Number(manualScore);
  const retryBtn = (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onRetry();
      }}
      disabled={!!busy}
      style={{
        background: C.soft,
        border: "1px solid " + C.line,
        color: busy ? C.dim : "#7a6a4a",
        borderRadius: 8,
        padding: "6px 11px",
        fontSize: 11.5,
        cursor: busy ? "default" : "pointer",
        fontFamily: "inherit",
        flexShrink: 0
      }}
    >
      {busy ? "重跑中…" : "重新分析"}
    </button>
  );

  if (!sheet.examId) {
    return (
      <div style={{ marginTop: 10, background: C.soft, border: "1px solid " + C.line, borderRadius: 10, padding: "10px 12px", fontSize: 12, color: C.dim, lineHeight: 1.8 }}>
        这份还没挂到某场考试，不会触发 AI 分析。先在上面选「这场属于」。
      </div>
    );
  }

  if (!a) {
    return (
      <div style={{ marginTop: 10, background: C.soft, border: "1px solid " + C.line, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, fontSize: 12, color: C.muted, lineHeight: 1.8 }}>
          AI 分析还没写回来。刷新页面看看；实在没有就点右边重跑。
        </div>
        {retryBtn}
      </div>
    );
  }

  if (a.status === "running") {
    return (
      <div style={{ marginTop: 10, background: "#eef2ff", border: "1px solid #b8c2ee", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#4050a0", lineHeight: 1.8 }}>
        正在读这张卷子的红笔分数，通常要半分钟。原件已经收下来了，等会儿刷新就能看到。
      </div>
    );
  }

  if (a.status === "pending" || a.status === "error" || !a.ok) {
    return (
      <div style={{ marginTop: 10, background: a.status === "error" ? C.dangerBg : "#fdf3dc", border: "1px solid " + (a.status === "error" ? "#e8a0a0" : "#e8c870"), borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, fontSize: 12, color: a.status === "error" ? "#a03030" : "#7a5a20", lineHeight: 1.8 }}>
          {a.status === "error" ? "AI 分析没成功：" : "暂时出不了报告："}{a.error || "再试一次"}
        </div>
        {retryBtn}
      </div>
    );
  }

  const aiTotal = a.score?.total ?? null;
  const lost = a.lost || {};
  const sum = a.score || {};
  const mismatch = manual !== null && !Number.isNaN(manual) && aiTotal !== null && Number(manual) !== Number(aiTotal);
  const problems = (a.check?.problems || []).filter(Boolean);

  return (
    <div style={{ marginTop: 10, background: C.soft, border: "1px solid " + C.line, borderRadius: 10, padding: "11px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: C.dark }}>
          AI 分析 · {a.paperTitle || "卷子结构"}
          {a.analyzedFirstOnly && <span style={{ fontSize: 10.5, color: C.dim, fontWeight: 400, marginLeft: 6 }}>（只读了第一张图）</span>}
        </div>
        {retryBtn}
      </div>

      {mismatch && (
        <div style={{ marginTop: 9, background: C.dangerBg, border: "1px solid #e8a0a0", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, color: "#a03030", lineHeight: 1.8 }}>
          AI 读到 <b>{aiTotal}</b> 分，你记的是 <b>{manual}</b> 分。两个对不上，点开原件核对一下。
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {[
          ["AI 总分", aiTotal === null ? "未读到" : aiTotal + " 分"],
          ["手填分", manual === null ? "未填" : manual + " 分"],
          ["合计丢分", sum.lostAll === undefined ? "—" : sum.lostAll + " 分"]
        ].map(([k, v]) => (
          <div key={k} style={{ flex: "1 1 90px", background: C.card, border: "1px solid " + C.line, borderRadius: 8, padding: "7px 9px" }}>
            <div style={{ fontSize: 10.5, color: C.dim }}>{k}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      {problems.length > 0 && (
        <div style={{ marginTop: 9, fontSize: 11, color: "#8a6a20", lineHeight: 1.9 }}>
          ⚠ 读分核对：{problems.slice(0, 3).join("；")}
          {a.check?.aiNotes ? "；模型备注：" + a.check.aiNotes : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {AI_LEVELS.map(([key, name, color, bg, border]) => {
          const rows = (a.groups?.[key] || []);
          return (
            <div key={key} style={{ flex: 1, minWidth: 0, background: bg, border: "1px solid " + border, borderRadius: 8, padding: "8px 9px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}>
                <span style={{ fontSize: 11, color, fontWeight: 700 }}>{name}</span>
                <span style={{ fontSize: 13, color, fontWeight: 700 }}>{lost[key] || 0} 分</span>
              </div>
              <div style={{ fontSize: 10.5, color: "#7a6a5a", marginTop: 5, lineHeight: 1.7 }}>
                {rows.length === 0 ? "没有丢分" : rows.slice(0, 4).map((r) => `${r.label || r.name || "某题"} -${r.lost}`).join("、")}
                {rows.length > 4 ? "…" : ""}
              </div>
            </div>
          );
        })}
      </div>

      {(a.rows || []).length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 4 }}>读分明细</div>
          {a.rows.map((r, i) => {
            const level = AI_LEVELS.find((x) => x[0] === r.level);
            const known = r.score !== null && !r.invalid;
            return (
              <div
                key={r.key || i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 58px 58px 58px",
                  gap: 4,
                  alignItems: "center",
                  padding: "4px 2px",
                  borderTop: "1px dashed " + C.line,
                  fontSize: 10.5,
                  color: C.muted
                }}
              >
                <span style={{ color: C.dark, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}{r.name ? " " + r.name : ""}</span>
                <span style={{ color: level ? level[2] : C.dim }}>{level ? level[1] : "未分档"}</span>
                <span>{known ? r.score : "未读到"}</span>
                <span>{r.fullScore}</span>
                <span style={{ color: known && r.fullScore - r.score > 0 ? C.danger : C.good }}>
                  {known ? "-" + (r.fullScore - r.score) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function when(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayOf(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// base64 → Blob。PDF 不能在 <img> 里显示，只能转成 blob URL 让浏览器自己打开。
function b64ToBlobUrl(b64, mediaType) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mediaType || "application/octet-stream" }));
}

// 列表上那个小方块：有 PDF 就直接写 PDF，否则写份数
function badgeOf(s) {
  const kinds = s.kinds || [];
  if (kinds.length === 0) return "?";
  if (kinds.includes("pdf")) return "PDF";
  return String(s.imageCount);
}

function kindText(s) {
  const kinds = s.kinds || [];
  if (kinds.includes("pdf")) return kinds.length > 1 ? `${kinds.length} 份（含 PDF）` : "PDF 原卷";
  return `${s.imageCount || 0} 张`;
}

// 分数徽标。老师第一眼要知道「这孩子这次多少分」，不该先点开图、再去卷子上找。
//
// 必须写清是谁填的：家长上传时自己在框里报的分，跟以后 AI 从卷面读出来的分
// 不是一回事。两个都标成「总分」，早晚有一天会拿错的那个去跟家长说话。
// 满分只在这个考试配了卷子结构时才有，没有就不写，不按 100/120 去猜。
function ScoreBadge({ entry, full, onEdit, blank = true }) {
  const hasScore = entry && entry.score !== undefined && entry.score !== null && entry.score !== "";
  if (!hasScore) {
    if (!blank) return null;
    return (
      <span style={{ fontSize: 11, color: "#b0a080", flexShrink: 0, whiteSpace: "nowrap" }} title="家长上传时没填总分">
        总分未填
      </span>
    );
  }
  const who = entry.source === "teacher" ? "老师改" : "家长填";
  const tip = entry.source === "teacher" ? "老师改过的分数" : "家长上传答题卡时自己填的总分，不是 AI 识别结果";
  return (
    <span
      onClick={onEdit ? (e) => { e.stopPropagation(); onEdit(entry.score); } : undefined}
      title={tip + (onEdit ? "；点一下可改" : "")}
      style={{
        background: "#e8f5e8",
        border: "1px solid #a8d0a8",
        borderRadius: 6,
        padding: "1px 6px",
        fontSize: 11,
        color: C.good,
        flexShrink: 0,
        whiteSpace: "nowrap",
        cursor: onEdit ? "pointer" : "default"
      }}
    >
      {who} {entry.score}
      {full ? <span style={{ color: "#6a9a6a" }}> / {full}</span> : null}
      {onEdit ? " ✎" : ""}
    </span>
  );
}

// 展开后的一组图片（或 PDF）。两个视角共用同一段渲染，
// 免得改一处忘一处——上一版这里就分叉过一次。
//
// 图片改成缩略图宫格 + 全屏看图器。以前是全尺寸纵向铺开：一份 5 张、
// 每张 2000px 高，要滚五屏，还带 15 个按钮。缩略图一屏看完，点开再放大看细节。
// 含 PDF 的那一份整份走老路子——PDF 进不了 <img>，也不在本次改造范围。
function SheetImages({ sheet, data, busy, onRemove, onOpen }) {
  if (busy) return <div style={{ fontSize: 12.5, color: C.dim, padding: "12px 0" }}>正在取图…</div>;
  if (!data) return null;
  if (data.error) return <div style={{ fontSize: 12.5, color: C.danger, padding: "12px 0" }}>⚠ {data.error}</div>;
  if (!Array.isArray(data)) return null;

  const hasPdf = data.some((im) => im.mediaType === "application/pdf");

  if (hasPdf) {
    return data.map((im, i) => {
      const isPdf = im.mediaType === "application/pdf";
      const href = isPdf ? im.blobUrl : im.dataUrl;
      const fileName = `${sheet.studentName || "答题卡"}-${sheet.examName || "未指定考试"}-${i + 1}.${isPdf ? "pdf" : "jpg"}`;
      return (
        <div key={i} style={{ marginTop: 12 }}>
          {isPdf ? (
            <div style={{ border: "1px solid " + C.line, background: C.soft, borderRadius: 8, padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#b04a30", letterSpacing: 1 }}>PDF</div>
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 4, lineHeight: 1.8 }}>PDF 不能直接预览，点「打开」用浏览器看</div>
            </div>
          ) : (
            <img src={im.dataUrl} alt={"第" + (i + 1) + "页"} style={{ width: "100%", borderRadius: 8, border: "1px solid " + C.line, display: "block", background: "#fff" }} />
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <a href={href} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: "center", background: C.dark, color: C.cream, borderRadius: 9, padding: "9px 0", fontSize: 12.5, textDecoration: "none" }}>
              {isPdf ? "打开" : "看原图"}
            </a>
            <a href={href} download={fileName} style={{ flex: 1, textAlign: "center", background: C.soft, border: "1px solid " + C.line, color: "#7a6a4a", borderRadius: 9, padding: "9px 0", fontSize: 12.5, textDecoration: "none" }}>
              下载
            </a>
            {onRemove && (
              <button onClick={onRemove} style={{ background: "transparent", border: "1px solid #e0a0a0", color: C.danger, borderRadius: 9, padding: "9px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                删除
              </button>
            )}
          </div>
        </div>
      );
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8 }}>
        {data.map((im, i) => {
          const fileName = `${sheet.studentName || "答题卡"}-${sheet.examName || "未指定考试"}-${i + 1}.jpg`;
          return (
            <div key={i} style={{ border: "1px solid " + C.line, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
              <button
                onClick={() => onOpen && onOpen(i)}
                aria-label={"打开第 " + (i + 1) + " 张"}
                style={{ display: "block", width: "100%", padding: 0, border: "none", background: C.soft, cursor: "zoom-in", position: "relative", fontFamily: "inherit" }}
              >
                <img
                  src={im.dataUrl}
                  alt={"第" + (i + 1) + "页"}
                  style={{ width: "100%", height: 132, objectFit: "contain", display: "block" }}
                />
                {data.length > 1 && (
                  <span style={{ position: "absolute", left: 4, top: 4, background: "rgba(42,34,24,0.72)", color: C.cream, fontSize: 10.5, lineHeight: 1, padding: "3px 5px", borderRadius: 5 }}>
                    {i + 1}
                  </span>
                )}
              </button>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px", borderTop: "1px solid " + C.line, background: "#fff" }}>
                <span style={{ fontSize: 10.5, color: C.dim }}>第 {i + 1} 页</span>
                <a href={im.dataUrl} download={fileName} style={{ fontSize: 10.5, color: C.muted, textDecoration: "none" }}>
                  下载
                </a>
              </div>
            </div>
          );
        })}
      </div>
      {onRemove && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button onClick={onRemove} style={{ background: "transparent", border: "1px solid #e0a0a0", color: C.danger, borderRadius: 9, padding: "7px 16px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            删除
          </button>
        </div>
      )}
    </div>
  );
}

// 一次把当前列表里所有答题卡的分析状态取回来，展开时直接用。
// 不塞进 answer-sheets 列表接口：那份接口只碰 sheet meta，分析是另一份数据，
// 混在一起会让每次刷新多读几十条 JSON。
async function fetchAnalyses(ids, password) {
  const clean = [...new Set((ids || []).filter(Boolean))].slice(0, 50);
  if (clean.length === 0) return {};
  const r = await fetch(
    `/api/analysis?view=many&ids=${encodeURIComponent(clean.join(","))}&password=${encodeURIComponent(password)}`
  );
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "读取分析失败");
  return d.analyses || {};
}

export default function SheetInbox({ password }) {
  const [catalog, setCatalog] = useState([]);
  const [gid, setGid] = useState("");
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [mode, setMode] = useState("student"); // student | sheet
  const [students, setStudents] = useState([]); // 按人的聚合
  const [sheets, setSheets] = useState([]); // 逐份
  const [stats, setStats] = useState({ count: 0, students: 0 });
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [openId, setOpenId] = useState(""); // 展开的某一份（两个视角共用）
  const [openSid, setOpenSid] = useState(""); // 按学生视角里展开的那个学生
  const [showUpload, setShowUpload] = useState(false);
  const [imgs, setImgs] = useState({}); // id -> [{dataUrl}] 或 {error}
  const [scores, setScores] = useState({}); // sid|examId -> { score, source }
  const [imgBusy, setImgBusy] = useState("");
  // 全屏看图器：{ sheetId, index, title }。只在纯图片的答题卡上打开，
  // 含 PDF 的走原来的「打开」按钮，不进来。
  const [viewer, setViewer] = useState(null);
  const [analyses, setAnalyses] = useState({}); // sheet id -> AI 分析状态/报告
  const [rerunBusy, setRerunBusy] = useState("");

  const load = async (filterGid, wantMode, filterExam) => {
    const m = wantMode || mode;
    const fg = filterGid === undefined ? gid : filterGid;
    const fe = filterExam === undefined ? examId : filterExam;
    setLoading(true);
    setErr("");
    try {
      const q = (fg ? "&gid=" + encodeURIComponent(fg) : "") + (fe ? "&examId=" + encodeURIComponent(fe) : "");
      const view = m === "student" ? "students" : "list";
      const r = await fetch(`/api/answer-sheets?view=${view}` + q + "&password=" + encodeURIComponent(password));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "读取失败");
      if (m === "student") {
        setStudents(Array.isArray(d.students) ? d.students : []);
      } else {
        setSheets(Array.isArray(d.sheets) ? d.sheets : []);
      }
      setStats(d.stats || { count: 0, students: 0 });

      // AI 报告另存一份，不混进 sheet meta。按学生视角要把每人名下的历次摊平。
      const rows = m === "student"
        ? (Array.isArray(d.students) ? d.students : []).flatMap((stu) => stu.sheets || [])
        : (Array.isArray(d.sheets) ? d.sheets : []);
      try {
        const amap = await fetchAnalyses(rows.map((x) => x.id), password);
        setAnalyses((cur) => ({ ...cur, ...amap }));
      } catch (_) {}

      // 分数不混在答题卡列表里：一场可能传三页，分只有一条。
      //
      // 后端 ?view=exam 只认单个 examId，一次只回一场的分。以前这里图省事
      // 只在「选了某一场」时才带 examId，没选就发了个不带参数的请求，
      // 后端 400 回来，scores 永远是空 —— 列表上就一个分都看不到，
      // 只能点开卷子自己找。现在按当前列表里出现的考试去重后并发取，
      // 有几场就几个请求（通常 1-3 个），再合成一张 sid|examId 表。
      try {
        const examIds = [...new Set(rows.map((x) => x.examId).filter(Boolean))];
        const got = await Promise.all(examIds.map(async (id) => {
          const sr = await fetch(`/api/scores?view=exam&examId=${encodeURIComponent(id)}&password=` + encodeURIComponent(password));
          const sd = await sr.json().catch(() => ({}));
          return sr.ok && Array.isArray(sd.scores) ? sd.scores : [];
        }));
        const map = {};
        got.flat().forEach((x) => {
          map[x.sid + "|" + x.examId] = { score: x.score, source: x.source || "parent" };
        });
        setScores(map);
      } catch (_) {}

      // 卷面满分不另取一次：上面那个 exams 列表里已经带 totalScore 了，
      // 直接用（见 examFull）。没配卷子结构就是 0，那就只显示分数，不猜满分。
    } catch (e) {
      setErr(e.message || "读取失败");
      setStudents([]);
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
    load("", "student");
  }, []);

  // 选了班级就顺带读这个班的名单和考试列表：
  //   名单 → 算「这场谁没交」
  //   考试 → 下拉里能选到"哪一场"，不选就是整班混在一起看
  useEffect(() => {
    setMembers([]);
    setExams([]);
    if (!gid) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/roster?view=pick&gid=" + encodeURIComponent(gid));
        const d = await r.json().catch(() => ({}));
        if (alive && r.ok && Array.isArray(d.students)) setMembers(d.students);
      } catch (_) {}
      try {
        const r = await fetch("/api/exams?view=list&gid=" + encodeURIComponent(gid) + "&password=" + encodeURIComponent(password));
        const d = await r.json().catch(() => ({}));
        if (alive && r.ok && Array.isArray(d.exams)) setExams(d.exams);
      } catch (_) {}
    })();
    return () => {
      alive = false;
    };
  }, [gid]);

  // 自动分析是上传后后台跑的：老师可能正好开着页面，状态从 running 变成 done。
  // 只追刚跑起来的那几分钟，不把"待配卷子"这种稳定状态无限轮询下去。
  useEffect(() => {
    const ageOf = (a) => {
      const t = a?.updatedAt ? Date.parse(a.updatedAt) : Date.now();
      return Number.isFinite(t) ? Date.now() - t : 0;
    };
    const polling = Object.entries(analyses)
      .filter(([, a]) => {
        if (!a) return false;
        if (a.status === "running") return ageOf(a) < 180000;
        if (a.status === "pending" && !a.error) return ageOf(a) < 120000;
        return false;
      })
      .map(([id]) => id);
    if (polling.length === 0) return;
    const t = setTimeout(async () => {
      try {
        const amap = await fetchAnalyses(polling, password);
        setAnalyses((cur) => ({ ...cur, ...amap }));
      } catch (_) {}
    }, 6000);
    return () => clearTimeout(t);
  }, [analyses, password]);

  // examId -> 卷面满分。取自考试里配的卷子结构（exams[].totalScore），
  // 没配卷子结构就是 0，这个映射里就不出现 —— 显示层据此决定要不要写「/ 120」。
  // 家长上传页只有「这次考试总分」一个框，本身没有满分这一项，所以不另开字段。
  const examFull = useMemo(() => {
    const m = {};
    (exams || []).forEach((e) => {
      const n = Number(e.totalScore || 0);
      if (n > 0) m[e.id] = n;
    });
    return m;
  }, [exams]);

  // 两个视角各有一份数据，缺交判断要跟着当前视角走 ——
  // 只认 students 的话，切到「按提交」再换班级，算的是旧班的人。
  const gotSids = useMemo(() => {
    if (mode === "student") return new Set(students.map((s) => s.sid));
    return new Set(sheets.map((s) => s.sid));
  }, [mode, students, sheets]);

  const missing = useMemo(() => {
    // 只有选中了具体某一场，才谈得上"这场没交"。
    // 只看整班时没有"这次"这个概念，硬算出来的名单是错的。
    if (!examId || members.length === 0) return [];
    return members.filter((m) => !gotSids.has(m.sid));
  }, [examId, members, gotSids]);

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
        if (d.mediaType === "application/pdf") {
          out.push({ mediaType: d.mediaType, blobUrl: b64ToBlobUrl(d.data, d.mediaType) });
        } else {
          out.push({ mediaType: d.mediaType, dataUrl: `data:${d.mediaType || "image/jpeg"};base64,${d.data}` });
        }
      }
      setImgs((cur) => ({ ...cur, [s.id]: out }));
    } catch (e) {
      setImgs((cur) => ({ ...cur, [s.id]: { error: e.message || "取图失败" } }));
    } finally {
      setImgBusy("");
    }
  };

  const remove = async (s, e) => {
    if (e) e.stopPropagation();
    if (!confirm(`删除 ${s.studentName} 的这份答题卡（${s.imageCount} 张）？删了就找不回来了。`)) return;
    try {
      const r = await fetch("/api/answer-sheets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, password })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "删除失败");

      // 两个视角各改各的。统计从改完的列表重算，不手工加减 ——
      // 手工减过一次「涉及学生数」，删最后一份的时候多减了一个。
      const leftSheets = sheets.filter((x) => x.id !== s.id);
      // 按学生视角要连带改次数，次数归零的学生整行去掉
      const leftStudents = students
        .map((g) => {
          const keep = g.sheets.filter((x) => x.id !== s.id);
          return { ...g, sheets: keep, count: keep.length };
        })
        .filter((g) => g.count > 0);

      setSheets(leftSheets);
      setStudents(leftStudents);
      setStats(
        mode === "student"
          ? { students: leftStudents.length, count: leftStudents.reduce((n, g) => n + g.count, 0) }
          : { count: leftSheets.length, students: new Set(leftSheets.map((x) => x.sid)).size }
      );

      if (openId === s.id) setOpenId("");
      setImgs((cur) => {
        const next = { ...cur };
        delete next[s.id];
        return next;
      });
    } catch (err2) {
      alert("删除失败：" + (err2.message || "网络问题"));
    }
  };

  // 老师改分：点分数条直接改，改完不用整页刷新
  const saveScore = async (sid, examId, value) => {
    try {
      const r = await fetch("/api/scores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid, examId, score: value, password })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "改分失败");
      // 老师改过就记成 teacher，徽标上不再写「家长填」——
      // 改完还写着家长填，下次自己都分不清这个数是谁给的。
      setScores((cur) => ({ ...cur, [sid + "|" + examId]: { score: value, source: "teacher" } }));
    } catch (e) {
      alert("改分失败：" + (e.message || "网络问题"));
    }
  };

  // 改分入口：两个视角共用，免得 prompt 文案两处写得不一样。
  const editScore = (sid, examId, examName, cur) => {
    const next = window.prompt(`${examName || "这场考试"} 的分数`, String(cur));
    if (next === null) return;
    if (!/^\d{1,3}(\.\d)?$/.test(next.trim())) return alert("填数字，比如 108 或 108.5");
    saveScore(sid, examId, Number(next));
  };

  // 改挂考试：家长传的时候没选考试，这里补上，否则按考试筛永远看不到这一份
  const attach = async (s, nextExamId) => {
    try {
      const r = await fetch("/api/answer-sheets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, examId: nextExamId, password })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "改挂失败");
      // 保持当前筛选条件刷新：挪走的就会从当前视图消失，这是对的
      await load(gid, mode);
    } catch (err2) {
      alert("改挂失败：" + (err2.message || "网络问题"));
    }
  };

  // 手动重跑：卷子结构配好了、图换清楚了、或者后台那次分析超时了，都从这里再来一次。
  const rerunAnalysis = async (s) => {
    setRerunBusy(s.id);
    try {
      const r = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, password })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && !d.analysis) throw new Error(d?.error || "重跑失败");
      setAnalyses((cur) => ({ ...cur, [s.id]: d.analysis || { id: s.id, status: "running", ok: false, error: "" } }));
      if (!r.ok) alert("这次没当场跑完，后台可能还在跑。稍后点刷新再看。");
    } catch (e) {
      // Vercel 免费版函数可能比 AI 读图先超时。原件和触发都在，
      // 这里先显示"分析中"，让老师去刷新，不要误以为按钮没生效。
      setAnalyses((cur) => ({ ...cur, [s.id]: { id: s.id, status: "running", ok: false, error: "", updatedAt: new Date().toISOString() } }));
      alert("重跑已提交，可能还在后台跑。稍后点刷新再看。");
    } finally {
      setRerunBusy("");
    }
  };

  // 分组名一般已经写了年级（初一秋季班），再把 grade 拼上去会出现「初一 初一秋季班」
  const classLabel = (s) => [s.school, s.groupName].filter(Boolean).join(" ");

  const tabStyle = (active) => ({
    flex: 1,
    padding: "8px 0",
    fontSize: 12.5,
    fontFamily: "inherit",
    cursor: "pointer",
    borderRadius: 8,
    border: "1px solid " + (active ? C.dark : "transparent"),
    background: active ? C.dark : "transparent",
    color: active ? C.cream : "#8a7a5a"
  });

  const emptyHint = (
    <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted, background: C.soft, borderRadius: 14, border: "1px dashed #c8b898" }}>
      <div style={{ fontSize: 34, marginBottom: 10 }}>📭</div>
      <div style={{ fontSize: 14 }}>还没有收到答题卡</div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 8, lineHeight: 1.9 }}>
        把 xinwang-math.com 的「考试答题卡上传」链接发群里，<br />家长填名字、拍照就传上来了。<br />家长直接发你微信的 PDF，点上面的「我自己补传」拖进来。
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ background: C.card, borderRadius: 14, border: "1px solid " + C.line, padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={gid}
            onChange={(e) => {
              setGid(e.target.value);
              setExamId("");
              setOpenId("");
              setOpenSid("");
              load(e.target.value, mode, "");
            }}
            style={{ flex: 1, minWidth: 160, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", color: C.dark, background: C.soft, border: "1px solid " + C.line, borderRadius: 9, outline: "none" }}
          >
            <option value="">全部班级</option>
            {catalog.map((s) =>
              (s.groups || []).map((g) => (
                <option key={g.gid} value={g.gid}>
                  {g.grade ? g.grade + " · " : ""}{g.name}
                </option>
              ))
            )}
          </select>
          {gid && (
            <select
              value={examId}
              onChange={(e) => {
                setExamId(e.target.value);
                setOpenId("");
                setOpenSid("");
                load(gid, mode, e.target.value);
              }}
              style={{ flex: 1, minWidth: 150, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", color: C.dark, background: C.soft, border: "1px solid " + C.line, borderRadius: 9, outline: "none" }}
            >
              <option value="">全部考试</option>
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                  {ex.date ? " · " + ex.date : ""}
                  {ex.status === "closed" ? "（已停）" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => {
              setShowUpload((v) => !v);
            }}
            style={{ background: showUpload ? C.dark : C.soft, border: "1px solid " + (showUpload ? C.dark : C.line), color: showUpload ? C.cream : "#7a6a4a", borderRadius: 9, padding: "9px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
          >
            {showUpload ? "收起" : "＋ 我自己补传"}
          </button>
          <button
            onClick={() => load(gid)}
            style={{ background: C.soft, border: "1px solid " + C.line, color: "#7a6a4a", borderRadius: 9, padding: "9px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            🔄 刷新
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10, background: C.soft, border: "1px solid " + C.line, borderRadius: 10, padding: 4 }}>
          <button
            onClick={() => {
              setMode("student");
              setOpenId("");
              setOpenSid("");
              load(gid, "student");
            }}
            style={tabStyle(mode === "student")}
          >
            按学生
          </button>
          <button
            onClick={() => {
              setMode("sheet");
              setOpenId("");
              setOpenSid("");
              load(gid, "sheet");
            }}
            style={tabStyle(mode === "sheet")}
          >
            按提交
          </button>
        </div>

        <div style={{ fontSize: 12, color: C.dim, marginTop: 10, lineHeight: 1.9 }}>
          {examId ? "这场考试：" : ""}
          {mode === "student" ? (
            <>
              共 <b style={{ color: C.dark }}>{stats.students}</b> 名学生交过，累计 <b style={{ color: C.dark }}>{stats.count}</b> 份。
            </>
          ) : (
            <>
              已收 <b style={{ color: C.dark }}>{stats.count}</b> 份，涉及 <b style={{ color: C.dark }}>{stats.students}</b> 名学生。
            </>
          )}
          {missing.length > 0 && (
            <>
              {" "}
              还有 <b style={{ color: C.danger }}>{missing.length}</b> 人没交。
            </>
          )}
        </div>
      </div>

      {showUpload && (
        <div style={{ marginBottom: 12 }}>
          <ExamUpload mode="teacher" onUploaded={() => load(gid)} />
        </div>
      )}

      {err && (
        <div style={{ background: C.dangerBg, border: "1px solid #f0a0a0", borderRadius: 10, padding: "10px 14px", color: "#a03030", fontSize: 13, marginBottom: 12 }}>⚠ {err}</div>
      )}

      {missing.length > 0 && (
        <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 12.5, color: "#7a5a20", lineHeight: 1.9 }}>
          <b>这场还没交：</b>
          {missing.map((m) => m.name).join("、")}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "36px 0", color: C.dim, fontSize: 13 }}>正在读取…</div>
      ) : mode === "student" ? (
        students.length === 0 ? (
          emptyHint
        ) : (
          students.map((stu) => {
            const open = openSid === stu.sid;
            return (
              <div key={stu.sid} style={{ background: open ? "#fff8ee" : C.card, border: "1px solid " + (open ? C.accent : C.line), borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
                <div onClick={() => setOpenSid(open ? "" : stu.sid)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: C.soft,
                      border: "1px solid " + C.line,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#8a6a30",
                      flexShrink: 0
                    }}
                  >
                    {stu.count}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>{stu.name || "未署名"}</span>
                      <span style={{ fontSize: 11.5, color: C.dim }}>{classLabel(stu)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      交了 {stu.count} 次 · 最近 {dayOf(stu.lastAt)}
                      {stu.lastExam ? " · " + stu.lastExam : " · 未指定考试"}
                    </div>
                  </div>
                  <ScoreBadge
                    entry={stu.sheets[0] && stu.sheets[0].examId ? scores[stu.sid + "|" + stu.sheets[0].examId] : null}
                    full={stu.sheets[0] ? examFull[stu.sheets[0].examId] : undefined}
                    blank={false}
                  />
                  <span style={{ color: "#b0a080", fontSize: 11, flexShrink: 0 }}>{open ? "收起" : "查历次"}</span>
                </div>

                {open && (
                  <div style={{ padding: "0 14px 8px", borderTop: "1px solid " + C.line }}>
                    {stu.sheets.map((sh, i) => {
                      const expanded = openId === sh.id;
                      const withName = { ...sh, studentName: stu.name };
                      const mine = imgs[sh.id];
                      // 同一场考试传了不止一份时，标出这是第几份。
                      // 家长重复提交是常事（以为没传上、换张更清楚的），
                      // 不标出来会被当成重复记录或者脏数据。
                      const sameExam = sh.examId ? stu.sheets.filter((x) => x.examId === sh.examId) : [];
                      const dupNo = sameExam.length > 1
                        ? sameExam.filter((x) => (x.createdAt || 0) < (sh.createdAt || 0)).length + 1
                        : 0;
                      return (
                        <div key={sh.id} style={{ borderBottom: i === stu.sheets.length - 1 ? "none" : "1px dashed " + C.line, paddingTop: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 44, fontSize: 11, color: C.dim, flexShrink: 0, textAlign: "right" }}>{dayOf(sh.createdAt)}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.dark, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {sh.examName || "未指定考试"}
                                </span>
                                {dupNo ? (
                                  <span style={{ background: "#fdf0e0", border: "1px solid #e8d0a0", borderRadius: 6, padding: "0 6px", fontSize: 11, color: "#8a6a30", flexShrink: 0, whiteSpace: "nowrap" }}>
                                    第 {dupNo} 份
                                  </span>
                                ) : null}
                                {sh.examId ? (
                                  <ScoreBadge
                                    entry={scores[stu.sid + "|" + sh.examId]}
                                    full={examFull[sh.examId]}
                                    onEdit={(cur) => editScore(stu.sid, sh.examId, sh.examName, cur)}
                                  />
                                ) : null}
                                <AnalysisBadge analysis={analyses[sh.id]} hasExam={!!sh.examId} />
                              </div>
                              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                                {kindText(sh)} · {sh.source === "teacher" ? "你补传的" : "家长传的"} · {when(sh.createdAt)}
                                {sh.note ? " · 留言：" + sh.note : ""}
                              </div>
                            </div>
                            <button
                              onClick={() => openSheet(withName)}
                              style={{ background: expanded ? C.dark : C.soft, border: "1px solid " + (expanded ? C.dark : C.line), color: expanded ? C.cream : "#7a6a4a", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
                            >
                              {expanded ? "收起" : "看原件"}
                            </button>
                          </div>
                          {expanded && (
                            <div style={{ paddingBottom: 6 }}>
                              <AnalysisReport
                                sheet={withName}
                                manualScore={scores[stu.sid + "|" + sh.examId]?.score}
                                analysis={analyses[sh.id]}
                                busy={rerunBusy === sh.id}
                                onRetry={() => rerunAnalysis(sh)}
                              />
                              <SheetImages
                                sheet={withName}
                                data={mine}
                                busy={imgBusy === sh.id}
                                onRemove={(e) => remove(withName, e)}
                                onOpen={(i) => setViewer({ sheetId: sh.id, index: i, title: `${withName.studentName || "未署名"} · ${withName.examName || "未指定考试"}` })}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )
      ) : sheets.length === 0 ? (
        emptyHint
      ) : (
        sheets.map((s) => {
          const expanded = openId === s.id;
          const mine = imgs[s.id];
          return (
            <div key={s.id} style={{ background: expanded ? "#fff8ee" : C.card, border: "1px solid " + (expanded ? C.accent : C.line), borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
              <div onClick={() => openSheet(s)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: C.soft,
                    border: "1px solid " + C.line,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: (s.kinds || []).includes("pdf") ? 10.5 : 13,
                    fontWeight: 700,
                    color: (s.kinds || []).includes("pdf") ? "#b04a30" : "#8a6a30",
                    flexShrink: 0
                  }}
                >
                  {badgeOf(s)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.dark }}>{s.studentName}</span>
                    <span style={{ fontSize: 11.5, color: C.dim }}>{classLabel(s)}</span>
                    <ScoreBadge
                      entry={s.examId ? scores[s.sid + "|" + s.examId] : null}
                      full={examFull[s.examId]}
                      onEdit={s.examId ? (cur) => editScore(s.sid, s.examId, s.examName, cur) : undefined}
                    />
                    <AnalysisBadge analysis={analyses[s.id]} hasExam={!!s.examId} />
                  </div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.examName || "未指定考试"} · {kindText(s)} · {when(s.createdAt)}
                    {s.source === "teacher" ? " · 你补传的" : ""}
                    {s.note ? " · 留言：" + s.note : ""}
                  </div>
                </div>
                <span style={{ color: "#b0a080", fontSize: 11, flexShrink: 0 }}>{expanded ? "收起" : "查看"}</span>
              </div>

              {expanded && (
                <div style={{ padding: "0 14px 14px", borderTop: "1px solid " + C.line }}>
                  {gid && exams.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: C.muted }}>
                      <span style={{ flexShrink: 0 }}>这场属于</span>
                      <select
                        value={s.examId || ""}
                        onChange={(e) => attach(s, e.target.value)}
                        style={{ flex: 1, minWidth: 0, padding: "7px 8px", fontSize: 12, fontFamily: "inherit", color: C.dark, background: C.soft, border: "1px solid " + C.line, borderRadius: 8, outline: "none" }}
                      >
                        <option value="">请选择考试</option>
                        {exams.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <AnalysisReport
                    sheet={s}
                    manualScore={scores[s.sid + "|" + s.examId]?.score}
                    analysis={analyses[s.id]}
                    busy={rerunBusy === s.id}
                    onRetry={() => rerunAnalysis(s)}
                  />
                  <SheetImages
                    sheet={s}
                    data={mine}
                    busy={imgBusy === s.id}
                    onRemove={(e) => remove(s, e)}
                    onOpen={(i) => setViewer({ sheetId: s.id, index: i, title: `${s.studentName || "未署名"} · ${s.examName || "未指定考试"}` })}
                  />
                </div>
              )}
            </div>
          );
        })
      )}

      {/* 全屏看图器。浮层挂在 body 上，列表 DOM 不卸载，
          所以关掉之后还停在原来那个滚动位置。删除不进来，避免看图时误触。 */}
      {viewer && (
        <SheetImageViewer
          items={(imgs[viewer.sheetId] || []).filter((d) => d && d.mediaType !== "application/pdf")}
          index={viewer.index}
          title={viewer.title}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
