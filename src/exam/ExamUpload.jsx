// 答题卡上传（家长端入口）
//
// 这一版只做「收」，不做「判」。原因写在下面对家长的说明里，不藏着：
// 判断一份卷子的 3 分该不该丢，前提是老师先把这份卷子按难度分过类；
// 那个前提在期中之前不成立。但答题卡是过期就补不回来的东西，
// 所以先把原件收下来，分析能力后补。
//
// 几个刻意的选择：
//   1) 名字不让手打。手打会出现同音字、小名、错字，而 sid 是后面所有分析
//      的唯一挂钩，错一次就永久错。所以走「学校 → 班级 → 名单里点一个」。
//   2) 考试可以不选。老师还没建考试时家长照样能传，记成「未指定考试」，
//      等卷子结构有了再挂上去，不让流程堵在这一步。
//   3) 照片压到 ~50 万字符一张（2000px 长边、约 170dpi）。答题卡上的字
//      和红笔批改都要看得清，不能像作业检查那样压到 900px。
//   4) 记一台设备上次选的学生。一个家长通常只管一个孩子，
//      第二次再传不该从选学校重新点一遍。

import { useEffect, useRef, useState } from "react";

const C = {
  dark: "#2a2218",
  card: "#fff",
  soft: "#faf6ee",
  accent: "#e8a030",
  line: "#e8d0a0",
  dim: "#a08060",
  cream: "#f0e8d0"
};

// 这台设备上输过的孩子：[{gid, name, sid, at}]，最多存 10 条。
// 只存在家长自己的手机里，服务端不返回任何名单 —— 所以既要让老家长零打字，
// 又不能让任何人的名字被别人看见，只能靠这个。
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
    list.unshift({ gid: p.gid, name: p.name, sid: p.sid || "", at: Date.now() });
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
  const [gid, setGid] = useState("");
  const [sid, setSid] = useState("");
  const [name, setName] = useState("");
  const [people, setPeople] = useState([]);
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [shots, setShots] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
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

        const list = loadPeople();
        setPeople(list);
        if (list.length === 0) return;
        // 恢复最近一次用的班级和名字。班级可能已经被删了，先确认还在目录里。
        const gids = [];
        schools.forEach((s) => (s.groups || []).forEach((g) => gids.push(g.gid)));
        const last = list.find((p) => gids.includes(p.gid));
        if (!last) return;
        setGid(last.gid);
        setName(last.name);
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
        setExamId((cur) => (cur && openExams.some((e) => e.id === cur) ? cur : openExams[0]?.id || ""));
      } catch (_) {
        if (!alive) return;
        setExams([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gid]);

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

  const school = catalog?.find((s) => (s.groups || []).some((g) => g.gid === gid));
  const classList = school?.groups || [];
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
    if (!gid) return setErr("先选学校");
    if (!name.trim()) return setErr("先填孩子的姓名");
    if (shots.length === 0) return setErr("还没选答题卡");
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
        savePerson({ gid, name: d.studentName || name.trim(), sid: d.sid });
        setPeople(loadPeople());
      }
      setDone(d);
      setShots([]);
      setNote("");
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
            : "这次先收着。逐题分析要等卷子的难度分好类之后才能出，能出了我在群里说。"}
        </div>
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
          <Sel
            label="学校"
            value={school ? school.school : ""}
            onChange={(e) => {
              const s = catalog.find((x) => x.school === e.target.value);
              setGid(s?.groups?.[0]?.gid || "");
              setSid("");
              setName("");
            }}
          >
            <option value="">请选择</option>
            {catalog.map((s) => (
              <option key={s.school} value={s.school}>
                {s.school}
              </option>
            ))}
          </Sel>

          {school && classList.length > 1 && (
            <Sel
              label="班级"
              value={gid}
              onChange={(e) => {
                setGid(e.target.value);
                setSid("");
                setName("");
              }}
            >
              {classList.map((g) => (
                <option key={g.gid} value={g.gid}>
                  {(g.grade ? g.grade + " " : "") + (g.name || "未命名班级")}
                </option>
              ))}
            </Sel>
          )}

          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>孩子姓名</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s+/g, ""))}
              placeholder={gid ? "填孩子的名字，和学校里用的一致" : "先选学校"}
              disabled={!gid}
              maxLength={20}
              style={{ ...controlStyle, background: gid ? "#fff" : C.soft }}
            />
            {sameGid.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {sameGid.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => setName(p.name)}
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

          {exams.length > 1 && (
            <Sel label="哪一场考试" value={examId} onChange={(e) => setExamId(e.target.value)}>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name + (e.date ? "（" + e.date + "）" : "")}
                </option>
              ))}
            </Sel>
          )}

          {mine && mine.count > 0 && (
            <div style={{ background: "#f0f7ff", border: "1px solid #b8d8f0", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#2a5a80", lineHeight: 1.9, marginBottom: 12 }}>
              这个孩子已经传过 {mine.count} 份了（{mine.sheets.map((s) => s.examName || "未指定考试").join("、")}）。还有别的页没传的话，继续往下。
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>答题卡（照片或 PDF）</div>
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
              智学网里能点「下载原卷」的，传那份 PDF 比截图清楚；不能下载的就一页一页截图。
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
            disabled={!!busy || shots.length === 0 || !sid}
            style={{
              width: "100%",
              background: shots.length === 0 || !sid ? "#d8ccb4" : C.dark,
              color: shots.length === 0 || !sid ? "#8a7a5a" : C.cream,
              border: "none",
              borderRadius: 12,
              padding: "15px 0",
              fontSize: 15,
              fontWeight: 700,
              cursor: shots.length === 0 || !sid || busy ? "not-allowed" : "pointer",
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
