// Word 试卷 AI 分析：上传 DOCX → 结构化拆题 → 逐题 AI 分析
//
// 为什么合成一个接口：Vercel 免费版限 12 个函数，当前已用 10 个，
// 只剩 1 个名额。所以 parse / analyze 用 action 区分，共用一个函数。
//
// 拆题为什么不交给 AI：实测这份卷子 26 题，规则切分 58ms 全部命中、
// 482 个公式零丢失；AI 切题要几十秒还要花钱还可能漏题。规则能做的不该交给模型。
// 只有在题号格式异常（切不出题、题号大段断档）时，才返回 needsAIFallback 让上层决定。

import { parseDocx } from "./lib/docx.js";
import { textJSON, aiConfigured } from "../lib/ai.js";
import { checkRateLimit } from "../lib/ratelimit.js";
import { guardTeacher } from "../lib/auth.js";

export const config = { maxDuration: 300 };

// base64 后的字符上限。Vercel 请求体 4.5MB，1.07MB 的 DOCX 转 base64 约 1.43MB，
// 留足余量给 6MB，超大卷子直接拒掉，不要拖到平台层报一个看不懂的错。
const MAX_BASE64_CHARS = 6_000_000;

const ANALYZE_SYSTEM = `你是一位资深初中数学教研员，负责给试卷做逐题教学分析。

输入是一组题目。题干里的 $...$ 是 LaTeX 公式（\\frac{a}{b} 是 a 分之 b，^{n} 是指数，\\left|...\\right| 是绝对值），⟦图⟧ 表示原题此处有一张图，但你看不到图的内容。

对每道题输出以下字段：
1. knowledgePoints：知识点数组，2 到 4 个，用初中数学教材的标准术语（如「有理数混合运算」「单项式的次数」「同类项」）。
2. difficulty：1 到 5 的整数。1 = 直接套定义或公式；2 = 一步运算；3 = 需要两三步推理或分类讨论；4 = 综合多个知识点；5 = 压轴。
3. difficultyLabel：只能取「易」「中」「难」「压轴」之一，与 difficulty 对应（1-2 易，3 中，4 难，5 压轴）。
4. answer：正确答案。选择题给选项字母；填空题给具体值；解答题按小问分别给结果。
5. solution：解题过程，3 到 8 行，关键中间结果不能省，不要写「略」。
6. abilities：考查能力数组，1 到 3 个（如「运算能力」「数形结合」「分类讨论」「空间想象」「推理能力」）。
7. commonMistakes：易错点数组，1 到 3 条，要具体到「哪一步容易怎么错」。
8. note：可选。只在这几种情况写：题目原文疑似有误、题干与答案矛盾、因缺图无法确定答案。

硬性约束：
- 如果题目含 ⟦图⟧ 且缺图导致确实无法确定答案，answer 写「需要图形信息」，不要猜一个看似合理的答案。这种情况要在 note 里说明缺的是什么图。
- 如果给了 officialAnswer，以它为准，但你必须自己独立验证一遍。验证结果与官方不一致时，answer 仍写官方答案，同时必须在 note 里写清「我算出的是 X，与官方答案不一致」。绝不允许为了对齐官方答案而编造过程。
- 不要输出题目没有的信息，不要编造分值。
- 所有字段的值不得含换行符（solution 用「；」或「，」分隔步骤）。
- 公式一律用 $...$ 包裹，不要用 \(...\) 或 \[...\] 或 Markdown 反引号。

只输出 JSON，不要任何额外文字：
{"items":[{"no":1,"knowledgePoints":["..."],"difficulty":3,"difficultyLabel":"中","answer":"B","solution":"...","abilities":["..."],"commonMistakes":["..."],"note":""}]}`;

function clampQuestions(list, max = 6) {
  return (Array.isArray(list) ? list : []).slice(0, max);
}

