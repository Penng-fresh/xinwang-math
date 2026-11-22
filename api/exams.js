// 考试场次 + 卷子结构
//
// 为什么把「卷子」放进「考试场次」里，而不是单独做一个试卷库：
//   区统考是一份卷子好几所学校一起考。但老师真正要操作的是「新建路初一班
//   11 月 10 日那场期中」，不是「某份卷子」。做成试卷库会逼他先建卷子再挂
//   场次，两步操作换不来任何好处 —— 他要复用同一份卷子时，前端「从上一场
//   复制结构」一个按钮就够了。真需要拆开时再拆，现在拆是过度设计。
//
// 一场考试在打开之前，家长端看不到它（status=draft）。老师填完卷子结构、
// 确认满分合计对得上，才点「开放」。这跟"确定能用才告诉家长"是一个道理。

import { guardTeacher } from "../lib/auth.js";
import { K, redisPipe, redisCmd, getJSON, newId } from "../lib/store.js";
import { visionJSON } from "../lib/ai.js";

const LEVELS = ["base", "mid", "hard"];
const STATUSES = ["draft", "open", "closed"];

// 卷子结构里最多允许这么多大题。初一数学卷一般 8-12 个，给到 40 不会误伤，
// 但能挡住"误把整页题目当结构提交"这种离谱输入。
const MAX_SECTIONS = 40;

function groupExamsKey(gid) {
  // 跟建班时预置四次考试用的是同一个键，别在这里另写一份字符串
  return K.groupExams(gid);
}

// ── 卷子结构校验 ────────────────────────────────────────
// 这里必须严格：结构一旦存错，后面每份答卷的分析都是错的，而且不会报错。
function normalizePaper(raw) {
  if (!raw || typeof raw !== "object") return { error: "缺少卷子结构" };

  const totalScore = Number(raw.totalScore);
  if (!isFinite(totalScore) || totalScore <= 0) return { error: "卷子总分没填或不是正数" };

  const list = Array.isArray(raw.sections) ? raw.sections : [];
  if (list.length === 0) return { error: "卷子结构里一个大题都没有" };
  if (list.length > MAX_SECTIONS) return { error: `大题数量超过 ${MAX_SECTIONS} 个，请检查是不是填错了` };

  const sections = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {};
    const label = String(s.label || "").trim();
    const fullScore = Number(s.fullScore);

    if (!label) return { error: `第 ${i + 1} 行没有填「大题名称」` };
    if (!isFinite(fullScore) || fullScore <= 0) {
      return { error: `第 ${i + 1} 行（${label}）满分没填或不是正数` };
    }

    const level = LEVELS.includes(s.level) ? s.level : "base";

    // key 用调用方给的，没给就生成。key 必须唯一，否则读分时两个大题会互相覆盖
    let key = String(s.key || "").trim() || "s" + (i + 1);
    if (seen.has(key)) key = key + "_" + (i + 1);
    seen.add(key);

    sections.push({
      key,
      label,
      fullScore,
      level,
      name: String(s.name || "").trim(),
    });
  }

  const sum = sections.reduce((n, s) => n + s.fullScore, 0);
  // 允许 0.5 分刻度，用 0.01 容差
  if (Math.abs(sum - totalScore) > 0.01) {
    return {
      error: `各大题满分加起来是 ${sum} 分，但总分填的是 ${totalScore} 分，差 ${Math.abs(sum - totalScore)} 分。请先改到一致，不然每份答卷的校验都会失效。`,
    };
  }

  return {
    paper: {
      title: String(raw.title || "").trim(),
      totalScore,
      sections,
    },
  };
}

function blankExam(gid, body) {
  const now = Date.now();
  return {
    id: newId(),
    gid,
    name: String(body.name || "").trim() || "未命名考试",
    date: String(body.date || "").trim(),
    // 快照一份年级/学校：分组以后改名、学生毕业，历史考试还能显示当初的信息
    grade: String(body.grade || "").trim(),
    school: String(body.school || "").trim(),
    status: "draft",
    paper: { title: "", totalScore: 0, sections: [] },
    createdAt: now,
    updatedAt: now,
  };
}

// 给家长端看的版本：只给「这场考试叫什么」，不给卷子结构。
// 结构留在服务端由 exam-analyze 读，前端拿不到也就改不了。
function publicView(e) {
  return {
    id: e.id,
    name: e.name,
    date: e.date,
    totalScore: e.paper?.totalScore || 0,
    sectionCount: e.paper?.sections?.length || 0,
  };
}

