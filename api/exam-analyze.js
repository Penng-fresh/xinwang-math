// 读一份智学网「作答原卷」，输出家长报告的原始数据
//
// 这个接口只做三件事：读数字 → 校验 → 归类。
// 不写任何"因为他概念不清所以……"这类解释——那是老师面对家长时要讲的话，
// AI 一解释就会编，说错一句前面攒的信任全没了。
//
// 数据来源（家长手机里的智学网截图）：
//   卷面上老师用红笔手写的每个大题的得分，以及左上角的总分。
//   这些数字可以互相校验：各大题得分相加必须等于总分。
//   对不上就重试一次，再对不上宁可标"待核对"，也不硬编。

import { visionJSON, aiConfigured } from "./lib/ai.js";

// Vercel 请求体上限 4.5MB，base64 会膨胀 1/3，这里留足余量给其它字段
const MAX_BASE64_CHARS = 3.2 * 1024 * 1024;

const LEVEL_NAME = {
  base: "不该丢",
  mid: "讲过还不熟",
  hard: "太难，正常",
};

function buildSystem(paper) {
  const lines = paper.sections.map(
    (s, i) => `${i + 1}. key="${s.key}"  卷面位置：${s.label}  满分 ${s.fullScore} 分`
  );

  return `你在帮一位初中数学老师读试卷分数。用户会给你一张智学网的「作答原卷」截图
（学生答题卡的扫描件，上面有老师用红笔手写的批改痕迹）。

这份卷子的大题结构如下（满分是印刷的，得分是红笔手写的，两者常常不同）：
${lines.join("\n")}

你要做的是：把每一块的红笔得分读出来，以及左上角的总分。

读数字的规则，请严格遵守：
1. 只读红笔（或彩色粗笔）手写的得分数字。学生自己写的铅笔/黑笔答案不要读。
2. 「单选题（每题3分共36分）」这种印刷文字里的 36 是满分，不是得分。
   得分是老师另写在旁边的红字。两者碰巧相等时（比如满分 36、得分也 36），
   你也要如实返回 36，不要因为"看起来一样"就以为读错了。
3. 某个大题的红字被遮挡、太模糊、或者根本找不到，就把 value 填 null。
   绝对不要用"满分减一点"之类的办法猜一个数。
4. 不要把不同大题的分数张冠李戴。卷面上的大题编号（21、22、23……）和上面的 label 对应。
5. 【最重要】每一个数字都必须**独立地**照着你眼睛看到的样子读出来。
   绝不能为了让"各题分数加起来等于总分"而回头修改任何一个数字。
   你只管如实读；加起来对不上是系统该处理的，不需要你修正。
   实测过：模型曾经为了凑总数，把总分从 85 改成 95、把 4 改成 14，
   这种"自作聪明的对齐"比单纯的读错危害大得多。
6. 如果图里的红色笔迹被处理过（背景发白、只有红字清晰），那正是希望你把注意力
   全放在红字上。但不要因为背景变白就认为某些格子是空的——格线可能是浅灰的。
7. 不要做任何评价、分析、建议。只返回 JSON。

返回格式（严格 JSON，不要 markdown 代码块，不要额外说明）：
{
  "total": 总分数字或null,
  "sections": [
    {"key": "上面给的key", "value": 数字或null, "raw": "你在图上看到的原文，如「36分」"}
  ],
  "notes": "看不清或者有疑问的地方，一句话；没有就空字符串"
}`;
}

function buildUser(paper) {
  return `这是「${paper.title || "数学试卷"}」的作答原卷。请读出总分和 ${paper.sections.length} 个大题的红笔得分，按给定 key 返回 JSON。`;
}

// 把 AI 读到的 sections 对齐到卷子结构上
function align(paper, got) {
  const byKey = new Map();
  for (const s of got.sections || []) {
    if (s && s.key) byKey.set(String(s.key), s);
  }

  return paper.sections.map((s) => {
    const hit = byKey.get(String(s.key));
    const raw = hit ? hit.value : null;
    const value = typeof raw === "number" && isFinite(raw) ? raw : null;
    return {
      key: s.key,
      label: s.label,
      name: s.name || "",
      level: s.level || "base",
      fullScore: s.fullScore,
      score: value,
      raw: hit?.raw || "",
      // 读到的分数超出满分区间，肯定有问题，按"读不出"处理
      invalid: value !== null && (value < 0 || value > s.fullScore),
    };
  });
}

