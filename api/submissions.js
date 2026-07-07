// 学生提交记录的云端存储接口。
//
// 之前家长提交的作业照片和批改结果是存在各自手机浏览器本地的（localStorage），
// 彭老师在自己设备上打开"教师后台"其实看不到家长提交的东西。
// 这个接口把数据统一存到云端数据库（Upstash Redis），这样无论家长用哪台设备提交，
// 彭老师在任何设备上登录教师后台都能看到全部记录。
//
// 需要在 Vercel 项目设置 → Environment Variables 里新增两个环境变量：
//   UPSTASH_REDIS_REST_URL   —— 在 Upstash 创建数据库后得到的 REST API 地址
//   UPSTASH_REDIS_REST_TOKEN —— 同上，对应的访问令牌
// （TEACHER_PASSWORD 复用已有的教师密码环境变量，用来保护"读取/删除"接口，
//  防止别人直接用网址访问接口就能看到所有学生的提交记录。）

async function redisCmd(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("服务器未配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN，请在 Vercel 项目设置里添加这两个环境变量");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(data.error);
  return data.result;
}

function checkTeacherPassword(password) {
  const correct = process.env.TEACHER_PASSWORD;
  return !!correct && !!password && password === correct;
}

export default async function handler(req, res) {
  try {
    // ── 家长提交批改记录：不需要密码，任何家长都可以提交 ──
    if (req.method === "POST") {
      const { submission } = req.body || {};
      if (!submission || !submission.id) {
        return res.status(400).json({ error: "缺少提交内容" });
      }
      const summary = {
        id: submission.id,
        timestamp: submission.timestamp,
        studentName: submission.studentName,
        score: submission.score,
        overall: submission.overall,
        issueCount: submission.issueCount,
        problemCount: submission.problemCount,
        problemTypes: submission.problemTypes
      };
      const existingRaw = await redisCmd(["GET", "submissions_index"]);
      let list = [];
      try { list = existingRaw ? JSON.parse(existingRaw) : []; } catch (_) { list = []; }
      list.unshift(summary);
      if (list.length > 200) list = list.slice(0, 200); // 保留最近200条，避免数据无限增长
      await redisCmd(["SET", "submissions_index", JSON.stringify(list)]);
      await redisCmd(["SET", "submission_" + submission.id, JSON.stringify(submission)]);
      return res.status(200).json({ ok: true });
    }

    // ── 教师后台读取记录：需要教师密码 ──
    if (req.method === "GET") {
      const { password, id } = req.query || {};
      if (!checkTeacherPassword(password)) {
        return res.status(401).json({ error: "密码错误或未提供，无权访问" });
      }
      if (id) {
        const raw = await redisCmd(["GET", "submission_" + id]);
        return res.status(200).json({ value: raw ? JSON.parse(raw) : null });
      }
      const raw = await redisCmd(["GET", "submissions_index"]);
      return res.status(200).json({ value: raw ? JSON.parse(raw) : [] });
    }

    // ── 教师后台删除记录：需要教师密码 ──
    if (req.method === "DELETE") {
      const { id, password } = req.body || {};
      if (!checkTeacherPassword(password)) {
        return res.status(401).json({ error: "密码错误或未提供，无权删除" });
      }
      if (!id) return res.status(400).json({ error: "缺少 id" });
      await redisCmd(["DEL", "submission_" + id]);
      const raw = await redisCmd(["GET", "submissions_index"]);
      let list = [];
      try { list = raw ? JSON.parse(raw) : []; } catch (_) { list = []; }
      list = list.filter(x => x.id !== id);
      await redisCmd(["SET", "submissions_index", JSON.stringify(list)]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "不支持的请求方式" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "服务器错误" });
  }
}