async function loadMany(ids) {
  if (!ids || ids.length === 0) return [];
  const keys = ids.map((id) => K.exam(id));
  const vals = await redisCmd(["MGET", ...keys]);
  return (vals || [])
    .map((v) => {
      if (!v) return null;
      try {
        return JSON.parse(v);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  try {
    // ── 查询 ──
    if (req.method === "GET") {
      const q = req.query || {};

      // 家长端：某个分组当前开放的考试（不需要密码）
      if (q.view === "open") {
        const gid = String(q.gid || "");
        if (!gid) return res.status(400).json({ error: "缺少分组 id" });
        const ids = (await redisCmd(["ZREVRANGE", groupExamsKey(gid), "0", "-1"])) || [];
        const exams = await loadMany(ids);
        // slot = 建班时预置的四次考试占位（还没填卷子结构）。
        // 家长要能看到、能选、能传，所以这里不能只认 status=open。
        return res.status(200).json({
          ok: true,
          exams: exams.filter((e) => e.status === "open" || e.slot === true).map(publicView),
        });
      }

      // 老师端：某个分组下所有考试（含未开放的）
      if (q.view === "list") {
        if (!guardTeacher(req, res, q.password)) return;
        const gid = String(q.gid || "");
        if (!gid) return res.status(400).json({ error: "缺少分组 id" });
        const ids = (await redisCmd(["ZREVRANGE", groupExamsKey(gid), "0", "-1"])) || [];
        const exams = await loadMany(ids);
        // 列表页不需要完整卷子结构，省带宽
        return res.status(200).json({
          ok: true,
          exams: exams.map((e) => ({
            id: e.id,
            name: e.name,
            date: e.date,
            grade: e.grade,
            school: e.school,
            status: e.status,
            totalScore: e.paper?.totalScore || 0,
            sectionCount: e.paper?.sections?.length || 0,
            updatedAt: e.updatedAt,
          })),
        });
      }

      // 老师端：单个考试的完整内容（含卷子结构）
      if (q.view === "one") {
        if (!guardTeacher(req, res, q.password)) return;
        const e = await getJSON(K.exam(String(q.id || "")));
        if (!e) return res.status(404).json({ error: "找不到这场考试" });
        return res.status(200).json({ ok: true, exam: e });
      }

      return res.status(400).json({ error: "不认识的查询" });
    }

    // ── 写入 ──
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (_) {
          return res.status(400).json({ error: "请求格式不对" });
        }
      }
      body = body || {};

      if (!guardTeacher(req, res, body.password)) return;

      const action = String(body.action || "");

      // 新建一场考试（此时还没填卷子结构）
      if (action === "create") {
        const gid = String(body.gid || "");
        if (!gid) return res.status(400).json({ error: "请先选一个分组（学校+年级+班）" });
        const group = await getJSON(K.group(gid));
        if (!group) return res.status(404).json({ error: "这个分组不存在" });

        const e = blankExam(gid, { ...body, grade: body.grade || group.grade, school: body.school || group.school });
        await redisPipe([
          ["SET", K.exam(e.id), JSON.stringify(e)],
          ["ZADD", K.examIdx(), e.createdAt, e.id],
          ["ZADD", groupExamsKey(gid), e.createdAt, e.id],
        ]);
        return res.status(200).json({ ok: true, exam: e });
      }

      // 保存（改名字/日期/卷子结构/状态都走这里）
      if (action === "save") {
        const id = String(body.id || "");
        const old = await getJSON(K.exam(id));
        if (!old) return res.status(404).json({ error: "找不到这场考试" });

        const next = { ...old };

        if (body.name !== undefined) next.name = String(body.name).trim() || old.name;
        if (body.date !== undefined) next.date = String(body.date).trim();

        if (body.paper !== undefined) {
          const r = normalizePaper(body.paper);
          if (r.error) return res.status(400).json({ error: r.error });
          next.paper = r.paper;
        }

        if (body.status !== undefined) {
          const st = String(body.status);
          if (!STATUSES.includes(st)) return res.status(400).json({ error: "状态不对" });
          // 开放前必须先把卷子结构填完整，否则家长传上来也分析不了
          if (st === "open") {
            const p = normalizePaper(next.paper);
            if (p.error) return res.status(400).json({ error: "还不能开放：" + p.error });
            next.paper = p.paper;
          }
          next.status = st;
        }

        next.updatedAt = Date.now();
        await redisPipe([["SET", K.exam(id), JSON.stringify(next)]]);
        return res.status(200).json({ ok: true, exam: next });
      }

      // 拍照传试卷智能识别大题结构
      if (action === "parsePaperImages") {
        const images = Array.isArray(body.images) ? body.images : [];
        if (images.length === 0) return res.status(400).json({ error: "请上传试卷图片" });
        if (images.length > 6) return res.status(400).json({ error: "一次最多上传 6 张试卷图片" });

        const system = `你是一位初中数学资深教研老师。用户会提供真实空白数学考试试卷的照片（通常是1到4页）。
你的任务：仔细识读整份试卷，提取试卷基本信息与各大题结构，用于后续考试系统建立卷子标准。

严格遵守以下切分与规则：
1. 试卷标题 (title)：提取卷头名称（如"2026-2027学年第一学期期中考试 七年级数学试题"）。
2. 全卷满分 (totalScore)：读取卷首标明的总分数字（常见 100、120、150）。如果卷首未标，计算各大题满分之和。
3. 大题切分标准 (sections)：
   - 必须以卷面上的一级大题（如 一、选择题；二、填空题；第17题；第18题...）为单位切分，每道大题生成一条记录；
   - 【重要】大题内部如果包含 (1)、(2) 等小问，请将它们合并为该大题整体，不要拆分成单独的行（因为智学网和老师批改通常打一个大题总分）；
   - 每一条包含：
     * label: 卷面位置及大题编号（如"一、选择题"、"二、填空题"、"三、解答题第17题"）
     * fullScore: 该大题满分分值（正数）
     * name: 题型或考查主要内容（如"1-10题"、"11-16题"、"有理数混合运算"、"整式化简求值"、"方程应用题"、"几何动点压轴"等）
     * level: 初拟难度档位（仅限三选一："base" - 不该丢/基础题；"mid" - 讲过/中档题；"hard" - 压轴题）
4. 难度档位初拟参考：
   - 选择题、填空题、前1~2道基础计算大题通常为 "base"；
   - 几何证明、方程应用、函数等常规大题通常为 "mid"；
   - 全卷最后1~2道具有区分度的压轴大题通常为 "hard"。
5. 勾稽校验：所有 sections 的 fullScore 相加，必须严格等于 totalScore。

只返回标准 JSON，不要任何 Markdown 代码块或其他文字，格式如下：
{
  "title": "试卷名称",
  "totalScore": 120,
  "sections": [
    { "label": "一、选择题", "fullScore": 30, "name": "1-10题", "level": "base" },
    { "label": "二、填空题", "fullScore": 18, "name": "11-16题", "level": "base" },
    { "label": "三、解答题第17题", "fullScore": 8, "name": "有理数混合运算", "level": "base" }
  ]
}`;

        const { json } = await visionJSON({
          system,
          user: `请识别所附试卷照片，提取标题、全卷总分以及全部大题结构，确保各大题分值相加等于总分，返回 JSON。`,
          images,
          maxTokens: 4096,
          budgetMs: 90000,
        });

        if (!json || typeof json !== "object") {
          return res.status(502).json({ error: "AI 未能解析出合规的试卷结构，请确保图片清晰或手动录入" });
        }

        const title = String(json.title || "").trim();
        const totalScore = Number(json.totalScore) || 0;
        const sections = Array.isArray(json.sections) ? json.sections : [];

        if (sections.length === 0) {
          return res.status(502).json({ error: "未能识别出试卷中的大题结构，请重新拍摄清晰照片" });
        }

        return res.status(200).json({
          ok: true,
          paper: {
            title,
            totalScore,
            sections: sections.map((s, idx) => ({
              key: "s" + (idx + 1),
              label: String(s.label || `第${idx + 1}大题`).trim(),
              fullScore: Number(s.fullScore) || 0,
              level: ["base", "mid", "hard"].includes(s.level) ? s.level : "base",
              name: String(s.name || "").trim(),
            })),
          },
        });
      }

      return res.status(400).json({ error: "不认识的 action" });
    }

    // ── 删除 ──
    if (req.method === "DELETE") {
      const body = req.body || {};
      const id = String(body.id || "");
      if (!guardTeacher(req, res, body.password)) return;
      const old = await getJSON(K.exam(id));
      if (!old) return res.status(404).json({ error: "找不到这场考试" });
      // 已经开放过（家长可能传过答卷）的不让删，避免把分析数据一起清掉
      if (old.status !== "draft") {
        return res.status(409).json({ error: "这场考试已经开放过，不能删除。如果不再使用，改成「已结束」即可。" });
      }
      await redisPipe([
        ["DEL", K.exam(id)],
        ["ZREM", K.examIdx(), id],
        ["ZREM", groupExamsKey(old.gid), id],
      ]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "不支持的方法" });
  } catch (e) {
    console.error("[exams]", e?.message);
    return res.status(500).json({ error: "服务器出错：" + (e?.message || "未知") });
  }
}
