import { useState, useRef, useEffect } from "react";

// ── 题型配置 ──────────────────────────────────────
const PROBLEM_TYPES = {
  "一元一次方程":   { steps: ["去分母","去括号","移项","合并同类项","系数化为1"], color: "#4080e0" },
  "一元二次方程":   { steps: ["整理标准形式","选择解法","求解","检验"], color: "#e04060" },
  "二元一次方程组": { steps: ["标注方程","消元","求解","代入验证"], color: "#c04080" },
  "因式分解":       { steps: ["提公因式","套用公式/十字相乘","验证"], color: "#c8860a" },
  "整式运算":       { steps: ["去括号","套乘法公式","合并同类项"], color: "#e08020" },
  "分式化简":       { steps: ["分解分子","分解分母","约分"], color: "#40a860" },
  "分式方程":       { steps: ["找最简公分母","去分母","解方程","验根"], color: "#9040c8" },
  "不等式":         { steps: ["去分母/去括号","移项","合并","系数化为1","数轴表示"], color: "#20a0c0" },
  "根式化简":       { steps: ["提完全平方数","化简","有理化分母"], color: "#60a030" },
  "实数运算":       { steps: ["处理绝对值/乘方/开方","按顺序计算"], color: "#8060c0" },
  "其他计算题":     { steps: [], color: "#8a7a5a" }
};

const ISSUE_COLORS = {
  "移项符号错误": "#ff4d6d",
  "跳步": "#ff9a3c",
  "计算错误": "#c77dff",
  "去括号错误": "#e05080",
  "漏提公因式": "#ff6b35",
  "分解不彻底": "#e8a030",
  "漏验根": "#9040c8",
  "约分错误": "#40a860",
  "漏解": "#e04060",
  "符号错误": "#ff4d6d",
  "乘法公式错误": "#c8860a",
  "不等号方向错误": "#20a0c0",
  "漏验证": "#c04080",
  "去分母漏乘": "#ff6b35",
  "增根未舍去": "#9040c8",
  "约项错误": "#e05080",
  "运算顺序错误": "#8060c0",
  "绝对值错误": "#8060c0",
  "负数乘方错误": "#8060c0",
};
const ISSUE_ICONS = {
  "移项符号错误": "±", "跳步": "⤵", "计算错误": "✗", "去括号错误": "()",
  "漏提公因式": "∑", "分解不彻底": "◑", "漏验根": "✓?", "约分错误": "÷",
  "漏解": "②", "符号错误": "±", "乘法公式错误": "□", "不等号方向错误": "≷",
  "漏验证": "?", "去分母漏乘": "×", "增根未舍去": "⊗", "约项错误": "÷",
  "运算顺序错误": "①", "绝对值错误": "|x|", "负数乘方错误": "²",
};
const issueColor = (t) => ISSUE_COLORS[t] || "#74c0fc";
const issueIcon  = (t) => ISSUE_ICONS[t]  || "!";

// ── 系统提示词 ────────────────────────────────────
const SYSTEM_PROMPT = `你是一位严格但耐心的初中数学老师，能检查所有类型计算题的解题过程。

【重要：识别图片中所有题目】
图片中可能有多道题，必须逐一识别并批改每一道，不能遗漏。按题目在图片中出现的顺序编号。

【识别文字的注意事项】
- 严格按照图片中实际写的字母转录，不要臆造不存在的字母
- 常见字母：x、y、a、b、n、m等，务必仔细辨认，不要将x看成n或其他字母
- 数字和字母要仔细区分，如1和l、0和O

【先判断每道题的题型】
一元一次方程、一元二次方程、二元一次方程组、因式分解、整式运算、分式化简、分式方程、不等式、根式化简、实数运算、其他计算题

【错误检查原则：发现根本性错误立即停止】
如果某道题第一步就出现根本性错误（如移项未变号、去括号符号完全错误、公式套错），则：
- 只在issues中报告该错误
- summary说明"第X行存在根本性错误，后续步骤均受影响，建议先纠正此处再继续"
- 不再逐行列出后续所有错误（后续错误都是连锁反应，无意义）
- score给予较低分数反映问题严重性

【各题型重点检查】
一元一次方程：跳步（去分母和去括号合并），去括号符号（用乘法分配律解释，如-3×(+2)=-6），移项变号
一元二次方程：漏解，判别式计算，配方/公式/因式分解符号处理
二元一次方程组：消元计算，漏代入验证，加减法每项变号
因式分解：漏提公因式，公式套用，分解不彻底
整式运算：乘法公式漏项（尤其2ab），去括号负号，指数运算
分式化简：约项错误（只能约因式），漏写分母不为零条件
分式方程：去分母漏乘，漏验根，增根未舍去
不等式：乘除负数不变号（最常见），数轴端点虚实
根式化简：提取不彻底，有理化错误，不能拆加减根式
实数运算：绝对值符号，负数乘方括号位置，运算顺序

只返回JSON，所有字段值不得含换行符，issues为空时写[]：
{"problems":[{"problem_number":1,"problem_type":"题型","transcription":["第1行","第2行"],"overall":"正确","score":90,"steps_detected":["步骤"],"skipped_steps":[],"issues":[{"line":1,"type":"错误类型","content":"该行内容","description":"含原理的错误说明","suggestion":"正确写法"}],"praise":"鼓励","summary":"总体评价"},{"problem_number":2,"problem_type":"题型","transcription":["第1行"],"overall":"正确","score":95,"steps_detected":[],"skipped_steps":[],"issues":[],"praise":"","summary":"总体评价"}]}`;


