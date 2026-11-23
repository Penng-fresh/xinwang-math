// DOCX 试卷结构化解析
//
// 目标：把 Word 试卷拆成「一题一条」的结构化数据，公式原位转成 LaTeX。
//
// 为什么用规则切题而不是让 AI 切：
//   实测这份卷子 482 个 m:oMath，规则切分 26 题全部命中，耗时 50ms。
//   AI 切题要几十秒、要花钱、还可能漏题。规则能做的就不该交给模型。
//   但题号格式不统一时规则会失效，所以留了 needsAIFallback 标记给上层兜底。
//
// 依赖：jszip（解压）、txml（解析 XML）、dwml-ts（OMML→LaTeX）
// 三个都是纯 JS，无 DOM 依赖，Vercel 可直接跑。

import JSZip from "jszip";
import * as txml from "txml";
import { ommlNodeToLatex } from "dwml-ts";

const localName = (n) => (n && n.includes(":") ? n.slice(n.indexOf(":") + 1) : n || "");

// txml 不解码实体，这里必须补（否则 &lt; 会变成字母 lt，第一轮踩过）
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function getRelId(node) {
  const a = node.attributes || {};
  for (const k of Object.keys(a)) {
    const ln = localName(k);
    if (ln === "embed" || ln === "id") return a[k];
  }
  return null;
}

// 把一段 w:p 里的内容按顺序拼成字符串：文本原样、公式转 $LaTeX$、图片留占位
function walkNode(node, ctx) {
  if (typeof node === "string") {
    ctx.buf.push(node);
    return;
  }
  const tag = localName(node.tagName);

  if (tag === "oMath") {
    let tex = "";
    try {
      tex = ommlNodeToLatex(node) || "";
    } catch (_) {
      tex = "";
    }
    if (tex) {
      ctx.formulas++;
      ctx.buf.push(`$${tex}$`);
    }
    return; // 不再下探，避免重复
  }

  if (tag === "oMathPara") {
    for (const c of node.children || []) walkNode(c, ctx);
    return;
  }

  if (tag === "drawing" || tag === "pict" || tag === "object") {
    let rid = null;
    (function dig(n) {
      if (rid || typeof n === "string") return;
      const t = localName(n.tagName);
      if (t === "blip" || t === "imagedata") {
        rid = getRelId(n);
        if (rid) return;
      }
      for (const c of n.children || []) dig(c);
    })(node);
    ctx.images.push(rid || "?");
    ctx.buf.push("⟦图⟧");
    return;
  }

  if (tag === "t") {
    const s = (node.children || []).map((c) => (typeof c === "string" ? c : "")).join("");
    ctx.buf.push(decodeEntities(s));
    return;
  }
  if (tag === "tab") { ctx.buf.push("\t"); return; }
  if (tag === "br") { ctx.buf.push("\n"); return; }
  if (tag === "pPr" || tag === "rPr" || tag === "sectPr") return;

  if (tag === "tbl") {
    const rows = [];
    (function collect(n2) {
      if (typeof n2 === "string") return;
      if (localName(n2.tagName) === "tr") {
        const cells = [];
        (function cellWalk(n3) {
          if (typeof n3 === "string") return;
          if (localName(n3.tagName) === "tc") {
            const cc = { buf: [], formulas: 0, images: [] };
            for (const k of n3.children || []) walkNode(k, cc);
            cells.push(cc.buf.join("").trim());
            ctx.formulas += cc.formulas; // 表格里的公式必须并回总数，否则统计偏小
            ctx.images.push(...cc.images);
            return;
          }
          for (const k of n3.children || []) cellWalk(k);
        })(n2);
        rows.push(cells);
        return;
      }
      for (const k of n2.children || []) collect(k);
    })(node);
    if (rows.length) {
      ctx.tables.push(rows);
      ctx.buf.push("\n" + rows.map((r) => r.join(" | ")).join("\n") + "\n");
    }
    return;
  }

  for (const c of node.children || []) walkNode(c, ctx);
}

