// 教师密码校验。
//
// 逻辑与 api/submissions.js 里的 checkTeacherPassword 完全一致（同一个
// TEACHER_PASSWORD 环境变量），单独抽出来只是为了让新模块不必重复写、
// 也不必去 import 旧文件（旧文件不动，零回归风险）。

export function checkTeacherPassword(password) {
  const correct = process.env.TEACHER_PASSWORD;
  return !!correct && !!password && password === correct;
}

// 老师接口的统一拦截。返回 true 表示已放行；
// 返回 false 表示已经写好了 401，调用方直接 return 即可。
export function guardTeacher(req, res, password) {
  if (checkTeacherPassword(password)) return true;
  res.status(401).json({ error: "密码错误或未提供，无权访问" });
  return false;
}

// 家长端只用随机 id 当链接凭证，不需要教师密码；
// 这个函数只是把「必须带 id」这条校验统一一下。
export function guardSecretId(id) {
  return typeof id === "string" && id.length >= 8 && /^[a-z0-9]+$/i.test(id);
}