// ── 存储层（部署版用 localStorage，可替换为后端API）──────
const storage = {
  get: async (key) => {
    try { const v = localStorage.getItem(key); return v ? { value: v } : null; } catch { return null; }
  },
  set: async (key, value) => {
    try { localStorage.setItem(key, value); return { value }; } catch { return null; }
  },
  delete: async (key) => {
    try { localStorage.removeItem(key); return { deleted: true }; } catch { return null; }
  }
};

// ── 图片压缩 ──────────────────────────────────────
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("图片解析失败"));
      img.onload = () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        cv.toBlob((blob) => {
          if (!blob) return reject(new Error("压缩失败"));
          const r2 = new FileReader();
          r2.onload = (e2) => {
            const full = e2.target.result;
            resolve({ data: full.split(",")[1], mediaType: "image/jpeg", preview: full });
          };
          r2.onerror = () => reject(new Error("读取压缩图失败"));
          r2.readAsDataURL(blob);
        }, "image/jpeg", 0.85);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── JSON 解析（三级容错）────────────────────────────
function parseResult(raw) {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("未找到JSON内容");
  const js = raw.slice(s, e + 1);

  // 级别1：只修复控制字符
  try {
    const f1 = js.replace(/[\x00-\x1F\x7F]/g, (c) => {
      if (c === "\n") return "\\n";
      if (c === "\r") return "\\r";
      if (c === "\t") return "\\t";
      return "";
    });
    return JSON.parse(f1);
  } catch (_) {}

  // 级别2：逐字符修复非法引号和控制字符
  try {
    let out = "", inStr = false, esc = false;
    for (let i = 0; i < js.length; i++) {
      const c = js[i], code = c.charCodeAt(0);
      if (esc) { out += c; esc = false; continue; }
      if (c === "\\" && inStr) { esc = true; out += c; continue; }
      if (c === '"') {
        if (!inStr) { inStr = true; out += c; continue; }
        let j = i + 1;
        while (j < js.length && " \t\n\r".includes(js[j])) j++;
        const nx = js[j];
        if (nx === ":" || nx === "," || nx === "}" || nx === "]" || j >= js.length) {
          inStr = false; out += c;
        } else {
          out += '\\"';
        }
        continue;
      }
      if (inStr && code < 32) {
        if (code === 10) { out += "\\n"; continue; }
        if (code === 13) { out += "\\r"; continue; }
        if (code === 9)  { out += "\\t"; continue; }
        continue;
      }
      out += c;
    }
    return JSON.parse(out);
  } catch (_) {}

  // 级别3：逐字段正则提取
  const gStr = (key) => {
    const m = raw.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    return m ? m[1] : "";
  };
  const gNum = (key) => {
    const m = raw.match(new RegExp('"' + key + '"\\s*:\\s*(\\d+)'));
    return m ? parseInt(m[1]) : 0;
  };
  const gArr = (key) => {
    const m = raw.match(new RegExp('"' + key + '"\\s*:\\s*\\[([\\s\\S]*?)\\]'));
    if (!m) return [];
    const items = [], re = /"((?:[^"\\\\]|\\\\.)*)"/g;
    let hit;
    while ((hit = re.exec(m[1])) !== null) items.push(hit[1]);
    return items;
  };
  const gIssues = () => {
    const m = raw.match(/"issues"\s*:\s*\[([\s\S]*?)\](?=\s*[,}])/);
    if (!m || !m[1].trim()) return [];
    const issues = [];
    m[1].split(/}\s*,\s*{/).forEach((block) => {
      const gF = (f) => {
        const fm = block.match(new RegExp('"' + f + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
        return fm ? fm[1] : "";
      };
      const gN = (f) => {
        const fm = block.match(new RegExp('"' + f + '"\\s*:\\s*(\\d+)'));
        return fm ? parseInt(fm[1]) : 0;
      };
      const type = gF("type"), desc = gF("description");
      if (type || desc) {
        issues.push({ line: gN("line"), type, content: gF("content"), description: desc, suggestion: gF("suggestion") });
      }
    });
    return issues;
  };

  const result = {
    problem_type: gStr("problem_type"),
    transcription: gArr("transcription"),
    overall: gStr("overall") || "有问题",
    score: gNum("score"),
    steps_detected: gArr("steps_detected"),
    skipped_steps: gArr("skipped_steps"),
    issues: gIssues(),
    praise: gStr("praise"),
    summary: gStr("summary") || "解析完成，部分内容可能有所缺失。"
  };
  if (result.problem_type || result.transcription.length > 0 || result.issues.length > 0) return [result];
  throw new Error("无法解析AI返回内容，请重试");
}