function findBody(nodes) {
  for (const n of nodes) {
    if (typeof n === "string") continue;
    if (localName(n.tagName) === "body") return n;
    const r = findBody(n.children || []);
    if (r) return r;
  }
  return null;
}

// 题号：1． 2. 12． 这类行首编号
const QNUM = /^(\d{1,2})\s*[．.、]\s*/;
// 大题标题：一、单选题 / 二、填空题
const SECTION = /^([一二三四五六七八九十]+)\s*[、.]\s*(.+?)\s*$/;
// 选项行：A．xxx B．xxx
const OPTION_SPLIT = /([A-D])[．.、]\s*/g;

function sectionType(label) {
  if (/选择|单选|多选/.test(label)) return "单选题";
  if (/填空/.test(label)) return "填空题";
  if (/解答|计算|证明|应用/.test(label)) return "解答题";
  if (/判断/.test(label)) return "判断题";
  return "题目";
}

// 把一行里的 A． B． C． D． 拆成选项数组
function splitOptions(text) {
  const t = String(text).trim();
  if (!/^A[．.、]/.test(t)) return null;
  const marks = [];
  let m;
  OPTION_SPLIT.lastIndex = 0;
  while ((m = OPTION_SPLIT.exec(t))) marks.push({ tag: m[1], idx: m.index, end: OPTION_SPLIT.lastIndex });
  if (marks.length < 2) return null;
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const to = i + 1 < marks.length ? marks[i + 1].idx : t.length;
    out.push({ tag: marks[i].tag, text: t.slice(marks[i].end, to).trim() });
  }
  return out;
}

/**
 * 解析 DOCX buffer
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<object>}
 */
