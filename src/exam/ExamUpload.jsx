// 答题卡上传（家长端入口）
//
// 这一版只做「收」，不做「判」。原因写在下面对家长的说明里，不藏着：
// 判断一份卷子的 3 分该不该丢，前提是老师先把这份卷子按难度分过类；
// 那个前提在期中之前不成立。但答题卡是过期就补不回来的东西，
// 所以先把原件收下来，分析能力后补。
//
// 几个刻意的选择：
//   1) 名字手填，系统按「班级 + 姓名」认领。不预导名单有两层考虑：
//      老师不用每次接新班录 60 个名字；家长也看不到全班其他孩子的姓名。
//   2) 考试必选，而且只有建班时预置的四场：第一次月考、期中、第二次月考、期末。
//      不设「未指定」—— 那种答卷按考试筛永远出不来，"这场谁没交"会冤枉人。
//      也不替家长默认勾第一场：默默算成月考比不填更难发现。
//   2b) 学校必填。将来 AI 分析卷面要先有这一份卷子的评分标准；同一所学校的
//      统一考试用同一份卷子，标准就能复用。少一个学校字段，每份卷子都得单独建标准。
//   3) 照片压到 ~50 万字符一张（2000px 长边、约 170dpi）。答题卡上的字
//      和红笔批改都要看得清，不能像作业检查那样压到 900px。
//   4) 记一台设备上次选的学生。一个家长通常只管一个孩子，
//      第二次再传不该从选学校重新点一遍。

import { useEffect, useRef, useState } from "react";

// 年级顺序固定，不按字典序（否则"初三"会排到"初一"前面）
const GRADES = ["初一", "初二", "初三"];

function gradesOf(groups) {
  const has = new Set((groups || []).map((g) => g.grade).filter(Boolean));
  return GRADES.filter((g) => has.has(g)).concat([...has].filter((g) => !GRADES.includes(g)));
}

const C = {
  dark: "#2a2218",
  card: "#fff",
  soft: "#faf6ee",
  accent: "#e8a030",
  line: "#e8d0a0",
  dim: "#a08060",
  cream: "#f0e8d0"
};

// 这台设备上输过的孩子：[{gid, name, sid, school, at}]，最多存 10 条。
// 只存在家长自己的手机里，服务端不返回任何名单 —— 所以既要让老家长零打字，
// 又不能让任何人的名字被别人看见，只能靠这个。
// school 也记在这里：家长第二次传就不用再填一遍孩子的学校。
const PEOPLE_KEY = "xw_sheet_people";

function loadPeople() {
  try {
    const v = JSON.parse(localStorage.getItem(PEOPLE_KEY) || "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((p) => p && p.gid && p.name);
  } catch (_) {
    return [];
  }
}

function savePerson(p) {
  try {
    const list = loadPeople().filter((x) => !(x.gid === p.gid && x.name === p.name));
    list.unshift({ gid: p.gid, name: p.name, sid: p.sid || "", school: p.school || "", at: Date.now() });
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(list.slice(0, 10)));
  } catch (_) {}
}

// 单张图 base64 字符数上限。Vercel 函数请求体 4.5MB，三张 70 万字符约 2.1MB，
// 留足余量；同时 70 万字符（≈52 万字节）的 JPEG 存一份也不至于太贵。
const BUDGET = 700000;
// 一份答题卡六到八页是常态，一页一张才看得清，所以给到 9。
const MAX_SHOTS = 9;
// 一次请求能装的总量。服务端上限 360 万字符，这里留点余量；
// 装不下就让家长先传这些，再点一次传剩下的（服务端本来就允许同一学生多次提交）。
const TOTAL_BUDGET = 3200000;
// 整份拼成一张的长图，一页只占几百像素，体积主要浪费在宽度上，
// 所以单独给一个更高的额度，不然会被压到更看不清。
const STRIP_BUDGET = 1400000;

// 智学网 App「分享 → 微信」出来的那份 PDF，就是孩子答题卡的扫描件：
// 正、清晰、每块的红笔得分都在上面。它比家长举着手机拍强得多，
// 所以必须收。但 PDF 在浏览器里没法像照片那样重编码，只能整份塞进去，
// 所以单独给一个体积上限，超了就明确告诉家长，不要静悄悄传失败。
const PDF_MAX_BYTES = 2 * 1024 * 1024;

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      return reject(new Error("选的是图片吗？点「拍照」或者从相册里选一张"));
    }
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("这张图片读不出来，换一张试试"));
    fr.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("这张图片打不开，可能不是常见格式，换一张试试"));
      img.onload = () => resolve(img);
      img.src = e.target.result;
    };
    fr.readAsDataURL(file);
  });
}

