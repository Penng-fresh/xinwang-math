// 答题卡收集（家长上传 —— 当前阶段只收，不识别）
//
// 为什么这一版只收不判：
//   要判断"这 3 分丢在该丢还是不该丢"，前提是老师已经把这份卷子按难度分过类。
//   这个前提在期中考试之前不成立。所以现在把家长手上最稀缺的东西先收下来——
//   考完那几天答题卡还在，过两周就找不到了。分析能力后补，原件补不回来。
//
// 为什么不让学生自己填名字：
//   名字是唯一能把答题卡和人对上的东西，手打会出现各种同音字、小名、错字。
//   家长从名单里点一个，sid 直接带进库里，后面所有分析都靠它，不能有歧义。
//
// 图片为什么不跟元数据放在一起：
//   一张 2000px 的答题卡照片 base64 有 40~70 万字符。塞进 meta 的话，
//   老师每刷一次列表就要把几十兆全读一遍。图片单独按 list 切片存，
//   列表页只读 meta，点开某一份才取字节。
//
// 接口：
//   POST                       家长上传 { gid, sid, examId?, note?, images:[{data,mediaType}] }
//   GET  ?view=list&password=  老师端：收到的答题卡，逐份（可按 gid / examId 过滤）
//   GET  ?view=students&password=  老师端：按学生聚合，一人一行带历次（可按 gid 过滤）
//   GET  ?view=img&id&n&password=  老师端：取第 n 张图片的 base64
//   GET  ?view=mine&sid=       家长端：这个学生已经传了几份
//   DELETE { id, password }    老师端：删除一份
//   PATCH  { id, examId, password }  老师端：把这改挂到某场考试（examId 为空 = 取消挂靠）

import { guardTeacher } from "../lib/auth.js";
import { K, redisCmd, redisPipe, getJSON, getHash, newId } from "../lib/store.js";

// 一次最多三张：期中数学答题卡通常 A4 双面或 A3 单面，三张足够。
// 不放大是因为 Vercel 函数请求体上限 4.5MB，前端压到 ~70 万字符一张，
// 三张约 2.1MB，留出了余量。
// 一份答题卡六到八页是常态，一页一张才看得清，所以给到 9。
// 整份拼成一张的长图也收，但那种图每页只剩两三百像素，前端会当场提示。
const MAX_IMAGES = 9;
// 图片走前端压缩，正常落在 70 万字符以内；PDF 不能重编码，只能整份塞，
// 前端已把上限卡在 2MB 文件（base64 约 280 万字符）。两个上限分开写，
// 免得一张异常大的图也能顶到 PDF 的额度。
const MAX_CHARS_PER_IMAGE = 1_200_000;
const MAX_CHARS_PER_PDF = 2_800_000;
const MAX_CHARS_TOTAL = 3_600_000;

// 单条 Redis 命令的 value 不宜过大，切成一节节存进 list。
// 前端基本都能压到一节以内，这里只是防止个别原图直接打进来。
const CHUNK = 600_000;

function chunkCount(len) {
  return Math.max(1, Math.ceil(len / CHUNK));
}