export async function parseDocx(buffer) {
  const t0 = Date.now();
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("这不是有效的 DOCX（缺少 word/document.xml）");
  const xml = await docFile.async("string");

  // rId → 媒体文件
  const ridMap = {};
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (relsFile) {
    const relsXml = await relsFile.async("string");
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const s = m[0];
      const id = (s.match(/Id="([^"]+)"/) || [])[1];
      const target = (s.match(/Target="([^"]+)"/) || [])[1];
      const type = (s.match(/Type="([^"]+)"/) || [])[1] || "";
      if (id && target && type.endsWith("/image")) ridMap[id] = target;
    }
  }

  const tree = txml.parse(xml);
  const body = findBody(tree);
  if (!body) throw new Error("DOCX 里没有正文内容");

  // 逐段重建
  const paras = [];
  for (const child of body.children || []) {
    if (typeof child === "string") continue;
    const tag = localName(child.tagName);
    if (tag !== "p" && tag !== "tbl") continue;
    const ctx = { buf: [], formulas: 0, images: [], tables: [] };
    walkNode(child, ctx);
    const text = ctx.buf.join("").replace(/[ \t]+/g, " ").trim();
    if (!text && !ctx.formulas && !ctx.images.length) continue;
    paras.push({ text, formulas: ctx.formulas, images: ctx.images });
  }

  if (!paras.length) throw new Error("DOCX 里没解析出任何文字");

  // 找答案区起点
  const ansStart = paras.findIndex((p) => /参考答案|答案与解析|试题解析/.test(p.text));

  const stemZone = ansStart > 0 ? paras.slice(0, ansStart) : paras;
  const ansZone = ansStart > 0 ? paras.slice(ansStart + 1) : [];

  // 标题：第一段常常是卷名
  let title = "";
  for (const p of stemZone.slice(0, 3)) {
    const t = p.text.replace(/⟦图⟧/g, "").trim();
    if (t && !QNUM.test(t) && !SECTION.test(t)) { title = t; break; }
  }
  if (!title) title = "未命名试卷";

  // 分值线索
  let totalScore = 0;
  const scoreMatch = paras.map((p) => p.text.match(/满分\s*(\d{1,3})\s*分/)).find(Boolean);
  if (scoreMatch) totalScore = +scoreMatch[1];

  // 切题
  const questions = [];
  let currentSection = { label: "", type: "题目" };
  let cur = null;

  const flush = () => {
    if (!cur) return;
    const bodyText = cur.lines.join("\n").trim();
    if (!bodyText) { cur = null; return; }
    // 选项：同一道题的选项常常跨两行（A B 一行，C D 一行），先合再拆
    const optLines = [];
    const rest = [];
    for (const line of cur.lines) {
      if (/^[A-D]\s*[．.、]/.test(line.trim())) optLines.push(line.trim());
      else rest.push(line);
    }
    const options = optLines.length ? splitOptions(optLines.join(" ")) : null;
    const stem = rest.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const latexCount = (stem.match(/\$/g) || []).length / 2;
    questions.push({
      no: cur.no,
      sectionLabel: cur.sectionLabel,
      type: cur.sectionType,
      stem,
      options,
      images: cur.images,
      latexCount: Math.round(latexCount),
      officialAnswer: "",
    });
    cur = null;
  };

  for (const p of stemZone) {
    const t = p.text;
    const sec = t.match(SECTION);
    if (sec && !QNUM.test(t)) {
      flush();
      currentSection = { label: `${sec[1]}、${sec[2]}`, type: sectionType(sec[2]) };
      continue;
    }
    const qm = t.match(QNUM);
    if (qm) {
      flush();
      cur = {
        no: +qm[1],
        sectionLabel: currentSection.label,
        sectionType: currentSection.type,
        lines: [t.replace(QNUM, "").trim()],
        images: [...p.images],
      };
      continue;
    }
    if (cur) {
      cur.lines.push(t);
      cur.images.push(...p.images);
    }
  }
  flush();

  // 答案区切分，按题号对齐
  if (ansZone.length) {
    let aNo = null;
    let aBuf = [];
    const ansMap = new Map();
    const commit = () => {
      if (aNo != null) {
        const txt = aBuf.join(" ").replace(/\s+/g, " ").trim();
        // 只留第一次拿到的（就是题号后面紧跟的简短答案），后面详解里的散句不覆盖
        if (txt && !ansMap.has(aNo)) ansMap.set(aNo, txt);
      }
    };
    for (const p of ansZone) {
      const qm = p.text.match(QNUM);
      if (qm) {
        commit();
        aNo = +qm[1];
        aBuf = [p.text.replace(QNUM, "").trim()];
        continue;
      }
      if (aNo != null) {
        // 【分析】【详解】之前的部分算「答案」
        if (/^【(分析|详解|点睛|解答)】/.test(p.text)) {
          if (!ansMap.has(aNo)) ansMap.set(aNo, aBuf.join(" ").replace(/\s+/g, " ").trim());
          aBuf = [];
          continue;
        }
        aBuf.push(p.text);
      }
    }
    commit();
    for (const q of questions) {
      const a = ansMap.get(q.no);
      if (a) q.officialAnswer = a.slice(0, 300);
    }
  }

  // 大题汇总
  const secMap = new Map();
  for (const q of questions) {
    if (!q.sectionLabel) continue;
    if (!secMap.has(q.sectionLabel)) secMap.set(q.sectionLabel, { label: q.sectionLabel, type: q.type, from: q.no, to: q.no, count: 0 });
    const s = secMap.get(q.sectionLabel);
    s.to = q.no;
    s.count++;
  }

  // 题号连续性检查：断了就标记需要 AI 兜底
  const nos = questions.map((q) => q.no);
  let gaps = 0;
  for (let i = 1; i < nos.length; i++) if (nos[i] !== nos[i - 1] + 1) gaps++;
  const needsAIFallback = questions.length < 5 || questions.length > 80 || gaps > 3;

  return {
    title,
    totalScore,
    questions,
    sections: [...secMap.values()],
    stats: {
      questionCount: questions.length,
      formulaCount: paras.reduce((a, p) => a + p.formulas, 0),
      imageCount: paras.reduce((a, p) => a + p.images.length, 0),
      answeredCount: questions.filter((q) => q.officialAnswer).length,
      hasAnswerKey: ansStart > 0,
      numberGaps: gaps,
      parseMs: Date.now() - t0,
    },
    needsAIFallback,
    // 原始全文，AI 兜底或人工核对时用
    rawText: paras.map((p) => p.text).join("\n"),
    ridMap,
  };
}
