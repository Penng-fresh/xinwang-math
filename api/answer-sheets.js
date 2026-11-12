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
//   GET  ?view=list&password=  老师端：收到的答题卡（可按 gid / examId 过滤）
//   GET  ?view=img&id&n&password=  老师端：取第 n 张图片的 base64
//   GET  ?view=mine&sid=       家长端：这个学生已经传了几份
//   DELETE { id, password }    老师端：删除一份

import { guardTeacher } from "./lib/auth.js";
import { K, redisCmd, redisPipe, getJSON, newId } from "./lib/store.js";

// 一次最多三张：期中数学答题卡通常 A4 双面或 A3 单面，三张足够。
// 不放大是因为 Vercel 函数请求体上限 4.5MB，前端压到 ~70 万字符一张，
// 三张约 2.1MB，留出了余量。
const MAX_IMAGES = 3;
const MAX_CHARS_PER_IMAGE = 1_200_000;
const MAX_CHARS_TOTAL = 3_000_000;

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
    note: s.note || "",
    createdAt: s.createdAt,
  };
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
      const sid = String(body.sid || "");
      if (!gid) return res.status(400).json({ error: "没有选班级" });
      if (!sid) return res.status(400).json({ error: "没有选学生" });

      // 学生必须真的在这个班里。否则前端被改（或 sid 抄错）会把答题卡挂到别人名下，
      // 而这种错在分析报告里完全看不出来 —— 宁可在这里挡住。
      const isMember = await redisCmd(["SISMEMBER", K.groupMembers(gid), sid]);
      if (Number(isMember) !== 1) {
        return res.status(400).json({ error: "这个学生不在所选班级里，请重新选择" });
      }

      const group = await getJSON(K.group(gid));
      if (!group) return res.status(404).json({ error: "这个班级不存在，请刷新页面重选" });

      const student = await getJSON(K.student(sid));
      if (!student) return res.status(404).json({ error: "找不到这个学生，请刷新页面重选" });

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
      if (list.length > MAX_IMAGES) return res.status(400).json({ error: `一次最多传 ${MAX_IMAGES} 张` });

      let totalChars = 0;
      const images = [];
      const cmds = [];
      const id = newId();

      for (let i = 0; i < list.length; i++) {
        const raw = String(list[i]?.data || "");
        // Vercel 会把超长 body 直接掐掉，到这里应已是完整 base64。
        // 只做长度和字符集检查：内容是否真的是图片，等以后渲染时自然会暴露，
        // 现在没有识别环节，不必为此多花一次往返。
        if (!raw) return res.status(400).json({ error: `第 ${i + 1} 张图片是空的` });
        if (raw.length > MAX_CHARS_PER_IMAGE) {
          return res.status(413).json({ error: `第 ${i + 1} 张图片太大，请用手机相册里的原图重新选一次（不要用文件管理器压缩过的版本）` });
        }
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw.slice(0, 200)) || !/^[A-Za-z0-9+/=\r\n]+$/.test(raw.slice(-200))) {
          return res.status(400).json({ error: `第 ${i + 1} 张图片数据不完整，请重选一次` });
        }
        totalChars += raw.length;

        const chunks = [];
        for (let p = 0; p < raw.length; p += CHUNK) chunks.push(raw.slice(p, p + CHUNK));
        cmds.push(["RPUSH", K.sheetImg(id, i), ...chunks]);

        const mediaType = String(list[i]?.mediaType || "image/jpeg");
        images.push({ n: i, mediaType: mediaType.startsWith("image/") ? mediaType : "image/jpeg", chars: raw.length, chunks: chunkCount(raw.length) });
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

      return res.status(200).json({ ok: true, id, imageCount: images.length, examName: meta.examName, studentName: meta.studentName });
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
