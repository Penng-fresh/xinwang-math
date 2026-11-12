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

const WHO_KEY = "xw_sheet_who";

// 单张图 base64 字符数上限。Vercel 函数请求体 4.5MB，三张 70 万字符约 2.1MB，
// 留足余量；同时 70 万字符（≈52 万字节）的 JPEG 存一份也不至于太贵。
const BUDGET = 700000;
const MAX_SHOTS = 3;

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
async function compressSheet(file) {
  const img = await readImage(file);
  const steps = [
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
    if (last.data.length <= BUDGET) return last;
  }
  if (!last || last.data.length > BUDGET * 1.7) {
    throw new Error("这张照片太大，压不到能上传的尺寸。换个角度重拍一次（别用截图，截图反而更大）");
  }
  return last;
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

export default function ExamUpload() {
  const [catalog, setCatalog] = useState(null); // null = 读取中
  const [gid, setGid] = useState("");
  const [sid, setSid] = useState("");
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [shots, setShots] = useState([]);
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

        let saved = null;
        try {
          saved = JSON.parse(localStorage.getItem(WHO_KEY) || "null");
        } catch (_) {
          saved = null;
        }
        if (!saved?.gid) return;
        // 上次的班级可能已经被删了，先确认它还在目录里，再恢复
        const alive_gids = [];
        schools.forEach((s) => (s.groups || []).forEach((g) => alive_gids.push(g.gid)));
        if (!alive_gids.includes(saved.gid)) return;
        setGid(saved.gid);
        if (saved.sid) setSid(saved.sid);
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

  // ── 选了班级：读名单 + 这个班开放中的考试 ──
  useEffect(() => {
    if (!gid) {
      setStudents([]);
      setExams([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const [r1, r2] = await Promise.all([
          fetch("/api/roster?view=pick&gid=" + encodeURIComponent(gid)),
          fetch("/api/exams?view=open&gid=" + encodeURIComponent(gid))
        ]);
        const d1 = await r1.json().catch(() => ({}));
        const d2 = await r2.json().catch(() => ({}));
        if (!alive) return;
        const list = Array.isArray(d1.students) ? d1.students : [];
        setStudents(list);
        setSid((cur) => (cur && list.some((s) => s.sid === cur) ? cur : ""));
        const openExams = Array.isArray(d2.exams) ? d2.exams : [];
        setExams(openExams);
        setExamId((cur) => (cur && openExams.some((e) => e.id === cur) ? cur : openExams[0]?.id || ""));
      } catch (_) {
        if (!alive) return;
        setStudents([]);
        setExams([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gid]);

  // ── 记住这次选的学生 ──
  useEffect(() => {
    if (!gid || !sid) return;
    try {
      localStorage.setItem(WHO_KEY, JSON.stringify({ gid, sid }));
    } catch (_) {}
  }, [gid, sid]);

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

  const addFiles = async (files) => {
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    setErr("");
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) {
      setErr(`最多传 ${MAX_SHOTS} 张。答题卡有几页就传几张。`);
      return;
    }
    const take = arr.slice(0, room);
    const next = [];
    try {
      for (let i = 0; i < take.length; i++) {
        setBusy(`正在处理第 ${i + 1} 张（共 ${take.length} 张）…`);
        next.push(await compressSheet(take[i]));
      }
      setShots((cur) => [...cur, ...next].slice(0, MAX_SHOTS));
    } catch (e) {
      setErr(e.message || "图片处理失败");
    } finally {
      setBusy("");
    }
  };

  const submit = async () => {
    setErr("");
    if (!gid) return setErr("先选学校");
    if (!sid) return setErr("先选孩子的名字");
    if (shots.length === 0) return setErr("还没选答题卡照片");
    setBusy("正在上传…");
    try {
      const r = await fetch("/api/answer-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gid,
          sid,
          examId: examId || "",
          note,
          images: shots.map((s) => ({ data: s.data, mediaType: "image/jpeg" }))
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d?.error || r.statusText);
      setDone(d);
      setShots([]);
      setNote("");
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
          {done.examName ? " · " + done.examName : " · 未指定考试"} · {done.imageCount} 张
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.9, marginTop: 12 }}>
          这次先收着。逐题分析要等卷子的难度分好类之后才能出，能出了我在群里说。
        </div>
        <button
          onClick={() => setDone(null)}
          style={{ marginTop: 18, background: "transparent", border: "1px solid " + C.line, color: "#7a6a4a", borderRadius: 20, padding: "9px 22px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
        >
          还有一页要传
        </button>
      </div>
    );
  }

  // ══════════ 表单 ══════════
  const loading = catalog === null;

  return (
    <div style={{ background: C.card, borderRadius: 14, border: "1px solid " + C.line, padding: "18px 16px" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.dark, marginBottom: 4 }}>把答题卡传上来</div>
      <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.9, marginBottom: 16 }}>
        整张平放拍，字和红笔批改要看得清。答题卡有两页就传两张。
      </div>

      {loading && <div style={{ fontSize: 13, color: C.dim, padding: "10px 0" }}>正在读取班级名单…</div>}

      {!loading && catalog.length === 0 && (
        <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#7a5a20", lineHeight: 1.9 }}>
          {loadErr ? "名单读取失败：" + loadErr : "班级名单还没建好，暂时没法选名字。先联系我。"}
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
              }}
            >
              {classList.map((g) => (
                <option key={g.gid} value={g.gid}>
                  {(g.grade ? g.grade + " " : "") + (g.name || "未命名班级")}
                </option>
              ))}
            </Sel>
          )}

          <Sel label="孩子姓名" value={sid} onChange={(e) => setSid(e.target.value)} disabled={students.length === 0}>
            <option value="">{!gid ? "先选学校" : students.length === 0 ? "这个班还没有名单" : "请选择"}</option>
            {students.map((s) => (
              <option key={s.sid} value={s.sid}>
                {s.name}
              </option>
            ))}
          </Sel>

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
            <div style={labelStyle}>答题卡照片</div>
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
                🖼 从相册选
              </button>
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
              accept="image/*"
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
                    <img
                      src={s.preview}
                      alt={"答题卡第" + (i + 1) + "张"}
                      style={{ width: 84, height: 108, objectFit: "cover", borderRadius: 8, border: "1px solid " + C.line, display: "block", background: "#fff" }}
                    />
                    <button
                      onClick={() => setShots((cur) => cur.filter((_, k) => k !== i))}
                      style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, background: "#a04040", border: "2px solid #fff", color: "#fff", fontSize: 11, lineHeight: "18px", padding: 0, cursor: "pointer" }}
                    >
                      ✕
                    </button>
                    <div style={{ fontSize: 10.5, color: C.dim, textAlign: "center", marginTop: 3 }}>{Math.round(s.bytes / 1024)} KB</div>
                  </div>
                ))}
                {shots.length < MAX_SHOTS && (
                  <div style={{ width: 84, height: 108, borderRadius: 8, border: "1px dashed #c8b898", display: "flex", alignItems: "center", justifyContent: "center", color: "#b0a080", fontSize: 11 }}>
                    还能加{MAX_SHOTS - shots.length}张
                  </div>
                )}
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
