// 名单接口：班级分组 + 学生档案。
//
// 这是整条「考试分析 + 成绩走势」线的地基。趋势图能不能把同一个学生
// 跨考试连成一条线，全靠这里生成的 sid（学生唯一编号）。
//   · sid 一旦生成，永不改变。改名、转班、升年级都只改字段。
//   · 重名自动加尾号（张伟 / 张伟(2)），老师可以手动改成张伟A。
//
// 接口一览：
//   GET  ?view=catalog                          家长端：学校 + 分组列表（公开，不含学生名）
//   GET  ?view=pick&gid=xxx                     家长端：本组学生名字（公开，只吐 sid + 名字）
//   GET  ?view=groups&password=xxx              老师端：所有分组
//   GET  ?view=group&gid=xxx&password=xxx       老师端：单个分组 + 成员
//   POST {action:"createGroup"}                 新建分组
//   POST {action:"updateGroup"}                 改组名/学校/年级/学期
//   POST {action:"importNames"}                 批量粘贴导入名单（一列名字）
//   POST {action:"addStudent"}                  单个添加
//   POST {action:"renameStudent"}               改显示名（sid 不变）
//   POST {action:"moveStudent"}                 转班（sid 不变，历史成绩跟着走）
//   POST {action:"removeStudent"}               从分组移除
//   DELETE {gid} / {sid}                        删除分组 / 删除学生
//
// 隐私红线：家长端两个公开接口都只吐「sid + 名字」，绝不吐分数、绝不吐全库学生。
// 家长端取名字必须带 gid —— 只能看到自己班的人，和微信群里的可见范围一致。

import {
  K,
  redisCmd,
  redisPipe,
  getJSON,
  setJSON,
  setHash,
  getHash,
  newId
} from "./lib/store.js";
import { guardTeacher } from "./lib/auth.js";
import { parseNames, dedupeName } from "./lib/names.js";

// ── 学生读写 ────────────────────────────────────────────

function blankStudent({ sid, name, displayName, school, grade, gid }) {
  return {
    sid,
    name,
    displayName: displayName || name,
    school: school || "",
    grade: grade || "",
    gid: gid || "",
    createdAt: new Date().toISOString(),
    subCount: 0,
    series: [], // 每次考试的得分率快照，趋势图只读这里
    highlights: {}
  };
}

async function summaryOf(student) {
  return {
    sid: student.sid,
    name: student.name,
    displayName: student.displayName,
    school: student.school,
    grade: student.grade,
    gid: student.gid,
    subCount: student.subCount || 0,
    createdAt: student.createdAt
  };
}

async function writeStudent(student) {
  // 一次往返写三处：学生明细、学生索引、列表摘要
  await redisPipe([
    ["SET", K.student(student.sid), JSON.stringify(student)],
    ["ZADD", K.studentIdx(), String(Date.now()), student.sid],
    ["HSET", K.studentSum(), student.sid, JSON.stringify(await summaryOf(student))]
  ]);
}

// ── 分组读写 ────────────────────────────────────────────

async function readGroup(gid) {
  return getJSON(K.group(gid));
}

async function listGroupMembers(gid, withSummary) {
  const sids = (await redisCmd(["SMEMBERS", K.groupMembers(gid)])) || [];
  if (sids.length === 0) return [];
  if (!withSummary) {
    // 家长端：只吐 sid + 名字
    const out = [];
    const sums = await getHash(K.studentSum(), sids);
    sids.forEach((sid) => {
      const s = sums[sid];
      if (!s) return;
      out.push({ sid, name: s.displayName || s.name });
    });
    out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    return out;
  }
  const sums = await getHash(K.studentSum(), sids);
  const out = sids
    .map((sid) => sums[sid])
    .filter(Boolean)
    .map((s) => ({
      sid: s.sid,
      name: s.name,
      displayName: s.displayName,
      subCount: s.subCount || 0,
      createdAt: s.createdAt
    }));
  out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return out;
}

// ── handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    // ══════════ GET ══════════
    if (req.method === "GET") {
      const q = req.query || {};
      const view = q.view || "groups";

      // —— 家长端：学校 + 分组列表（公开）——
      if (view === "catalog") {
        const gids = (await redisCmd(["ZREVRANGE", K.groupIdx(), "0", "199"])) || [];
        if (gids.length === 0) return res.status(200).json({ schools: [] });
        const raws = await redisPipe(gids.map((gid) => ["GET", K.group(gid)]));
        const groups = [];
        raws.forEach((raw) => {
          if (!raw) return;
          try {
            const g = JSON.parse(raw);
            groups.push({
              gid: g.gid,
              name: g.name,
              school: g.school,
              grade: g.grade,
              term: g.term
            });
          } catch (_) {}
        });
        const bySchool = {};
        groups.forEach((g) => {
          const key = g.school || "未分学校";
          (bySchool[key] = bySchool[key] || []).push(g);
        });
        return res.status(200).json({
          schools: Object.keys(bySchool).map((s) => ({ school: s, groups: bySchool[s] }))
        });
      }

      // —— 家长端：本组学生名字（公开，必须带 gid）——
      if (view === "pick") {
        const gid = String(q.gid || "");
        if (!gid) return res.status(400).json({ error: "缺少分组" });
        const group = await readGroup(gid);
        if (!group) return res.status(404).json({ error: "分组不存在" });
        const students = await listGroupMembers(gid, false);
        return res.status(200).json({
          group: { gid: group.gid, name: group.name, school: group.school, grade: group.grade },
          students
        });
      }

      // —— 以下需要教师密码 ——
      if (!guardTeacher(req, res, q.password)) return;

      if (view === "groups") {
        const gids = (await redisCmd(["ZREVRANGE", K.groupIdx(), "0", "199"])) || [];
        if (gids.length === 0) return res.status(200).json({ groups: [] });
        const cmds = [];
        gids.forEach((gid) => {
          cmds.push(["GET", K.group(gid)]);
          cmds.push(["SCARD", K.groupMembers(gid)]);
        });
        const rs = await redisPipe(cmds);
        const groups = [];
        for (let i = 0; i < gids.length; i++) {
          const raw = rs[i * 2];
          const cnt = rs[i * 2 + 1];
          if (!raw) continue;
          try {
            const g = JSON.parse(raw);
            g.count = Number(cnt) || 0;
            groups.push(g);
          } catch (_) {}
        }
        return res.status(200).json({ groups });
      }

      if (view === "group") {
        const gid = String(q.gid || "");
        if (!gid) return res.status(400).json({ error: "缺少分组" });
        const group = await readGroup(gid);
        if (!group) return res.status(404).json({ error: "分组不存在" });
        const members = await listGroupMembers(gid, true);
        return res.status(200).json({ group, members });
      }

      if (view === "student") {
        const sid = String(q.sid || "");
        if (!sid) return res.status(400).json({ error: "缺少学生编号" });
        const student = await getJSON(K.student(sid));
        if (!student) return res.status(404).json({ error: "学生不存在" });
        return res.status(200).json({ student });
      }

      return res.status(400).json({ error: "未知的 view 参数" });
    }

    // ══════════ POST ══════════
    if (req.method === "POST") {
      const body = req.body || {};
      if (!guardTeacher(req, res, body.password)) return;
      const action = body.action || "";

      // —— 新建分组 ——
      if (action === "createGroup") {
        const school = String(body.school || "").trim();
        const name = String(body.name || "").trim();
        if (!school) return res.status(400).json({ error: "请填学校" });
        if (!name) return res.status(400).json({ error: "请填分组名（例如：初一秋季班）" });

        const gid = "g" + newId();
        const group = {
          gid,
          name,
          school,
          grade: String(body.grade || "").trim(),
          term: String(body.term || "").trim(),
          createdAt: new Date().toISOString()
        };
        await redisPipe([
          ["SET", K.group(gid), JSON.stringify(group)],
          ["ZADD", K.groupIdx(), String(Date.now()), gid],
          ["ZADD", K.schools(), "0", school]
        ]);
        return res.status(200).json({ ok: true, group });
      }

      // —— 改分组信息 ——
      if (action === "updateGroup") {
        const gid = String(body.gid || "");
        const group = await readGroup(gid);
        if (!group) return res.status(404).json({ error: "分组不存在" });
        ["name", "school", "grade", "term"].forEach((f) => {
          if (body[f] !== undefined) group[f] = String(body[f]).trim();
        });
        await setJSON(K.group(gid), group);
        return res.status(200).json({ ok: true, group });
      }

      // —— 批量粘贴导入名单 ——
      if (action === "importNames") {
        const gid = String(body.gid || "");
        const group = await readGroup(gid);
        if (!group) return res.status(404).json({ error: "分组不存在" });

        const names = parseNames(body.text);
        if (names.length === 0) {
          return res.status(400).json({ error: "没识别出名字，请一行一个名字粘贴" });
        }

        // 组内已有名字，用于重名判断
        const existing = await listGroupMembers(gid, true);
        const existingNames = new Set(existing.map((s) => s.name));

        const added = [];
        const cmds = [];
        names.forEach((rawName) => {
          const finalName = dedupeName(rawName, existingNames);
          existingNames.add(finalName);
          const sid = "s" + newId();
          const stu = blankStudent({
            sid,
            name: finalName,
            displayName: finalName,
            school: group.school,
            grade: group.grade,
            gid
          });
          added.push({ sid, name: finalName, renamedFrom: finalName === rawName ? null : rawName });
          cmds.push(["SET", K.student(sid), JSON.stringify(stu)]);
          cmds.push(["ZADD", K.studentIdx(), String(Date.now()), sid]);
          cmds.push([
            "HSET",
            K.studentSum(),
            sid,
            JSON.stringify({
              sid,
              name: stu.name,
              displayName: stu.displayName,
              school: stu.school,
              grade: stu.grade,
              gid,
              subCount: 0,
              createdAt: stu.createdAt
            })
          ]);
          cmds.push(["SADD", K.groupMembers(gid), sid]);
        });

        await redisPipe(cmds);
        return res.status(200).json({ ok: true, added, count: added.length });
      }

      // —— 单个添加 ——
      if (action === "addStudent") {
        const gid = String(body.gid || "");
        const group = await readGroup(gid);
        if (!group) return res.status(404).json({ error: "分组不存在" });
        const raw = String(body.name || "").trim().replace(/\s+/g, "");
        if (!raw) return res.status(400).json({ error: "请填名字" });

        const existing = await listGroupMembers(gid, true);
        const existingNames = new Set(existing.map((s) => s.name));
        const name = dedupeName(raw, existingNames);

        const sid = "s" + newId();
        const stu = blankStudent({
          sid,
          name,
          displayName: name,
          school: group.school,
          grade: group.grade,
          gid
        });
        await writeStudent(stu);
        await redisCmd(["SADD", K.groupMembers(gid), sid]);
        return res.status(200).json({ ok: true, student: { sid, name } });
      }

      // —— 改显示名（sid 不变，历史成绩不受影响）——
      if (action === "renameStudent") {
        const sid = String(body.sid || "");
        const student = await getJSON(K.student(sid));
        if (!student) return res.status(404).json({ error: "学生不存在" });
        const displayName = String(body.displayName || "").trim().replace(/\s+/g, "");
        if (!displayName) return res.status(400).json({ error: "请填名字" });
        student.displayName = displayName;
        await writeStudent(student);
        return res.status(200).json({ ok: true });
      }

      // —— 转班（sid 不变，历史成绩跟着走）——
      if (action === "moveStudent") {
        const sid = String(body.sid || "");
        const gid = String(body.gid || "");
        const student = await getJSON(K.student(sid));
        if (!student) return res.status(404).json({ error: "学生不存在" });
        const target = await readGroup(gid);
        if (!target) return res.status(404).json({ error: "目标分组不存在" });

        const cmds = [];
        if (student.gid && student.gid !== gid) {
          cmds.push(["SREM", K.groupMembers(student.gid), sid]);
        }
        cmds.push(["SADD", K.groupMembers(gid), sid]);
        student.gid = gid;
        student.school = target.school;
        student.grade = target.grade;
        cmds.push(["SET", K.student(sid), JSON.stringify(student)]);
        await redisPipe(cmds);
        return res.status(200).json({ ok: true });
      }

      // —— 从分组移除（学生档案保留，历史成绩不丢）——
      if (action === "removeStudent") {
        const sid = String(body.sid || "");
        const student = await getJSON(K.student(sid));
        if (!student) return res.status(404).json({ error: "学生不存在" });
        if (student.gid) {
          await redisCmd(["SREM", K.groupMembers(student.gid), sid]);
        }
        student.gid = "";
        await setJSON(K.student(sid), student);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "未知的 action：" + action });
    }

    // ══════════ DELETE ══════════
    if (req.method === "DELETE") {
      const body = req.body || {};
      if (!guardTeacher(req, res, body.password)) return;

      // 删分组：默认拒绝删还有学生的分组，避免误删把成绩一起带走
      if (body.gid) {
        const gid = String(body.gid);
        const cnt = Number(await redisCmd(["SCARD", K.groupMembers(gid)])) || 0;
        if (cnt > 0 && !body.force) {
          return res.status(409).json({
            error: `这个分组里还有 ${cnt} 个学生，先删完学生才能删分组`
          });
        }
        await redisPipe([
          ["DEL", K.group(gid)],
          ["DEL", K.groupMembers(gid)],
          ["ZREM", K.groupIdx(), gid]
        ]);
        return res.status(200).json({ ok: true });
      }

      // 删学生：有答卷时同样默认拒绝（成绩是资产，不能误删）
      if (body.sid) {
        const sid = String(body.sid);
        const student = await getJSON(K.student(sid));
        if (!student) return res.status(404).json({ error: "学生不存在" });
        const subCount = Number(await redisCmd(["ZCARD", K.studentSubs(sid)])) || 0;
        if (subCount > 0 && !body.force) {
          return res.status(409).json({
            error: `这个学生已有 ${subCount} 次考试记录，删除会一起丢掉成绩走势，确认请再点一次`
          });
        }
        const cmds = [
          ["DEL", K.student(sid)],
          ["DEL", K.studentSubs(sid)],
          ["ZREM", K.studentIdx(), sid],
          ["HDEL", K.studentSum(), sid]
        ];
        if (student.gid) cmds.push(["SREM", K.groupMembers(student.gid), sid]);
        await redisPipe(cmds);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "缺少 gid 或 sid" });
    }

    return res.status(405).json({ error: "不支持的请求方式" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "服务器错误" });
  }
}