async function loadMany(ids) {
  if (!ids || ids.length === 0) return [];
  const vals = await redisCmd(["MGET", ...ids.map((id) => K.sheet(id))]);
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

// 列表里逐条显示用的字段（不含图片字节）
function listView(s) {
  return {
    id: s.id,
    gid: s.gid,
    school: s.school,
    grade: s.grade,
    groupName: s.groupName,
    sid: s.sid,
    studentName: s.studentName,
    examId: s.examId || "",
    examName: s.examName || "",
    examDate: s.examDate || "",
    imageCount: s.imageCount || 0,
    // 前端要按类型分别渲染：图片能直接给 <img>，PDF 只能给下载/新窗口打开
    kinds: (s.images || []).map((im) => (im.mediaType === "application/pdf" ? "pdf" : "image")),
    source: s.source || "parent",
    note: s.note || "",
    createdAt: s.createdAt,
  };
}

// ── 学生身份：按姓名 find-or-create ──────────────────────
//
// 为什么从「老师先导名单、家长点选」改成「家长手输姓名、系统认领」：
//   1) 要我提前把 60 个名字录进去，是纯增加的负担，而且每次接新班都要做一遍；
//   2) 家长在页面上看到全班同学的名字，是一种轻微的暴露，换谁都不太舒服。
//
// 代价必须说清：没有花名册，就永远不知道「谁还没交」，后台只能数
// 「收到几份」。老师带班知道自己班几个人，够不够心里有数，但具体是谁缺，
// 得去群里问。
//
// 匹配键是「班级 + 姓名」。同一个名字出现两次就复用同一条记录 ——
// 这依赖一个约定：换学期请直接改分组名（学生名单页有「改分组信息」），
// 不要新建分组。新建了 gid 就变，同一个孩子的历史会断成两截。
async function ensureStudent({ gid, school, grade, rawName }) {
  const name = String(rawName || "").replace(/\s+/g, "").trim();
  if (!name) return { error: "请先填孩子的姓名" };
  if (name.length > 20) return { error: "姓名太长了，只填名字就行" };

  const sids = (await redisCmd(["SMEMBERS", K.groupMembers(gid)])) || [];
  if (sids.length > 0) {
    const sums = await getHash(K.studentSum(), sids);
    for (let i = 0; i < sids.length; i++) {
      const s = sums[sids[i]];
      if (s && (s.name === name || s.displayName === name)) {
        const full = await getJSON(K.student(sids[i]));
        if (full) return { sid: sids[i], student: full };
      }
    }
  }

  const sid = "s" + newId();
  const stu = {
    sid,
    name,
    displayName: name,
    school: school || "",
    grade: grade || "",
    gid,
    createdAt: new Date().toISOString(),
    subCount: 0,
    series: [],
    highlights: {},
  };

  // 跟 roster.js 建学生的写法保持一致，家长自建的也能出现在「学生名单」页签里
  await redisPipe([
    ["SET", K.student(sid), JSON.stringify(stu)],
    ["ZADD", K.studentIdx(), String(Date.now()), sid],
    ["HSET", K.studentSum(), sid, JSON.stringify({
      sid, name, displayName: name, school: stu.school, grade: stu.grade, gid,
      subCount: 0, createdAt: stu.createdAt,
    })],
    ["SADD", K.groupMembers(gid), sid],
  ]);

  return { sid, student: stu, created: true };
}

export default async function handler(req, res) {
  try {
    // ══════════ 查询 ══════════
    if (req.method === "GET") {
      const q = req.query || {};
      const view = q.view || "list";

      // —— 老师端：按时间倒序列出收到的答题卡 ——
      if (view === "list") {
        if (!guardTeacher(req, res, q.password)) return;

        let ids;
        if (q.examId) {
          ids = await redisCmd(["ZREVRANGE", K.examSheets(String(q.examId)), "0", "199"]);
        } else if (q.gid) {
          ids = await redisCmd(["ZREVRANGE", K.groupSheets(String(q.gid)), "0", "199"]);
        } else {
          ids = await redisCmd(["ZREVRANGE", K.sheetIdx(), "0", "199"]);
        }
        const sheets = await loadMany(ids || []);

        // 按学生去重算「涉及几个学生」，比单纯数份数有用：
        // 一个孩子传了两页，不能算作两个人交过。
        const sids = new Set(sheets.map((s) => s.sid));
        return res.status(200).json({
          ok: true,
          sheets: sheets.map(listView),
          stats: { count: sheets.length, students: sids.size },
        });
      }

      // —— 老师端：按学生聚合 ——
      //
      // 家长是手填姓名的，同一个孩子一学期传三四份是常态（每考一次传一次）。
      // 逐份清单看不出"这个孩子这几次都交了没"，所以单给一个按人聚合的视图。
      //
      // 为什么不在前端聚合：前端也能做，但老师切班级、刷新时都要把两百条重算一遍；
      // 而且"谁交了几次"是第一眼要判断的东西，服务端一次算好直接给。
      // 这里只多读一条 ZSET，不多花一次往返。
      if (view === "students") {
        if (!guardTeacher(req, res, q.password)) return;

        // 考试优先于班级：选了考试就是"这一场谁交了"，
        // 这是唯一能让"谁还没交"这句话站得住的口径。
        let ids;
        if (q.examId) {
          ids = await redisCmd(["ZREVRANGE", K.examSheets(String(q.examId)), "0", "499"]);
        } else if (q.gid) {
          ids = await redisCmd(["ZREVRANGE", K.groupSheets(String(q.gid)), "0", "499"]);
        } else {
          ids = await redisCmd(["ZREVRANGE", K.sheetIdx(), "0", "499"]);
        }
        const sheets = await loadMany(ids || []);

        const bySid = new Map();
        for (const s of sheets) {
          const sid = String(s.sid || "");
          // 早期数据可能没有 sid（点选名单那一版之前的），归不进去就跳过，
          // 逐份视图里还看得到，不至于丢。
          if (!sid) continue;
          let g = bySid.get(sid);
          if (!g) {
            g = {
              sid,
              name: s.studentName || "",
              school: s.school || "",
              groupName: s.groupName || "",
              gid: s.gid || "",
              count: 0,
              lastAt: 0,
              lastExam: "",
              sheets: []
            };
            bySid.set(sid, g);
          }
          g.count += 1;
          if ((s.createdAt || 0) >= g.lastAt) {
            g.lastAt = s.createdAt || 0;
            g.lastExam = s.examName || "";
          }
          const v = listView(s);
          g.sheets.push({
            id: v.id,
            examId: v.examId,
            examName: v.examName,
            examDate: v.examDate,
            imageCount: v.imageCount,
            kinds: v.kinds,
            source: v.source,
            note: v.note,
            createdAt: v.createdAt
          });
        }

        const list = [...bySid.values()].sort((a, b) => b.lastAt - a.lastAt);
        list.forEach((g) => g.sheets.sort((a, b) => b.createdAt - a.createdAt));

        return res.status(200).json({
          ok: true,
          students: list,
          stats: { students: list.length, count: sheets.length }
        });
      }

      // —— 老师端：取某一份的第 n 张图 ——
      if (view === "img") {
        if (!guardTeacher(req, res, q.password)) return;
        const id = String(q.id || "");
        const n = Number(q.n || 0);
        if (!id) return res.status(400).json({ error: "缺少 id" });
        const meta = await getJSON(K.sheet(id));
        if (!meta) return res.status(404).json({ error: "找不到这份答题卡" });
        const img = (meta.images || [])[n];
        if (!img) return res.status(404).json({ error: "这份答题卡没有第 " + (n + 1) + " 张图" });

        const parts = await redisCmd(["LRANGE", K.sheetImg(id, n), "0", "-1"]);
        const data = (parts || []).join("");
        if (!data) return res.status(404).json({ error: "图片内容丢失（可能未存完）" });
        return res.status(200).json({ ok: true, mediaType: img.mediaType || "image/jpeg", data });
      }

      // —— 家长端：这个学生已经传过几份 ——
      // sid 是 12 位随机串，猜不到别人的；这里只回份数，不回内容。
      if (view === "mine") {
        const sid = String(q.sid || "");
        if (!sid) return res.status(400).json({ error: "缺少学生 id" });
        const ids = (await redisCmd(["ZREVRANGE", K.studentSheets(sid), "0", "19"])) || [];
        const sheets = await loadMany(ids);
        return res.status(200).json({
          ok: true,
          count: sheets.length,
          sheets: sheets.map((s) => ({ id: s.id, examName: s.examName || "", imageCount: s.imageCount || 0, createdAt: s.createdAt })),
        });
      }

      return res.status(400).json({ error: "不认识的查询" });
    }

    // ══════════ 上传 ══════════
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

      const gid = String(body.gid || "");
      if (!gid) return res.status(400).json({ error: "没有选班级" });

      const group = await getJSON(K.group(gid));
      if (!group) return res.status(404).json({ error: "这个班级不存在，请刷新页面重选" });

      // 身份解析：老家长带着 sid 来（本机记过），新家长只有名字。
      // 名字走 find-or-create —— 这是刻意的，见下面 ensureStudent 的注释。
      let sid = String(body.sid || "");
      let student = null;

      if (sid) {
        // 学生必须真的在这个班里。否则前端被改（或 sid 抄错）会把答题卡挂到别人名下，
        // 而这种错在分析报告里完全看不出来 —— 宁可在这里挡住。
        const isMember = await redisCmd(["SISMEMBER", K.groupMembers(gid), sid]);
        if (Number(isMember) !== 1) {
          return res.status(400).json({ error: "这个学生不在所选班级里，请重新填写姓名" });
        }
        student = await getJSON(K.student(sid));
        if (!student) return res.status(404).json({ error: "找不到这个学生，请重新填写姓名" });
      } else {
        const r = await ensureStudent({
          gid,
          school: group.school || "",
          grade: group.grade || "",
          rawName: body.studentName
        });
        if (r.error) return res.status(400).json({ error: r.error });
        sid = r.sid;
        student = r.student;
      }

      // 考试是可选的：老师还没建考试的时候，家长照样能传，
      // 先按「未指定考试」收着，等卷子结构有了再挂上去，不阻塞收集。
      let exam = null;
      const examId = String(body.examId || "");
      if (examId) {
        exam = await getJSON(K.exam(examId));
        if (!exam) return res.status(404).json({ error: "这场考试不存在，请刷新页面重选" });
        if (exam.status !== "open") return res.status(409).json({ error: "这场考试已经停止上传了" });
        if (exam.gid !== gid) return res.status(400).json({ error: "这场考试不属于这个班级" });
      }

      const list = Array.isArray(body.images) ? body.images : [];
      if (list.length === 0) return res.status(400).json({ error: "还没有选答题卡照片" });
      if (list.length > MAX_IMAGES) return res.status(400).json({ error: `一次最多 ${MAX_IMAGES} 份。答题卡页多就分两次传，都会挂到同一个学生名下。` });

      let totalChars = 0;
      const images = [];
      const cmds = [];
      const id = newId();

      for (let i = 0; i < list.length; i++) {
        const raw = String(list[i]?.data || "");
        // Vercel 会把超长 body 直接掐掉，到这里应已是完整 base64。
        // 只做长度和字符集检查：内容是否真的是图片，等以后渲染时自然会暴露，
        // 现在没有识别环节，不必为此多花一次往返。
        if (!raw) return res.status(400).json({ error: `第 ${i + 1} 份是空的` });

        const rawType = String(list[i]?.mediaType || "image/jpeg");
        const mediaType = rawType === "application/pdf" ? "application/pdf" : rawType.startsWith("image/") ? rawType : "image/jpeg";
        const isPdf = mediaType === "application/pdf";
        const cap = isPdf ? MAX_CHARS_PER_PDF : MAX_CHARS_PER_IMAGE;

        if (raw.length > cap) {
          return res.status(413).json({
            error: isPdf
              ? `第 ${i + 1} 份 PDF 太大，传不了。超过 2MB 的请重存一份小的，或者直接拍答题卡。`
              : `第 ${i + 1} 张图片太大，请用手机相册里的原图重新选一次（不要用文件管理器压缩过的版本）`,
          });
        }
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw.slice(0, 200)) || !/^[A-Za-z0-9+/=\r\n]+$/.test(raw.slice(-200))) {
          return res.status(400).json({ error: `第 ${i + 1} 份数据不完整，请重选一次` });
        }
        totalChars += raw.length;

        const chunks = [];
        for (let p = 0; p < raw.length; p += CHUNK) chunks.push(raw.slice(p, p + CHUNK));
        cmds.push(["RPUSH", K.sheetImg(id, i), ...chunks]);

        images.push({ n: i, mediaType, chars: raw.length, chunks: chunkCount(raw.length) });
      }

      if (totalChars > MAX_CHARS_TOTAL) {
        return res.status(413).json({ error: "几张照片加起来太大了，减到两张、或者重新拍一次" });
      }

      const now = Date.now();
      const meta = {
        id,
        gid,
        school: group.school || student.school || "",
        grade: group.grade || student.grade || "",
        groupName: group.name || "",
        sid,
        studentName: student.displayName || student.name || "",
        examId: exam ? exam.id : "",
        examName: exam ? exam.name : "",
        examDate: exam ? exam.date : "",
        images,
        imageCount: images.length,
        note: String(body.note || "").trim().slice(0, 200),
        // 家长自己传的 / 老师从微信里收到后代传的。以后要核对"这个孩子到底交没交"时，
        // 这两种来源的可信度不一样，先记下。
        source: body.source === "teacher" ? "teacher" : "parent",
        createdAt: now,
      };

      const pipe = [
        ["SET", K.sheet(id), JSON.stringify(meta)],
        ...cmds,
        ["ZADD", K.sheetIdx(), String(now), id],
        ["ZADD", K.groupSheets(gid), String(now), id],
        ["ZADD", K.studentSheets(sid), String(now), id],
      ];
      if (exam) pipe.push(["ZADD", K.examSheets(exam.id), String(now), id]);

      await redisPipe(pipe);

      // 把 sid 回给前端，这台设备下次直接用 sid 认人，不必再按名字匹配
      return res.status(200).json({ ok: true, id, sid, imageCount: images.length, examName: meta.examName, studentName: meta.studentName });
    }

    // ══════════ 改挂考试 ══════════
    //
    // 家长上传时考试是可选的（老师还没建考试时不能卡住收集）。但"可选"要能后补：
    // 没挂考试的那几份，按考试筛选时永远不出现，"这场谁没交"就会冤枉已经交了的人。
    // 这里只改归属，不动图片字节。
    if (req.method === "PATCH") {
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

      const id = String(body.id || "");
      const meta = await getJSON(K.sheet(id));
      if (!meta) return res.status(404).json({ error: "找不到这份答题卡" });

      const want = String(body.examId || "");
      let exam = null;
      if (want) {
        exam = await getJSON(K.exam(want));
        if (!exam) return res.status(404).json({ error: "这场考试不存在" });
        // 挂错班会把成绩张冠李戴，且在看板上完全看不出来，必须挡
        if (exam.gid !== meta.gid) return res.status(400).json({ error: "这场考试不属于这份答题卡的班级" });
      }

      if ((meta.examId || "") === want) return res.status(200).json({ ok: true, unchanged: true });

      const next = {
        ...meta,
        examId: exam ? exam.id : "",
        examName: exam ? exam.name : "",
        examDate: exam ? exam.date : ""
      };

      const pipe = [["SET", K.sheet(id), JSON.stringify(next)]];
      if (meta.examId) pipe.push(["ZREM", K.examSheets(meta.examId), id]);
      if (exam) pipe.push(["ZADD", K.examSheets(exam.id), String(meta.createdAt || Date.now()), id]);
      await redisPipe(pipe);

      return res.status(200).json({ ok: true, examId: next.examId, examName: next.examName });
    }

    // ══════════ 删除 ══════════
    if (req.method === "DELETE") {
      const body = req.body || {};
      if (!guardTeacher(req, res, body.password)) return;
      const id = String(body.id || "");
      const meta = await getJSON(K.sheet(id));
      if (!meta) return res.status(404).json({ error: "找不到这份答题卡" });

      const cmds = [
        ["DEL", K.sheet(id)],
        ["ZREM", K.sheetIdx(), id],
        ["ZREM", K.groupSheets(meta.gid), id],
        ["ZREM", K.studentSheets(meta.sid), id],
      ];
      if (meta.examId) cmds.push(["ZREM", K.examSheets(meta.examId), id]);
      (meta.images || []).forEach((im) => cmds.push(["DEL", K.sheetImg(id, im.n)]));

      await redisPipe(cmds);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "不支持的方法" });
  } catch (e) {
    console.error("[answer-sheets]", e?.message);
    return res.status(500).json({ error: "服务器出错：" + (e?.message || "未知") });
  }
}