async function encodeAt(img, maxSide, quality) {
  let w = img.width;
  let h = img.height;
  if (w > maxSide || h > maxSide) {
    if (w > h) {
      h = Math.round((h * maxSide) / w);
      w = maxSide;
    } else {
      w = Math.round((w * maxSide) / h);
      h = maxSide;
    }
  }
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  // 透明背景转 JPEG 会变黑，先铺白底
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("图片压缩失败，换一张试试");
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = (e) => resolve(e.target.result);
    fr.onerror = () => reject(new Error("图片压缩后读取失败"));
    fr.readAsDataURL(blob);
  });
  return { data: String(dataUrl).split(",")[1] || "", preview: dataUrl, bytes: blob.size };
}

// 一档档往下试，直到塞进预算。每档都是重新编码（而不是把已经压过的再压一遍），
// 避免二次压缩把字压糊。
//
// 多页拼成一张的长图要区别对待：按长边 2000 缩的话，八页并排每页只剩 250 像素，
// 手写步骤直接糊成一团。这类图源头就已经不高清，能保住原尺寸就保住。
async function compressSheet(file) {
  const img = await readImage(file);
  const strip = img.width / img.height > 2.2;
  const budget = strip ? STRIP_BUDGET : BUDGET;

  const steps = strip
    ? [
        [4000, 0.82],
        [4000, 0.74],
        [3200, 0.7],
        [2600, 0.64],
        [2200, 0.6]
      ]
    : [
        [2000, 0.78],
        [1800, 0.76],
        [1800, 0.68],
        [1600, 0.68],
        [1500, 0.62],
        [1300, 0.6]
      ];

  let last = null;
  for (let i = 0; i < steps.length; i++) {
    last = await encodeAt(img, steps[i][0], steps[i][1]);
    if (last.data.length <= budget) break;
  }
  if (!last || last.data.length > budget * 1.7) {
    throw new Error("这张图片太大，压不到能上传的尺寸。换个角度重拍一次（别用截图，截图往往更大）");
  }
  return { ...last, srcW: img.width, srcH: img.height, strip };
}

// PDF 不压缩，原样转 base64。能不能传得上去，取决于原文件多大，
// 所以先量体积再决定，而不是压完才发现超了。
function readPdf(file) {
  return new Promise((resolve, reject) => {
    if (file.size > PDF_MAX_BYTES) {
      return reject(
        new Error(
          `这份 PDF 有 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 2MB 传不了。点开 PDF 选「打印/另存」重存一份小的，或者直接拍答题卡。`
        )
      );
    }
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("这份 PDF 读不出来，换一份试试"));
    fr.onload = (e) => {
      const dataUrl = e.target.result;
      resolve({
        kind: "pdf",
        data: String(dataUrl).split(",")[1] || "",
        bytes: file.size,
        name: file.name || "答题卡.pdf"
      });
    };
    fr.readAsDataURL(file);
  });
}

const labelStyle = { fontSize: 12, color: C.dim, marginBottom: 6, letterSpacing: 1 };

const controlStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 12px",
  fontSize: 16, // 小于 16px 时 iOS 会自动放大页面
  fontFamily: "inherit",
  color: C.dark,
  background: "#fff",
  border: "1px solid " + C.line,
  borderRadius: 10,
  outline: "none"
};

function Sel({ label, value, onChange, disabled, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ position: "relative" }}>
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          style={{ ...controlStyle, appearance: "none", WebkitAppearance: "none", paddingRight: 34, color: value ? C.dark : "#a09480" }}
        >
          {children}
        </select>
        <span style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", color: "#b8a888", fontSize: 10, pointerEvents: "none" }}>▼</span>
      </div>
    </div>
  );
}

