// 家长报分 / 老师查分
//
// 为什么要单独一个接口，不塞进 answer-sheets：
//   答题卡是一页一份，一场考试可能有三页；分数只有一个。
//   塞进 sheet meta 里，同一场的分数会存三份，改一次要改三处，还容易改漏。
//   所以按「考试 + 学生」单独存，一场一条。
//
// 家长为什么需要报分：
//   纸质保管的答题卡上只有孩子的字和老师画的叉，哪题错、扣几分要自己看。
//   智学网能给分，但没有原卷的时候给不了。家长看卷子报一个总分，
//   是这条路里唯一可靠的分数来源。
//
// 接口：
//   POST   { gid, sid, examId, score }        家长/老师报分（sid 必需，不认名字）
//   GET    ?view=exam&examId=&password=       老师：这场所有人的分
//   GET    ?view=student&sid=&password=       老师：这个学生历次的分
//   GET    ?view=mine&sid=                    家长：自己这一条（只回分数）
//   DELETE { sid, examId, password }          老师：删掉一条

import { guardTeacher } from "../lib/auth.js";
import { K, redisCmd, redisPipe, getJSON } from "../lib/store.js";

// 初中数学满分常见 100 / 120 / 150，留到 200 足够，不硬卡某个值
const MIN = 0;
const MAX = 200;

function parseScore(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { error: "分数没填" };
  const n = Number(raw);
  if (!isFinite(n)) return { error: "分数得是数字" };
  if (n < MIN || n > MAX) return { error: `分数填 ${MIN} 到 ${MAX} 之间` };
  if (Math.round(n * 10) !== n * 10) return { error: "最多保留一位小数" };
  return { score: n };
}

// Upstash 的 HGETALL 有时回对象、有时回扁平数组（[f1,v1,f2,v2]），
// 两种都要吃得下，不然线上才知道格式不对。
function hashPairs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const out = [];
    for (let i = 0; i + 1 < raw.length; i += 2) out.push([String(raw[i]), raw[i + 1]]);
    return out;
  }
  return Object.keys(raw).map((k) => [k, raw[k]]);
}

// 取回给前端的一行
function viewOf(examId, sid, raw) {
  const r = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch (_) { return null; } })() : raw;
  if (!r) return null;
  return {
    examId,
    sid,
    score: r.score,
    updatedAt: r.updatedAt || 0,
    source: r.source || "parent"
  };
}