// 把题目整理成给模型看的紧凑文本，省 token 也少出错
function buildQuestionText(qs) {
  const lines = [];
  for (const q of qs) {
    lines.push(`【第${q.no}题】题型：${q.type || "未知"}`);
    lines.push(`题干：${String(q.stem || "").slice(0, 1200)}`);
    if (Array.isArray(q.options) && q.options.length) {
      lines.push("选项：" + q.options.map((o) => `${o.tag}．${o.text}`).join("　"));
    }
    if (q.officialAnswer) lines.push(`官方答案：${String(q.officialAnswer).slice(0, 200)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "只支持 POST" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      return res.status(400).json({ error: "请求格式不对" });
    }
  }
  body = body || {};

  const action = String(body.action || (req.query && req.query.action) || "");
  const password = String(body.password || "");

  // 教师功能，统一拦截
  if (!guardTeacher(req, res, password)) return;

  // ── 第一步：解析 DOCX ──────────────────────────────
  // 注意：解析是纯本地计算（jszip + OMML→LaTeX），不调 AI，
  // 所以这里不检查 aiConfigured —— 没配密钥也应该能拆题。
  if (action === "parse") {
    const rl = await checkRateLimit(req, "paper-parse", 10, 60);
    if (!rl.allowed) {
      return res.status(429).json({ error: "上传过于频繁，请稍候一分钟再试" });
    }

    const raw = String(body.fileBase64 || body.base64 || body.doc || "");
    if (!raw) return res.status(400).json({ error: "没有收到文件数据" });
    if (raw.length > MAX_BASE64_CHARS) {
      return res.status(413).json({ error: "文件过大（超过 4.5MB），请压缩后重试" });
    }

    const b64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;

    let buffer;
    try {
      buffer = Buffer.from(b64, "base64");
    } catch (_) {
      return res.status(400).json({ error: "文件数据损坏，请重新上传" });
    }
    if (buffer.length < 1000) {
      return res.status(400).json({ error: "文件为空或不是有效的 DOCX" });
    }
    // ZIP 魔数 PK\x03\x04，先验一下省得后面报一个看不懂的错
    if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
      return res.status(400).json({ error: "这不是 DOCX 文件（如果是 .doc 请另存为 .docx）" });
    }

    try {
      const paper = await parseDocx(buffer);
      return res.status(200).json({
        ok: true,
        paper: {
          title: paper.title,
          totalScore: paper.totalScore,
          questions: paper.questions,
          sections: paper.sections,
          stats: paper.stats,
          needsAIFallback: paper.needsAIFallback,
        },
        fileSize: buffer.length,
      });
    } catch (e) {
      console.error("[paper] parse 失败:", e && e.message);
      return res.status(422).json({
        error: "解析失败：" + ((e && e.message) || "未知原因"),
        hint: "如果是扫描件（整页图片）的 DOCX，里面没有可提取的文字，需要走图片识别路线。",
      });
    }
  }

  // ── 第二步：逐题 AI 分析 ───────────────────────────
  if (action === "analyze") {
    const rl = await checkRateLimit(req, "paper-analyze", 40, 60);
    if (!rl.allowed) {
      return res.status(429).json({ error: "分析请求过于频繁，请稍候再试" });
    }

    const qs = clampQuestions(body.questions, 6);
    if (!qs.length) return res.status(400).json({ error: "没有需要分析的题目" });

    if (!aiConfigured()) {
      return res.status(500).json({ error: "服务器未配置 AI 密钥，无法做逐题分析（拆题不受影响）" });
    }

    const userText =
      "请分析下面这些题目：\n\n" + buildQuestionText(qs);

    try {
      const { json, usage, finish, attempts, model } = await textJSON({
        system: ANALYZE_SYSTEM,
        user: userText,
        maxTokens: 16384,
        attempts: 2,
        budgetMs: 130000,
      });

      const items = Array.isArray(json && json.items) ? json.items : [];
      // 按题号对齐回原题，避免模型少给/乱序导致错位
      const byNo = new Map();
      for (const it of items) {
        const n = Number(it && it.no);
        if (Number.isFinite(n)) byNo.set(n, it);
      }

      const results = qs.map((q) => {
        const it = byNo.get(Number(q.no)) || null;
        return {
          no: q.no,
          ok: !!it,
          knowledgePoints: (it && it.knowledgePoints) || [],
          difficulty: Number(it && it.difficulty) || 0,
          difficultyLabel: (it && it.difficultyLabel) || "",
          answer: (it && it.answer) || "",
          solution: (it && it.solution) || "",
          abilities: (it && it.abilities) || [],
          commonMistakes: (it && it.commonMistakes) || [],
          note: (it && it.note) || "",
        };
      });

      return res.status(200).json({
        ok: true,
        results,
        meta: {
          model,
          finish,
          attempts,
          usage,
          requested: qs.length,
          returned: items.length,
        },
      });
    } catch (e) {
      console.error("[paper] analyze 失败:", e && e.message);
      return res.status(502).json({
        error: "AI 分析失败：" + ((e && e.message) || "未知原因"),
        hint: "可以只勾选一两道题单独重试，题目越多越容易超时。",
      });
    }
  }

  return res.status(400).json({ error: "未知的 action，只支持 parse / analyze" });
}