// 解析多题结果（顶层包含 problems 数组）
function parseMultiResult(raw) {
  // 先尝试解析出 problems 数组
  let parsed;
  try { parsed = parseResult(raw); } catch(e) { throw e; }

  // 如果解析结果本身有 problems 字段
  if (parsed && parsed.problems && Array.isArray(parsed.problems)) {
    return parsed.problems;
  }
  // 如果解析结果是数组
  if (Array.isArray(parsed)) return parsed;
  // 单题结果包装成数组
  return [parsed];
}

// ── 格式化时间 ────────────────────────────────────
function fmtTime(ts) {
  const d = new Date(ts);
  return (d.getMonth()+1) + "/" + d.getDate() + " " +
    String(d.getHours()).padStart(2,"0") + ":" +
    String(d.getMinutes()).padStart(2,"0");
}

// ── 结果展示组件 ──────────────────────────────────
function ResultPanel({ result }) {
  const typeInfo = PROBLEM_TYPES[result.problem_type] || PROBLEM_TYPES["其他计算题"];
  const stepsToShow = typeInfo.steps.length > 0 ? typeInfo.steps : ["解题步骤"];

  return (
    <div>
      {result.problem_type && (
        <div style={{display:"inline-flex",alignItems:"center",gap:6,background:typeInfo.color+"18",border:"1px solid "+typeInfo.color+"40",borderRadius:20,padding:"4px 12px",marginBottom:12}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:typeInfo.color}}/>
          <span style={{fontSize:12,color:typeInfo.color,fontWeight:600}}>{result.problem_type}</span>
        </div>
      )}

      <div style={{background:result.overall==="正确"?"#e8f5e8":"#fdf0e0",border:"2px solid "+(result.overall==="正确"?"#60c060":"#e8a030"),borderRadius:14,padding:"18px 20px",display:"flex",alignItems:"center",gap:18,marginBottom:14}}>
        <div style={{fontSize:52,fontWeight:800,lineHeight:1,color:result.overall==="正确"?"#3a8a3a":"#c06020",fontFamily:"monospace"}}>{result.score}</div>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:result.overall==="正确"?"#3a8a3a":"#c06020",marginBottom:4}}>
            {result.overall==="正确" ? "✓ 解题过程规范" : "✗ 发现 "+(result.issues?.length||0)+" 处问题"}
          </div>
          <div style={{fontSize:13,color:"#5a4a30",lineHeight:1.7}}>{result.summary}</div>
        </div>
      </div>

      {result.transcription && result.transcription.length > 0 && (
        <div style={{background:"#faf6ee",border:"1px solid #d8c8a0",borderRadius:12,padding:"14px 18px",marginBottom:12}}>
          <div style={{fontSize:10,letterSpacing:3,color:"#8a7a5a",marginBottom:10}}>识别内容</div>
          {result.transcription.map((line, i) => {
            const issue = result.issues && result.issues.find(x => x.line === i+1);
            return (
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 8px",borderRadius:6,marginBottom:3,background:issue ? issueColor(issue.type)+"18" : "transparent",borderLeft:"3px solid "+(issue ? issueColor(issue.type) : "transparent")}}>
                <span style={{fontSize:10,color:"#a08060",fontFamily:"monospace",minWidth:18,paddingTop:2}}>{i+1}</span>
                <span style={{fontSize:14,fontFamily:"monospace",flex:1}}>{line}</span>
                {issue && <span style={{fontSize:10,background:issueColor(issue.type),color:"#fff",padding:"2px 7px",borderRadius:10,whiteSpace:"nowrap"}}>{issueIcon(issue.type)} {issue.type}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div style={{background:"#faf6ee",border:"1px solid #d8c8a0",borderRadius:12,padding:"14px 18px",marginBottom:12}}>
        <div style={{fontSize:10,letterSpacing:3,color:"#8a7a5a",marginBottom:10}}>步骤完整性</div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {stepsToShow.map((step, i) => {
            const detected = result.steps_detected && result.steps_detected.some(s => s.includes(step));
            const skipped  = result.skipped_steps  && result.skipped_steps.some(s => s.includes(step));
            return (
              <div key={i} style={{padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:skipped?"#ffe0e0":detected?"#e0f5e0":"#f0ebe0",color:skipped?"#c03030":detected?"#3a8a3a":"#8a7a5a",border:"1px solid "+(skipped?"#f0a0a0":detected?"#80c080":"#c8b898")}}>
                {skipped ? "✗" : detected ? "✓" : "—"} {step}
              </div>
            );
          })}
        </div>
      </div>

      {result.issues && result.issues.length > 0 && (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,letterSpacing:3,color:"#8a7a5a",marginBottom:10}}>错误详情</div>
          {result.issues.map((issue, i) => (
            <div key={i} style={{background:"#fff",borderRadius:12,padding:"14px 16px",marginBottom:8,border:"1px solid "+issueColor(issue.type)+"40",borderLeft:"4px solid "+issueColor(issue.type),boxShadow:"0 2px 6px rgba(0,0,0,0.05)"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{background:issueColor(issue.type),color:"#fff",padding:"3px 10px",borderRadius:12,fontSize:11,fontWeight:700}}>{issueIcon(issue.type)} {issue.type}</span>
                <span style={{color:"#a08060",fontSize:11}}>第 {issue.line} 行</span>
              </div>
              {issue.content && <div style={{background:"#f5f0e8",borderRadius:7,padding:"7px 10px",fontFamily:"monospace",fontSize:14,color:"#3a2a10",marginBottom:8,border:"1px solid #e0d0b0"}}>{issue.content}</div>}
              <div style={{fontSize:13,color:"#4a3a20",marginBottom:6,lineHeight:1.7}}>{issue.description}</div>
              {issue.suggestion && <div style={{fontSize:12,color:"#3a7a3a",fontWeight:600,fontFamily:"monospace",background:"#eaf5ea",padding:"6px 10px",borderRadius:6}}>✓ {issue.suggestion}</div>}
            </div>
          ))}
        </div>
      )}

      {result.praise && (
        <div style={{background:"#e8f5e8",border:"1px solid #a0d0a0",borderRadius:12,padding:"12px 16px",fontSize:13,color:"#3a6a3a",lineHeight:1.7}}>
          💬 {result.praise}
        </div>
      )}
    </div>
  );
}

// ── 家长端 ────────────────────────────────────────
function ParentView() {
  const [image, setImage]           = useState(null);
  const [preview, setPreview]       = useState(null);
  const [studentName, setStudentName] = useState("");
  const [result, setResult]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError]           = useState("");
  const [saved, setSaved]           = useState(false);
  const [dragOver, setDragOver]     = useState(false);
  const fileRef = useRef(null);
  const camRef  = useRef(null);

  const msgs = ["正在识别手写内容...","逐行分析解题步骤...","检查符号处理...","核查跳步情况...","生成批改报告..."];

  const processFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) { setError("请上传图片文件"); return; }
    setError("正在压缩图片...");
    try {
      const c = await compressImage(file);
      setImage({ data: c.data, mediaType: c.mediaType });
      setPreview(c.preview);
      setResult(null); setSaved(false); setError("");
    } catch (e) { setError("图片处理失败：" + e.message); }
  };

  const handleCheck = async () => {
    if (!image) { setError("请先上传照片"); return; }
    setError(""); setLoading(true); setResult(null); setSaved(false);
    let idx = 0; setLoadingMsg(msgs[0]);
    const timer = setInterval(() => { idx = (idx+1) % msgs.length; setLoadingMsg(msgs[idx]); }, 1800);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text",  text: "请识别图片中学生的计算题解题过程，判断题型，检查错误，只返回JSON。" }
          ]}]
        })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const msg = JSON.stringify(d);
        if (res.status === 429 || msg.includes("exceeded_limit")) {
          throw new Error("当前使用量已达上限，请等约5小时后重试（正式部署后用独立Key将不受此限制）");
        }
        throw new Error("API错误 " + res.status + ": " + (d?.error?.message || res.statusText));
      }
      const data = await res.json();
      const text = (data.content || []).map(i => i.text || "").join("");
      const problems = parseMultiResult(text);
      setResult(problems);
      await saveSubmission(problems);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  };

  const saveSubmission = async (problems) => {
    try {
      const id = Date.now().toString();
      const totalIssues = problems.reduce((n, p) => n + (p.issues || []).length, 0);
      const avgScore = Math.round(problems.reduce((n, p) => n + (p.score || 0), 0) / problems.length);
      const hasError = problems.some(p => p.overall !== "正确");
      const types = problems.map(p => p.problem_type).filter(Boolean).join("、");
      const submission = {
        id, timestamp: Date.now(),
        studentName: studentName.trim() || "未填写姓名",
        score: avgScore,
        overall: hasError ? "有问题" : "正确",
        issueCount: totalIssues,
        problemCount: problems.length,
        problemTypes: types,
        problems, thumbnail: preview,
      };
      let list = [];
      try { const ex = await storage.get("submissions_index"); if (ex) list = JSON.parse(ex.value); } catch (_) {}
      list.unshift({ id, timestamp: submission.timestamp, studentName: submission.studentName, score: submission.score, overall: submission.overall, issueCount: submission.issueCount, problemCount: submission.problemCount, problemTypes: submission.problemTypes });
      if (list.length > 50) list = list.slice(0, 50);
      await storage.set("submissions_index", JSON.stringify(list));
      await storage.set("submission_" + id, JSON.stringify(submission));
    } catch (_) {}
  };

  const reset = () => { setPreview(null); setImage(null); setResult(null); setSaved(false); setError(""); };

  const typeColor = result && result.problem_type ? (PROBLEM_TYPES[result.problem_type] || PROBLEM_TYPES["其他计算题"]).color : "#8a7a5a";

  return (
    <div>
      {!preview ? (
        <div
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current && fileRef.current.click()}
          style={{border:"2px dashed "+(dragOver?"#e8a030":"#c8b898"),borderRadius:16,background:dragOver?"#fdf5e0":"#faf6ee",padding:"40px 20px",textAlign:"center",cursor:"pointer",marginBottom:16}}
        >
          <div style={{fontSize:48,marginBottom:12}}>📷</div>
          <div style={{fontSize:17,fontWeight:600,color:"#4a3a20",marginBottom:6}}>拍照上传作业</div>
          <div style={{fontSize:13,color:"#8a7a5a",marginBottom:20}}>支持拖拽、点击选择、或直接拍照</div>
          <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={(e) => { e.stopPropagation(); fileRef.current && fileRef.current.click(); }} style={{background:"#2a2218",color:"#f0e8d0",border:"none",borderRadius:10,padding:"11px 22px",fontSize:14,cursor:"pointer",fontWeight:600}}>📁 选择图片</button>
            <button onClick={(e) => { e.stopPropagation(); camRef.current && camRef.current.click(); }} style={{background:"#e8a030",color:"#fff",border:"none",borderRadius:10,padding:"11px 22px",fontSize:14,cursor:"pointer",fontWeight:600}}>📸 直接拍照</button>
          </div>
        </div>
      ) : (
        <div style={{marginBottom:14}}>
          <div style={{borderRadius:14,overflow:"hidden",border:"2px solid #d8c8a0",position:"relative",background:"#2a2218",marginBottom:10}}>
            <img src={preview} alt="作业" style={{width:"100%",display:"block",maxHeight:340,objectFit:"contain"}} />
            <button onClick={reset} style={{position:"absolute",top:10,right:10,background:"rgba(0,0,0,0.6)",color:"#fff",border:"none",borderRadius:20,padding:"5px 12px",fontSize:12,cursor:"pointer"}}>重新上传</button>
          </div>
          <input value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="请输入学生姓名（可选）"
            style={{width:"100%",background:"#faf6ee",border:"1px solid #d8c8a0",borderRadius:10,padding:"10px 14px",fontSize:14,color:"#2a2218",outline:"none",boxSizing:"border-box"}} />
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={(e) => { if (e.target.files && e.target.files[0]) processFile(e.target.files[0]); }} />
      <input ref={camRef}  type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={(e) => { if (e.target.files && e.target.files[0]) processFile(e.target.files[0]); }} />

      {error && <div style={{background:"#fde8e8",border:"1px solid #f0a0a0",borderRadius:10,padding:"10px 14px",color:"#a03030",fontSize:13,marginBottom:12,lineHeight:1.6}}>{error}</div>}

      {preview && !loading && !result && (
        <button onClick={handleCheck} style={{width:"100%",background:"linear-gradient(135deg,#2a2218,#4a3a20)",color:"#f0e8d0",border:"none",borderRadius:12,padding:16,fontSize:16,fontWeight:700,cursor:"pointer",letterSpacing:2,marginBottom:12}}>
          开始批改 →
        </button>
      )}

      {loading && (
        <div style={{background:"#2a2218",borderRadius:14,padding:24,textAlign:"center",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:14}}>
            {["#e8a030","#e06040","#c040a0","#4080e0","#40b060"].map((c,i) => (
              <div key={i} style={{width:9,height:9,borderRadius:"50%",background:c,animation:"bounce 1.2s ease-in-out "+(i*0.15)+"s infinite"}} />
            ))}
          </div>
          <div style={{color:"#d0c0a0",fontSize:14,fontWeight:500}}>{loadingMsg}</div>
          <div style={{color:"#6a5a40",fontSize:11,marginTop:6}}>AI 正在识别并批改，请稍候...</div>
        </div>
      )}

      {result && Array.isArray(result) && (
        <div>
          {saved && <div style={{background:"#e8f0ff",border:"1px solid #a0b8f0",borderRadius:10,padding:"8px 14px",fontSize:12,color:"#3a5aa0",marginBottom:12}}>✓ 已同步至教师后台</div>}

          {/* 多题汇总栏 */}
          {result.length > 1 && (
            <div style={{background:"#2a2218",borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
              <div style={{color:"#f0e8d0",fontSize:14,fontWeight:600}}>共识别 {result.length} 道题</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {result.map((p, i) => {
                  const tc = (PROBLEM_TYPES[p.problem_type] || PROBLEM_TYPES["其他计算题"]).color;
                  return (
                    <div key={i} style={{background:tc+"22",border:"1px solid "+tc+"50",borderRadius:16,padding:"3px 10px",fontSize:11,color:tc,fontWeight:600}}>
                      第{i+1}题 {p.problem_type || "计算题"}
                      {p.issues && p.issues.length > 0
                        ? <span style={{marginLeft:5,color:"#ff9a3c"}}>{"×"+p.issues.length}</span>
                        : <span style={{marginLeft:5,color:"#60c060"}}>✓</span>
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 逐题展示 */}
          {result.map((problem, idx) => (
            <div key={idx} style={{marginBottom:20}}>
              {result.length > 1 && (
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:"#2a2218",display:"flex",alignItems:"center",justifyContent:"center",color:"#f0e8d0",fontSize:13,fontWeight:700,flexShrink:0}}>
                    {idx+1}
                  </div>
                  <div style={{height:"0.5px",flex:1,background:"#e0d0b0"}}/>
                </div>
              )}
              <ResultPanel result={problem} />
            </div>
          ))}

          <button onClick={reset} style={{width:"100%",marginTop:8,background:"transparent",color:"#6a5a40",border:"1px solid #c8b898",borderRadius:10,padding:12,fontSize:14,cursor:"pointer"}}>
            检查下一份作业
          </button>
        </div>
      )}
    </div>
  );
}

// ── 教师后台 ──────────────────────────────────────
const TEACHER_PASSWORD = "teacher2024";

function TeacherView({ onLogout }) {
  const [list, setList]               = useState([]);
  const [selected, setSelected]       = useState(null);
  const [detail, setDetail]           = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => { loadList(); }, []);

  const loadList = async () => {
    try {
      const r = await storage.get("submissions_index");
      if (r) setList(JSON.parse(r.value));
    } catch (_) { setList([]); }
  };

  const loadDetail = async (id) => {
    if (selected === id) { setSelected(null); setDetail(null); return; }
    setSelected(id); setLoadingDetail(true); setDetail(null);
    try {
      const r = await storage.get("submission_" + id);
      if (r) setDetail(JSON.parse(r.value));
    } catch (_) {}
    setLoadingDetail(false);
  };

  const deleteItem = async (id, e) => {
    e.stopPropagation();
    if (!confirm("确认删除？")) return;
    try {
      await storage.delete("submission_" + id);
      const newList = list.filter(x => x.id !== id);
      await storage.set("submissions_index", JSON.stringify(newList));
      setList(newList);
      if (selected === id) { setSelected(null); setDetail(null); }
    } catch (_) {}
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div>
          <div style={{fontSize:11,letterSpacing:3,color:"#8a7a5a"}}>TEACHER DASHBOARD</div>
          <div style={{fontSize:18,fontWeight:700,color:"#2a2218"}}>学生提交记录</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={loadList} style={{background:"#f0ebe0",border:"1px solid #c8b898",borderRadius:8,padding:"7px 14px",fontSize:13,cursor:"pointer",color:"#4a3a20"}}>🔄 刷新</button>
          <button onClick={onLogout} style={{background:"transparent",border:"1px solid #c8b898",borderRadius:8,padding:"7px 14px",fontSize:13,cursor:"pointer",color:"#8a7a5a"}}>退出</button>
        </div>
      </div>

      {list.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#8a7a5a",background:"#faf6ee",borderRadius:14,border:"1px dashed #c8b898"}}>
          <div style={{fontSize:36,marginBottom:10}}>📭</div>
          <div style={{fontSize:14}}>暂无提交记录</div>
          <div style={{fontSize:12,marginTop:6}}>家长端上传批改后，记录将自动出现在这里</div>
        </div>
      ) : list.map(item => {
        const tc = (PROBLEM_TYPES[item.problemType] || PROBLEM_TYPES["其他计算题"]).color;
        return (
          <div key={item.id}>
            <div onClick={() => loadDetail(item.id)} style={{background:selected===item.id?"#fff8ee":"#fff",border:"1px solid "+(selected===item.id?"#e8a030":"#e0d0b0"),borderRadius:12,padding:"12px 16px",marginBottom:6,cursor:"pointer",display:"flex",alignItems:"center",gap:12,transition:"all 0.15s"}}>
              <div style={{width:36,height:36,borderRadius:8,background:item.overall==="正确"?"#e0f5e0":"#ffe8e0",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:item.overall==="正确"?"#3a8a3a":"#c06020",flexShrink:0}}>
                {item.score}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span style={{fontWeight:600,fontSize:14,color:"#2a2218"}}>{item.studentName}</span>
                  {item.problemCount > 1 && <span style={{background:"#f0e8d0",color:"#8a6a30",fontSize:10,padding:"1px 7px",borderRadius:10}}>{item.problemCount}道题</span>}
                  {item.problemTypes && <span style={{background:tc+"18",color:tc,fontSize:10,padding:"1px 7px",borderRadius:10,border:"1px solid "+tc+"40",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.problemTypes}</span>}
                  {item.issueCount > 0
                    ? <span style={{background:"#ff4d6d",color:"#fff",fontSize:10,padding:"1px 7px",borderRadius:10}}>{item.issueCount}处错误</span>
                    : <span style={{background:"#60c060",color:"#fff",fontSize:10,padding:"1px 7px",borderRadius:10}}>无误</span>
                  }
                </div>
                <div style={{fontSize:11,color:"#a08060",marginTop:2}}>{fmtTime(item.timestamp)}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={(e) => deleteItem(item.id, e)} style={{background:"#fde8e8",border:"none",borderRadius:6,padding:"4px 8px",fontSize:11,color:"#c03030",cursor:"pointer"}}>删除</button>
                <span style={{color:"#c8b898",fontSize:14}}>{selected===item.id?"▲":"▼"}</span>
              </div>
            </div>
            {selected === item.id && (
              <div style={{margin:"-2px 8px 8px",background:"#fffdf8",border:"1px solid #e8d0a0",borderTop:"none",borderRadius:"0 0 12px 12px",padding:16}}>
                {loadingDetail && <div style={{textAlign:"center",padding:20,color:"#8a7a5a",fontSize:13}}>加载中...</div>}
                {detail && (
                  <div>
                    {detail.thumbnail && (
                      <div style={{marginBottom:14}}>
                        <div style={{fontSize:10,letterSpacing:3,color:"#8a7a5a",marginBottom:8}}>提交照片</div>
                        <img src={detail.thumbnail} alt="作业照片" style={{maxWidth:"100%",borderRadius:8,border:"1px solid #d8c8a0",maxHeight:220,objectFit:"contain",display:"block"}} />
                      </div>
                    )}
                    {Array.isArray(detail.problems) ? detail.problems.map((p, i) => (
                      <div key={i} style={{marginBottom:16}}>
                        {detail.problems.length > 1 && (
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                            <div style={{width:22,height:22,borderRadius:"50%",background:"#2a2218",display:"flex",alignItems:"center",justifyContent:"center",color:"#f0e8d0",fontSize:11,fontWeight:700}}>{i+1}</div>
                            <div style={{height:"0.5px",flex:1,background:"#e0d0b0"}}/>
                          </div>
                        )}
                        <ResultPanel result={p} />
                      </div>
                    )) : <ResultPanel result={detail.result || detail.problems} />}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 主入口 ────────────────────────────────────────
export default function App() {
  const [mode, setMode]       = useState("parent");
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");

  const handleLogin = () => {
    if (pwInput === TEACHER_PASSWORD) { setMode("teacher"); setPwInput(""); setPwError(""); }
    else { setPwError("密码错误，请重试"); }
  };

  return (
    <div style={{minHeight:"100vh",background:"#f5f0e8",fontFamily:"'Noto Sans SC','PingFang SC',sans-serif",color:"#2a2218"}}>
      <div style={{background:"#2a2218",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:10,letterSpacing:3,color:"#6a5a3a",marginBottom:2}}>信望数理 · 彭老师</div>
          <div style={{fontSize:20,fontWeight:700,color:"#f0e8d0",letterSpacing:1}}>
            {mode === "teacher" ? "教师后台" : "计算题解题检查"}
          </div>
        </div>
        {mode === "parent" && (
          <button onClick={() => setMode("login")} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,padding:"7px 14px",fontSize:12,color:"#c0b090",cursor:"pointer"}}>
            教师后台 →
          </button>
        )}
      </div>

      <div style={{padding:"20px 16px",maxWidth:680,margin:"0 auto"}}>

        {mode === "parent" && <ParentView />}

        {mode === "login" && (
          <div style={{background:"#fff",borderRadius:16,padding:"32px 24px",maxWidth:360,margin:"40px auto",boxShadow:"0 4px 24px rgba(42,34,24,0.1)"}}>
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{fontSize:36,marginBottom:10}}>🔐</div>
              <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>教师后台登录</div>
              <div style={{fontSize:12,color:"#8a7a5a"}}>请输入教师密码</div>
            </div>
            <input type="password" value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="请输入密码"
              style={{width:"100%",background:"#faf6ee",border:"1px solid #d8c8a0",borderRadius:10,padding:"12px 14px",fontSize:15,color:"#2a2218",outline:"none",boxSizing:"border-box",marginBottom:12,fontFamily:"inherit"}} />
            {pwError && <div style={{color:"#c03030",fontSize:12,marginBottom:10}}>⚠ {pwError}</div>}
            <button onClick={handleLogin} style={{width:"100%",background:"#2a2218",color:"#f0e8d0",border:"none",borderRadius:10,padding:13,fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:10}}>登录</button>
            <button onClick={() => { setMode("parent"); setPwInput(""); setPwError(""); }} style={{width:"100%",background:"transparent",color:"#8a7a5a",border:"1px solid #d8c8a0",borderRadius:10,padding:11,fontSize:13,cursor:"pointer"}}>返回家长端</button>
            <div style={{marginTop:16,padding:"10px 14px",background:"#f5f0e8",borderRadius:8,fontSize:11,color:"#8a7a5a",textAlign:"center"}}>
              默认密码：<span style={{fontFamily:"monospace",fontWeight:700,color:"#4a3a20"}}>{TEACHER_PASSWORD}</span>
            </div>
          </div>
        )}

        {mode === "teacher" && <TeacherView onLogout={() => setMode("parent")} />}
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0);opacity:.5} 50%{transform:translateY(-7px);opacity:1} }
        * { box-sizing: border-box; }
        input::placeholder { color: #b0a080; }
      `}</style>
    </div>
  );
}
