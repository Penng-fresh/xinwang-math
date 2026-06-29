// 教师后台密码校验：真正的密码值只存在于 Vercel 环境变量 TEACHER_PASSWORD 里，
// 前端代码和浏览器永远看不到它，只会看到"对/错"这个判断结果。

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "只支持 POST 请求" });
  }

  const correctPassword = process.env.TEACHER_PASSWORD;
  if (!correctPassword) {
    return res.status(500).json({ error: "服务器未配置 TEACHER_PASSWORD，请在 Vercel 项目设置里添加环境变量" });
  }

  const { password } = req.body || {};
  if (password === correctPassword) {
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "密码错误，请重试" });
}