export default function ExamUpload({ mode = "parent", onUploaded }) {
  const [catalog, setCatalog] = useState(null); // null = 读取中
  const [grade, setGrade] = useState(""); // 家长端年级筛选（补习班班有多个年级时才出现）
  const [gid, setGid] = useState("");
  const [sid, setSid] = useState("");
  const [name, setName] = useState("");
  // 孩子读哪所学校：学生属性，不是分组。家长手填，本机记过就带出来。
  // 必填 —— 将来 AI 按学校复用同一份卷子的评分标准，没有学校字段就得每份卷子重来一遍。
  const [studentSchool, setStudentSchool] = useState("");
  const [people, setPeople] = useState([]);
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [shots, setShots] = useState([]);
  // 只影响提示文案，不进数据：家长先说清手上是什么，提示才对得上，
  // 比把三条注意事项一起堆在下面有效。
  const [sourceKind, setSourceKind] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState("");
  // 家长看纸质答题卡报的总分。空着也能传 —— 有的学校不让拍照带走，
  // 或者分数还没出来，不能因为填不了分就卡住原件收集。
  const [score, setScore] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  // 家长上传成功后等后台 AI 出结论。只给结论，不给老师用的核对细节。
  const [parentAnalysis, setParentAnalysis] = useState(null);
  const [mine, setMine] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const camRef = useRef(null);
  const fileRef = useRef(null);

  // ── 读班级目录（顺带恢复上次选的学生）──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/roster?view=catalog");
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) throw new Error(d?.error || "读取班级失败");
        const schools = Array.isArray(d.schools) ? d.schools : [];
        setCatalog(schools);

        // 补习班的班不按学校拆，把目录里所有分组摊平，家长按年级 → 班级选。
        const allGroups = schools.flatMap((s) => s.groups || []);
        const list = loadPeople();
        setPeople(list);
        // 默认落到第一个年级的第一个班，别让家长一进来面对一串空下拉。
        const firstGrade = gradesOf(allGroups)[0] || "";
        const firstGroup = allGroups.find((g) => g.grade === firstGrade) || allGroups[0];
        setGrade(firstGroup?.grade || "");
        setGid(firstGroup?.gid || "");
        if (list.length === 0) return;
        // 恢复最近一次用的班级和名字。班级可能已经被删了，先确认还在目录里。
        const last = list.find((p) => allGroups.some((g) => g.gid === p.gid));
        if (!last) return;
        const lastGroup = allGroups.find((g) => g.gid === last.gid);
        setGrade(lastGroup?.grade || "");
        setGid(last.gid);
        setName(last.name);
        setStudentSchool(last.school || "");
        if (last.sid) setSid(last.sid);
      } catch (e) {
        if (!alive) return;
        setCatalog([]);
        setLoadErr(e.message || "读取班级失败");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── 选了班级：读这个班开放中的考试（不再拉名单）──
  useEffect(() => {
    if (!gid) {
      setExams([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r2 = await fetch("/api/exams?view=open&gid=" + encodeURIComponent(gid));
        const d2 = await r2.json().catch(() => ({}));
        if (!alive) return;
        const openExams = Array.isArray(d2.exams) ? d2.exams : [];
        setExams(openExams);
        // 必选，不替家长默认勾第一场。默认勾上等于悄悄把月考算成期中，
        // 而且家长不会发现 —— 选错一场比没选更糟。
        setExamId((cur) => (cur && openExams.some((e) => e.id === cur) ? cur : ""));
      } catch (_) {
        if (!alive) return;
        setExams([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gid]);

  // ── 上传成功后，等家长自己那一份的 AI 初步结论 ──
  // 分析在后台跑，家长不用对着上传按钮转圈；结论出来前只显示一行进度。
  // 只认 sheet id + sid，sid 是随机串且必须和档案一致，不会看到别人家的孩子。
  useEffect(() => {
    setParentAnalysis(null);
    if (!done || mode !== "parent" || !done.analyzing || !done.id || !done.sid) return;
    let alive = true;
    let timer = null;
    let tries = 0;
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(
          `/api/analysis?view=mine&id=${encodeURIComponent(done.id)}&sid=${encodeURIComponent(done.sid)}`
        );
        const d = await r.json().catch(() => ({}));
        if (alive && r.ok) {
          const a = d.analysis || null;
          setParentAnalysis(a);
          if (a && (a.status === "done" || a.status === "error" || (a.status === "pending" && a.error))) stop = true;
        }
      } catch (_) {}
      tries += 1;
      if (alive && !stop && tries < 30) timer = setTimeout(poll, 5000);
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [done?.id, done?.sid, done?.analyzing, mode]);

  // ── 名字变了：本机记过的（同班同名）直接用 sid，没记过就交给服务端认领 ──
  useEffect(() => {
    if (!gid || !name) {
      setSid("");
      return;
    }
    const hit = people.find((p) => p.gid === gid && p.name === name);
    setSid(hit?.sid || "");
  }, [gid, name, people]);

  // ── 这个学生之前传过几份 ──
  useEffect(() => {
    setMine(null);
    if (!sid) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/answer-sheets?view=mine&sid=" + encodeURIComponent(sid));
        const d = await r.json().catch(() => ({}));
        if (alive && r.ok) setMine(d);
      } catch (_) {}
    })();
    return () => {
      alive = false;
    };
  }, [sid, done]);

  // 订阅班是补习班的班，不按学校拆。学校只是学生身上的一个属性。
  // 所以把目录里所有分组摊平，家长直接按年级 → 班级选。
  const allGroups = (catalog || []).flatMap((s) => s.groups || []);
  const gradeOptions = gradesOf(allGroups);
  const classList = allGroups.filter((g) => !grade || g.grade === grade);
  // "孩子学校"的候选只从这台设备记过的学生里来。
  // 不拉全班名单 —— 隐私红线上家长端看不到别的孩子信息。
  const schoolOptions = [...new Set(people.map((p) => p.school).filter(Boolean))];
  // 这台设备在这个班输过的名字。别的家长的名字永远不会出现在这里 ——
  // 数据只在本地，服务端根本不返回名单。
  const sameGid = gid ? people.filter((p) => p.gid === gid) : [];

  const addFiles = async (files) => {
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    setErr("");
    if (shots.length >= MAX_SHOTS) {
      setErr(`最多 ${MAX_SHOTS} 份。答题卡有几页就传几页，但一页一张。`);
      return;
    }
    let used = shots.reduce((n, s) => n + s.data.length, 0);
    const next = [];
    let skipped = 0;
    try {
      for (let i = 0; i < arr.length; i++) {
        if (shots.length + next.length >= MAX_SHOTS) {
          skipped += arr.length - i;
          break;
        }
        const f = arr[i];
        setBusy(`正在处理第 ${i + 1} 份（共 ${arr.length} 份）…`);
        const item =
          String(f.type || "") === "application/pdf" || /\.pdf$/i.test(f.name || "")
            ? await readPdf(f)
            : { ...(await compressSheet(f)), kind: "image" };
        if (used + item.data.length > TOTAL_BUDGET) {
          skipped += arr.length - i;
          break;
        }
        used += item.data.length;
        next.push(item);
      }
      setShots((cur) => [...cur, ...next]);
      if (skipped > 0) {
        setErr(`一次装不下 ${skipped} 份。先把这些传上去，传完再点一次传剩下的，都会挂到同一个孩子名下。`);
      }
    } catch (e) {
      setErr(e.message || "文件处理失败");
    } finally {
      setBusy("");
    }
  };

  const submit = async () => {
    setErr("");
    if (!gid) return setErr("先选班级");
    if (!name.trim()) return setErr("先填孩子的姓名");
    if (!studentSchool.trim()) return setErr("先填孩子读哪所学校");
    if (!examId) return setErr("先选这次是哪场考试");
    if (shots.length === 0) return setErr("还没选答题卡");
    if (String(score).trim() && !/^\d{1,3}(\.\d)?$/.test(String(score).trim())) {
      return setErr("分数填成数字就行，比如 108 或 108.5");
    }
    setBusy("正在上传…");
    try {
      const r = await fetch("/api/answer-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gid,
          // 本机记过就带 sid（最快最准）；没记过只给名字，服务端按「班级+姓名」认领或新建
          sid: sid || "",
          studentName: sid ? "" : name.trim(),
          // 学校记在学生身上，将来 AI 按同一所学校的卷子分析时用。
          studentSchool: studentSchool.trim(),
          examId: examId || "",
          note,
          source: mode,
          images: shots.map((s) => ({
            data: s.data,
            mediaType: s.kind === "pdf" ? "application/pdf" : "image/jpeg"
          }))
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d?.error || r.statusText);
      if (d.sid) {
        setSid(d.sid);
        savePerson({ gid, name: d.studentName || name.trim(), sid: d.sid, school: studentSchool.trim() });
        setPeople(loadPeople());
      }
      setParentAnalysis(null);
      setDone(d);

      // 分数单独存。答题卡已经传上去了，就算这一步失败也不能让用户以为没传成 ——
      // 分数随时能补，原件补不回来。所以这里的错误只记下来，不抛给上传流程。
      let scoreSaved = false;
      if (String(score).trim()) {
        try {
          const sr = await fetch("/api/scores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gid, sid: d.sid, examId, score: Number(score), source: mode })
          });
          const sd = await sr.json().catch(() => ({}));
          scoreSaved = sr.ok && !!sd.ok;
        } catch (_) {}
      }

      setDone({
        ...d,
        scoreSaved,
        scoreWanted: !!String(score).trim(),
        parentScore: String(score).trim() ? Number(score) : null
      });
      setShots([]);
      setNote("");
      setScore("");
      if (onUploaded) onUploaded();
    } catch (e) {
      const isNet = /Load failed|Failed to fetch|NetworkError|network error/i.test(e.message || "");
      setErr(
        isNet
          ? "网络断了，答题卡没传上来。换个信号好一点的地方（比如靠近路由器、或者切到流量）再点一次。"
          : e.message
      );
    } finally {
      setBusy("");
    }
  };

  // ══════════ 上传成功 ══════════
  if (done) {
    const pa = parentAnalysis;
    const paMismatch = pa && pa.ok && pa.total !== null && done.parentScore !== null && Number(done.parentScore) !== Number(pa.total);
    const PA_LEVELS = [
      ["base", "不该丢", "#c03030", "#fde8e8"],
      ["mid", "讲过", "#a06a10", "#fdf3dc"],
      ["hard", "压轴", "#5a5a5a", "#eeeeee"]
    ];
    return (
      <div style={{ background: C.card, borderRadius: 14, border: "1px solid " + C.line, padding: "26px 20px", textAlign: "center" }}>
        <div style={{ width: 54, height: 54, borderRadius: 27, background: "#e8f5e0", color: "#3a8a3a", fontSize: 26, lineHeight: "54px", margin: "0 auto 14px" }}>✓</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.dark, marginBottom: 8 }}>收到了</div>
        <div style={{ fontSize: 13.5, color: "#5a4a30", lineHeight: 1.9 }}>
          {done.studentName}
          {done.examName ? " · " + done.examName : " · 未指定考试"} · {done.imageCount} 份
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.9, marginTop: 12 }}>
          {mode === "teacher"
            ? "已经挂到这个学生名下了，在下面的列表里能看到。"
            : "原件收到了。我这边正在自动核对卷面，稍等一下就能看到初步结果。"}
        </div>
        {mode === "parent" && done.analyzing && (
          <div style={{ marginTop: 12, textAlign: "left", background: C.soft, border: "1px solid " + C.line, borderRadius: 10, padding: "11px 12px" }}>
            {!pa || pa.status === "running" || (pa.status === "pending" && !pa.error) ? (
              <div style={{ fontSize: 12.5, color: "#7a6a4a", lineHeight: 1.9 }}>
                正在自动核对卷面…这一步只读红笔分数，先不用管。
              </div>
            ) : pa.status === "done" && pa.ok ? (
              <>
                <div style={{ fontSize: 12.5, color: C.dark, lineHeight: 1.9 }}>
                  初步读分：<b>{pa.total === null ? "没读清" : pa.total + " 分"}</b>
                  {pa.needsReview ? "，有几处要我再对一下原卷。" : "。"}
                </div>
                {paMismatch && (
                  <div style={{ fontSize: 11.5, color: "#a03030", lineHeight: 1.8, marginTop: 4 }}>
                    和你填的 {done.parentScore} 分对不上，我会按原卷再核一遍。
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                  {PA_LEVELS.map(([key, name, color, bg]) => (
                    <div key={key} style={{ flex: 1, minWidth: 0, background: bg, borderRadius: 7, padding: "7px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 10.5, color }}>{name}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color, marginTop: 2 }}>丢 {pa.lost?.[key] || 0} 分</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.8, marginTop: 8 }}>
                  这是初步结果，最后以老师讲评为准。
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "#7a6a4a", lineHeight: 1.9 }}>
                初步核对暂时没出来，原件已经收到了，我会看原卷。
              </div>
            )}
          </div>
        )}
        {done.scoreWanted && !done.scoreSaved && (
          <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 8, padding: "9px 12px", marginTop: 12, fontSize: 12, color: "#7a5a20", lineHeight: 1.8 }}>
            答题卡收到了，但分数没记上。等下在群里告诉我一声，我补进去。
          </div>
        )}
        <button
          onClick={() => setDone(null)}
          style={{ marginTop: 18, background: "transparent", border: "1px solid " + C.line, color: "#7a6a4a", borderRadius: 20, padding: "9px 22px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
        >
          {mode === "teacher" ? "再补一份" : "还有一页要传"}
        </button>
      </div>
    );
  }

  // ══════════ 表单 ══════════
  const loading = catalog === null;
  const teacher = mode === "teacher";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
      }}
      style={{ background: C.card, borderRadius: 14, border: "1px solid " + (dragOver ? C.accent : C.line), padding: "18px 16px" }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: C.dark, marginBottom: 4 }}>
        {teacher ? "替学生补传一份" : "把答题卡传上来"}
      </div>
      <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.9, marginBottom: 16 }}>
        {teacher
          ? "微信里收到的图片或 PDF 直接拖进来，选好是哪个学生就行。"
          : "一页一张，分开传。别把几页拼成一张，那样字会糊掉。"}
      </div>

      {loading && <div style={{ fontSize: 13, color: C.dim, padding: "10px 0" }}>正在读取班级名单…</div>}

      {!loading && catalog.length === 0 && (
        <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#7a5a20", lineHeight: 1.9 }}>
          {loadErr ? "班级读取失败：" + loadErr : "彭老师还没建班，现在传不了，先联系我。"}
        </div>
      )}

      {!loading && catalog.length > 0 && (
        <>
          {gradeOptions.length > 1 && (
            <Sel
              label="年级"
              value={grade}
              onChange={(e) => {
                const g = e.target.value;
                setGrade(g);
                const firstGroup = allGroups.find((x) => x.grade === g);
                setGid(firstGroup?.gid || "");
                setSid("");
                setName("");
                setStudentSchool("");
              }}
            >
              {gradeOptions.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </Sel>
          )}

          {/* 班级始终显示，哪怕只有一个：家长得知道这份卷子传到哪个班了。 */}
          <Sel
            label="班级"
            value={gid}
            onChange={(e) => {
              setGid(e.target.value);
              setSid("");
              setName("");
              setStudentSchool("");
            }}
          >
            {classList.map((g) => (
              <option key={g.gid} value={g.gid}>
                {(g.grade ? g.grade + " · " : "") + (g.name || "未命名班级")}
              </option>
            ))}
          </Sel>

          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>孩子姓名</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s+/g, ""))}
              placeholder={gid ? "填孩子的名字" : "先选班级"}
              disabled={!gid}
              maxLength={20}
              style={{ ...controlStyle, background: gid ? "#fff" : C.soft }}
            />
            {sameGid.filter((p) => p.name !== name).length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {sameGid.filter((p) => p.name !== name).map((p) => (
                  <button
                    key={p.name}
                    onClick={() => {
                      setName(p.name);
                      setStudentSchool(p.school || "");
                    }}
                    style={{
                      background: name === p.name ? "#2a2218" : C.soft,
                      color: name === p.name ? C.cream : "#7a6a4a",
                      border: "1px solid " + (name === p.name ? C.dark : C.line),
                      borderRadius: 16,
                      padding: "6px 14px",
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: "inherit"
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {gid && name && !sid && (
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 7, lineHeight: 1.8 }}>
                这个名字是第一次填，会新建一条记录。以后在这台手机上再传，点上面那个名字就行。
              </div>
            )}
          </div>

          {/* 学校是学生属性，不是班级：一个班里有宝一中、新建路中学好几个学校。
              必填 —— 同一所学校的统一考试用同一份卷子，将来 AI 分析时能共用一套评分标准；
              少了这个字段，每份卷子都得从头建标准。 */}
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>孩子学校（必填）</div>
            <input
              list="xw-student-schools"
              value={studentSchool}
              onChange={(e) => setStudentSchool(e.target.value)}
              placeholder="比如：宝一中 / 新建路中学"
              maxLength={30}
              style={controlStyle}
            />
            <datalist id="xw-student-schools">
              {schoolOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div style={{ fontSize: 11.5, color: C.dim, marginTop: 7, lineHeight: 1.8 }}>
              填孩子现在读的学校就行，这台手机填过的会自动提示，点一下就好。
            </div>
          </div>

          {gid && (
            <Sel label="哪一场考试（必选）" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">请选择考试</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name + (e.date ? "（" + e.date + "）" : "")}
                </option>
              ))}
            </Sel>
          )}
          {gid && exams.length === 0 && (
            <div style={{ fontSize: 11.5, color: "#a03030", marginBottom: 12, lineHeight: 1.8 }}>
              这个班还没有考试可选。请联系彭老师先建班，或刷新页面重试。
            </div>
          )}

          {mine && mine.count > 0 && (
            <div style={{ background: "#f0f7ff", border: "1px solid #b8d8f0", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#2a5a80", lineHeight: 1.9, marginBottom: 12 }}>
              这个孩子已经传过 {mine.count} 份了（{mine.sheets.map((s) => s.examName || "未指定考试").join("、")}）。还有别的页没传的话，继续往下。
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>答题卡（照片或 PDF）</div>
            <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 8, lineHeight: 1.8 }}>
              先选你手上是哪一种，我告诉你怎么传最清楚：
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[
                ["download", "智学网能下载"],
                ["shot", "只能截图"],
                ["photo", "只有纸质卷"]
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSourceKind(k)}
                  style={{
                    flex: 1,
                    padding: "9px 2px",
                    fontSize: 11.5,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    borderRadius: 8,
                    border: "1px solid " + (sourceKind === k ? C.dark : C.line),
                    background: sourceKind === k ? C.dark : C.soft,
                    color: sourceKind === k ? C.cream : "#7a6a4a"
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {sourceKind && (
              <div style={{ background: sourceKind === "download" ? "#eaf5e8" : "#fdf3dc", border: "1px solid " + (sourceKind === "download" ? "#b8d8a8" : "#e8c870"), borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 11.5, color: sourceKind === "download" ? "#3a6a3a" : "#7a5a20", lineHeight: 1.9 }}>
                {sourceKind === "download" && <>在智学网点「下载原卷」，把文件传上来。有 PDF 就传 PDF，一页一份最好。</>}
                {sourceKind === "shot" && <>把原卷放大后<strong>一页一张截图</strong>，千万别整份缩到一屏——那样每页只剩两三百像素，看不出孩子错在哪一步。</>}
                {sourceKind === "photo" && <><strong>一张只拍一页。</strong>光线足、拍正、四个角都进画面，老师打的叉别挡住。六到八页就分六到八次传。</>}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => camRef.current?.click()}
                disabled={!!busy || shots.length >= MAX_SHOTS}
                style={{ flex: 1, background: C.accent, border: "none", color: "#3a2a10", borderRadius: 10, padding: "13px 0", fontSize: 14, fontWeight: 600, cursor: shots.length >= MAX_SHOTS || busy ? "not-allowed" : "pointer", opacity: shots.length >= MAX_SHOTS || busy ? 0.5 : 1, fontFamily: "inherit" }}
              >
                📷 拍照
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!!busy || shots.length >= MAX_SHOTS}
                style={{ flex: 1, background: C.soft, border: "1px solid " + C.line, color: "#5a4a30", borderRadius: 10, padding: "13px 0", fontSize: 14, cursor: shots.length >= MAX_SHOTS || busy ? "not-allowed" : "pointer", opacity: shots.length >= MAX_SHOTS || busy ? 0.5 : 1, fontFamily: "inherit" }}
              >
                🖼 相册 / 文件
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: "#b0a080", marginTop: 7, lineHeight: 1.8 }}>
              能下载原卷就传文件；只能看就一页一张截图；只有纸质卷就一张拍一页。按上面选的类型来，最省事也最清楚。
            </div>
            <input
              ref={camRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf,.pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {shots.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {shots.map((s, i) => (
                  <div key={i} style={{ position: "relative", width: 84 }}>
                    {s.kind === "pdf" ? (
                      <div
                        title={s.name}
                        style={{ width: 84, height: 108, borderRadius: 8, border: "1px solid #e0b0a0", background: "#fff5f0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}
                      >
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#b04a30", letterSpacing: 0.5 }}>PDF</div>
                        <div style={{ fontSize: 9.5, color: "#a07a6a", padding: "0 5px", textAlign: "center", lineHeight: 1.3, wordBreak: "break-all", maxHeight: 28, overflow: "hidden" }}>
                          {s.name}
                        </div>
                      </div>
                    ) : (
                      <img
                        src={s.preview}
                        alt={"答题卡第" + (i + 1) + "页"}
                        style={{ width: 84, height: 108, objectFit: "cover", borderRadius: 8, border: "1px solid " + C.line, display: "block", background: "#fff" }}
                      />
                    )}
                    <button
                      onClick={() => setShots((cur) => cur.filter((_, k) => k !== i))}
                      style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, background: "#a04040", border: "2px solid #fff", color: "#fff", fontSize: 11, lineHeight: "18px", padding: 0, cursor: "pointer" }}
                    >
                      ✕
                    </button>
                    <div style={{ fontSize: 10.5, color: s.strip ? "#b04a30" : C.dim, textAlign: "center", marginTop: 3 }}>
                      {s.strip ? "多页拼图" : Math.round(s.bytes / 1024) + " KB"}
                    </div>
                  </div>
                ))}
                {shots.length < MAX_SHOTS && (
                  <div style={{ width: 84, height: 108, borderRadius: 8, border: "1px dashed #c8b898", display: "flex", alignItems: "center", justifyContent: "center", color: "#b0a080", fontSize: 11 }}>
                    还能加{MAX_SHOTS - shots.length}份
                  </div>
                )}
              </div>
            )}

            {shots.some((s) => s.strip) && (
              <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 10, padding: "10px 14px", marginTop: 10, fontSize: 12.5, color: "#7a5a20", lineHeight: 1.9 }}>
                你选的这张是把好几页拼在一起的
                {(() => {
                  const s = shots.find((x) => x.strip);
                  return s?.srcW ? `（原图宽 ${s.srcW} 像素）` : "";
                })()}
                。按八页算，每页只剩两三百像素，手写的步骤会糊成一团，分析不出东西。
                <b>建议在智学网上点开原卷，双指放大，一页一页截图。</b>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>这次考了多少分（可不填）</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                value={score}
                onChange={(e) => setScore(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                maxLength={6}
                placeholder="比如 108"
                style={{ ...controlStyle, flex: 1, marginBottom: 0 }}
              />
              <span style={{ fontSize: 12, color: C.dim, flexShrink: 0 }}>分</span>
            </div>
            <div style={{ fontSize: 11.5, color: C.dim, marginTop: 7, lineHeight: 1.8 }}>
              卷子上写的总分。不知道就先空着，以后告诉我也能补。
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>想跟我说的话（可不填）</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="比如：第 22 题他说没做完"
              style={controlStyle}
            />
          </div>

          {err && (
            <div style={{ background: "#fde8e8", border: "1px solid #f0a0a0", borderRadius: 10, padding: "10px 14px", color: "#a03030", fontSize: 12.5, lineHeight: 1.8, marginBottom: 12 }}>⚠ {err}</div>
          )}

          <button
            onClick={submit}
            disabled={!!busy || shots.length === 0 || !name.trim() || !studentSchool.trim() || !examId}
            style={{
              width: "100%",
              background: shots.length === 0 || !name.trim() || !studentSchool.trim() || !examId ? "#d8ccb4" : C.dark,
              color: shots.length === 0 || !name.trim() || !studentSchool.trim() || !examId ? "#8a7a5a" : C.cream,
              border: "none",
              borderRadius: 12,
              padding: "15px 0",
              fontSize: 15,
              fontWeight: 700,
              cursor: shots.length === 0 || !name.trim() || !studentSchool.trim() || !examId || busy ? "not-allowed" : "pointer",
              fontFamily: "inherit"
            }}
          >
            {busy || "上传答题卡"}
          </button>

          <div style={{ fontSize: 11.5, color: "#b0a080", textAlign: "center", marginTop: 10, lineHeight: 1.8 }}>
            照片只用来看孩子的这份卷子，不外传
          </div>
        </>
      )}
    </div>
  );
}