export default async function handler(req, res) {
  try {
    // ════════ 家长报分 ════════
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: "请求格式不对" }); }
      }
      body = body || {};

      const gid = String(body.gid || "");
      const sid = String(body.sid || "");
      const examId = String(body.examId || "");
      if (!gid) return res.status(400).json({ error: "没有选班级" });
      if (!sid) return res.status(400).json({ error: "没有认领到学生，请先传一次答题卡或联系彭老师" });
      if (!examId) return res.status(400).json({ error: "没有选考试" });

      const p = parseScore(body.score);
      if (p.error) return res.status(400).json({ error: p.error });

      const group = await getJSON(K.group(gid));
      if (!group) return res.status(404).json({ error: "这个班级不存在" });

      // 考试必须属于这个班。否则家长改一下请求就能把分记到别班的卷子上。
      const exam = await getJSON(K.exam(examId));
      if (!exam) return res.status(404).json({ error: "这场考试不存在" });
      if (exam.gid !== gid) return res.status(400).json({ error: "这场考试不属于这个班级" });
      if (exam.status === "closed") return res.status(409).json({ error: "这场考试已经结束了，要改分请联系彭老师" });

      // 学生必须真的在这个班。这跟传图的校验是同一条红线。
      const isMember = await redisCmd(["SISMEMBER", K.groupMembers(gid), sid]);
      if (Number(isMember) !== 1) return res.status(400).json({ error: "这个学生不在所选班级里" });
      const student = await getJSON(K.student(sid));
      if (!student) return res.status(404).json({ error: "找不到这个学生" });

      const record = {
        score: p.score,
        updatedAt: Date.now(),
        source: body.source === "teacher" ? "teacher" : "parent",
        gid,
        examName: exam.name || ""
      };

      await redisPipe([
        ["HSET", K.examScores(examId), sid, JSON.stringify(record)],
        ["HSET", K.studentScores(sid), examId, String(p.score)]
      ]);

      return res.status(200).json({
        ok: true,
        sid,
        examId,
        examName: exam.name || "",
        studentName: student.displayName || student.name || "",
        score: p.score
      });
    }

    // ════════ 查询 ════════
    if (req.method === "GET") {
      const q = req.query || {};
      const view = q.view || "";

      // 老师：某场考试的所有分数，按分数倒序
      if (view === "exam") {
        if (!guardTeacher(req, res, q.password)) return;
        const examId = String(q.examId || "");
        if (!examId) return res.status(400).json({ error: "缺少 examId" });
        const raw = await redisCmd(["HGETALL", K.examScores(examId)]);
        const list = [];
        for (const [sid, value] of hashPairs(raw)) {
          const v = viewOf(examId, sid, value);
          if (v) list.push(v);
        }
        list.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
        return res.status(200).json({ ok: true, scores: list });
      }

      // 老师：某个学生历次分数（成绩时间线要用的就是这个）
      if (view === "student") {
        if (!guardTeacher(req, res, q.password)) return;
        const sid = String(q.sid || "");
        if (!sid) return res.status(400).json({ error: "缺少 sid" });
        const raw = await redisCmd(["HGETALL", K.studentScores(sid)]);
        const pairs = hashPairs(raw).map(([examId, value]) => [examId, Number(value)]);
        // 一次把每场的分明细取回来，避免每条单独 HGET 往返
        const exams = await Promise.all(
          pairs.map(async ([examId, score]) => {
            const one = await redisCmd(["HGET", K.examScores(examId), sid]);
            const v = viewOf(examId, sid, one) || { examId, sid, score, updatedAt: 0, source: "parent" };
            const exam = await getJSON(K.exam(examId));
            return { ...v, examName: exam?.name || "", examDate: exam?.date || "" };
          })
        );
        exams.sort((a, b) => b.updatedAt - a.updatedAt);
        return res.status(200).json({ ok: true, scores: exams });
      }

      // 家长看自己填过的分，只回分数本身
      if (view === "mine") {
        const sid = String(q.sid || "");
        const examId = String(q.examId || "");
        if (!sid || !examId) return res.status(400).json({ error: "缺少 sid 或 examId" });
        const raw = await redisCmd(["HGET", K.examScores(examId), sid]);
        const v = viewOf(examId, sid, raw);
        return res.status(200).json({ ok: true, score: v ? v.score : null, updatedAt: v ? v.updatedAt : 0 });
      }

      return res.status(400).json({ error: "不认识的查询" });
    }

    // ════════ 老师改分 / 补录 ════════
    if (req.method === "PATCH") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: "请求格式不对" }); }
      }
      body = body || {};
      if (!guardTeacher(req, res, body.password)) return;

      const sid = String(body.sid || "");
      const examId = String(body.examId || "");
      if (!sid || !examId) return res.status(400).json({ error: "缺少 sid 或 examId" });
      const p = parseScore(body.score);
      if (p.error) return res.status(400).json({ error: p.error });

      const exam = await getJSON(K.exam(examId));
      if (!exam) return res.status(404).json({ error: "这场考试不存在" });
      const isMember = await redisCmd(["SISMEMBER", K.groupMembers(exam.gid), sid]);
      if (Number(isMember) !== 1) return res.status(400).json({ error: "这个学生不在这场考试的班级里" });

      const record = { score: p.score, updatedAt: Date.now(), source: "teacher", gid: exam.gid, examName: exam.name || "" };
      await redisPipe([
        ["HSET", K.examScores(examId), sid, JSON.stringify(record)],
        ["HSET", K.studentScores(sid), examId, String(p.score)]
      ]);
      return res.status(200).json({ ok: true, score: p.score });
    }

    // ════════ 删除 ════════
    if (req.method === "DELETE") {
      const body = req.body || {};
      if (!guardTeacher(req, res, body.password)) return;
      const sid = String(body.sid || "");
      const examId = String(body.examId || "");
      if (!sid || !examId) return res.status(400).json({ error: "缺少 sid 或 examId" });
      await redisPipe([
        ["HDEL", K.examScores(examId), sid],
        ["HDEL", K.studentScores(sid), examId]
      ]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "不支持的方法" });
  } catch (e) {
    console.error("[scores]", e?.message);
    return res.status(500).json({ error: "服务器出错：" + (e?.message || "未知") });
  }
}