function summarize(paper, rows, total, aiNotes) {
  const missing = rows.filter((r) => r.score === null || r.invalid).map((r) => r.label);
  const known = rows.filter((r) => r.score !== null && !r.invalid);

  const sumGot = known.reduce((n, r) => n + r.score, 0);
  const sumFullKnown = known.reduce((n, r) => n + r.fullScore, 0);
  const sumFullAll = rows.reduce((n, r) => n + r.fullScore, 0);

  // ── 校验 ──
  // 只要有一个大题没读出来，求和就对不上，这时候"对不上"是预期的，
  // 不能当成"读错了"。所以要区分：是缺项，还是读出的数字互相矛盾。
  const allRead = missing.length === 0;
  const sumOk = allRead && total !== null && sumGot === total;

  const problems = [];
  if (!allRead) problems.push(`有 ${missing.length} 个大题没读出来（${missing.join("、")}）`);
  if (allRead && total === null) problems.push("总分没读出来");
  if (allRead && total !== null && sumGot !== total) {
    problems.push(`各题得分相加是 ${sumGot}，但卷面总分写的是 ${total}，差 ${Math.abs(sumGot - total)} 分`);
  }
  if (sumFullAll !== paper.totalScore) {
    problems.push(`卷子结构里满分合计 ${sumFullAll}，与设定的总分 ${paper.totalScore} 不一致`);
  }

  // ── 归类 ──
  const groups = { base: [], mid: [], hard: [] };
  for (const r of known) {
    const lost = r.fullScore - r.score;
    if (lost <= 0) continue;
    const g = groups[r.level] && groups[r.level] !== undefined ? r.level : "base";
    groups[groups[g] ? g : "base"].push({
      key: r.key,
      label: r.label,
      name: r.name,
      got: r.score,
      full: r.fullScore,
      lost,
    });
  }

  const lostBase = groups.base.reduce((n, r) => n + r.lost, 0);
  const lostMid = groups.mid.reduce((n, r) => n + r.lost, 0);
  const lostHard = groups.hard.reduce((n, r) => n + r.lost, 0);
  const lostAll = lostBase + lostMid + lostHard;

  // 先补哪里：丢分最多的那一块
  const worst = known
    .map((r) => ({ label: r.label, name: r.name, lost: r.fullScore - r.score }))
    .filter((r) => r.lost > 0)
    .sort((a, b) => b.lost - a.lost)[0] || null;

  return {
    score: { total, sumGot, sumFullAll, sumFullKnown, lostAll },
    groups: {
      base: groups.base.sort((a, b) => b.lost - a.lost),
      mid: groups.mid.sort((a, b) => b.lost - a.lost),
      hard: groups.hard.sort((a, b) => b.lost - a.lost),
    },
    lost: { base: lostBase, mid: lostMid, hard: lostHard },
    worst,
    check: { allRead, sumOk, missing, problems, aiNotes: aiNotes || "" },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "只支持 POST" });

  if (!aiConfigured()) return res.status(500).json({ error: "AI 未配置" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (_) {
    return res.status(400).json({ error: "请求格式不对" });
  }

  const { imageBase64, mediaType = "image/jpeg", paper } = body || {};

  if (!imageBase64) return res.status(400).json({ error: "没有收到图片" });
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return res.status(413).json({ error: "图片太大了，请重新拍一张或压缩后再传" });
  }
  if (!paper || !Array.isArray(paper.sections) || paper.sections.length === 0) {
    return res.status(400).json({ error: "缺少卷子结构（这份卷子有哪些大题、各多少分）" });
  }
  for (const s of paper.sections) {
    if (!s.key || typeof s.fullScore !== "number" || s.fullScore <= 0) {
      return res.status(400).json({ error: "卷子结构里有大题缺少 key 或满分" });
    }
  }

  try {
    const { json, usage, attempts } = await visionJSON({
      system: buildSystem(paper),
      user: buildUser(paper),
      imageBase64,
      mediaType,
      maxTokens: 8192,
      attempts: 2,
      budgetMs: 110000,
    });

    const total = typeof json.total === "number" && isFinite(json.total) ? json.total : null;
    const rows = align(paper, json);
    const report = summarize(paper, rows, total, json.notes);

    return res.status(200).json({
      ok: true,
      paper: { title: paper.title || "", grade: paper.grade || "", totalScore: paper.totalScore },
      rows,
      ...report,
      levelNames: LEVEL_NAME,
      debug: { attempts, usage },
    });
  } catch (e) {
    console.error("[exam-analyze] 失败:", e?.message);
    return res.status(502).json({ error: "读图失败：" + (e?.message || "未知错误") });
  }
}
