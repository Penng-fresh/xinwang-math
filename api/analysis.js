// AI 分析结果查询 + 老师手动重跑。
//
// 上传后会自动触发分析，但三种情况需要手动再来一次：
//   1) 当时没配卷子结构，配好后重跑
//   2) AI 超时 / 读图失败
//   3) 老师补传了更清晰的图，想覆盖旧结果
//
// 接口：
//   GET  ?id=xxx&password=xxx            老师端：查一份的分析结果
//   GET  ?view=many&ids=a,b,c&password=  老师端：一次查多份（列表页用）
//   GET  ?view=mine&id=xxx&sid=xxx       家长端：只看自己那一份的结论
//   POST { id, sid }                     上传页：自动触发（只回家长可见字段）
//   POST { id, password }                老师端：手动重跑（同步等结果）

import { guardTeacher } from "../lib/auth.js";
import { K, getJSON } from "../lib/store.js";
import { runAnalysis } from "../lib/analyze.js";

function publicView(a) {
  if (!a) return null;
  return {
    id: a.id,
    status: a.status || "pending",
    ok: !!a.ok,
    error: a.error || "",
    createdAt: a.createdAt || "",
    updatedAt: a.updatedAt || "",
    paperTitle: a.paperTitle || "",
    totalScore: a.totalScore || 0,
    score: a.score || null,
    rows: a.rows || [],
    groups: a.groups || null,
    lost: a.lost || null,
    worst: a.worst || null,
    check: a.check || null,
    levelNames: a.levelNames || null,
    sourceImages: a.sourceImages || 0,
    analyzedFirstOnly: !!a.analyzedFirstOnly,
  };
}

// 家长端只看结论，不看老师内部的校验细节、原始读数和模型备注。
// 尤其不能把 check.problems 里的"各题相加与总分不一致"原样给家长 ——
// 那是老师核对用的，给家长只会制造焦虑。统一说"需要老师复核"就够了。
function publicFamilyView(a) {
  if (!a) return null;
  const groups = a.groups || {};
  const brief = (list) =>
    (Array.isArray(list) ? list : []).map((r) => ({
      label: r.label || "",
      name: r.name || "",
      lost: r.lost || 0,
    }));
  return {
    status: a.status || "pending",
    ok: !!a.ok,
    error: a.error || "",
    total: a.score?.total ?? null,
    lost: a.lost || null,
    groups: {
      base: brief(groups.base),
      mid: brief(groups.mid),
      hard: brief(groups.hard),
    },
    needsReview: !!(a.check?.missing?.length || a.check?.problems?.length),
  };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const q = req.query || {};

    // 家长端：只凭 sheet id + 学生 id 读自己那一份的结论。
    // sid 是随机串，且必须和答题卡档案里的 sid 完全一致，猜不到别人的。
    if (q.view === "mine") {
      const id = String(q.id || "");
      const sid = String(q.sid || "");
      if (!id || !sid) return res.status(400).json({ error: "缺少参数" });
      const sheet = await getJSON(K.sheet(id));
      if (!sheet || String(sheet.sid || "") !== sid) {
        return res.status(404).json({ error: "找不到这份分析" });
      }
      return res.status(200).json({
        ok: true,
        analysis: publicFamilyView(await getJSON(K.analysis(id))),
      });
    }

    if (!guardTeacher(req, res, q.password)) return;

    if (q.view === "many") {
      const ids = String(q.ids || "").split(",").filter(Boolean).slice(0, 50);
      const out = {};
      for (const id of ids) {
        out[id] = publicView(await getJSON(K.analysis(id)));
      }
      return res.status(200).json({ ok: true, analyses: out });
    }

    const id = String(q.id || "");
    if (!id) return res.status(400).json({ error: "缺少答题卡 id" });
    return res.status(200).json({ ok: true, analysis: publicView(await getJSON(K.analysis(id))) });
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: "请求格式不对" }); }
    }
    body = body || {};

    const id = String(body.id || "");
    if (!id) return res.status(400).json({ error: "缺少答题卡 id" });

    const meta = await getJSON(K.sheet(id));
    if (!meta) return res.status(404).json({ error: "找不到这份答题卡" });

    // 两条路：
    //   1) 老师带密码手动重跑，返回完整报告字段；
    //   2) 上传页面刚拿到 id/sid 后立刻触发，sid 必须和档案一致，只回家长可见字段。
    // 第二条是自动分析真正可靠的触发点：上传函数里 fire-and-forget 会被 Vercel 冻结，
    // 而这个 POST 是独立的函数请求，前台不 await 它也能跑完。
    const password = String(body.password || "");
    const sid = String(body.sid || "");
    let familyOnly = false;

    if (password) {
      if (!guardTeacher(req, res, password)) return;
    } else if (sid) {
      if (String(meta.sid || "") !== sid) return res.status(403).json({ error: "不能分析这份答题卡" });
      familyOnly = true;
      const old = await getJSON(K.analysis(id));
      if (old && (old.status === "running" || old.status === "done")) {
        return res.status(200).json({ ok: !!old.ok, analysis: publicFamilyView(old) });
      }
    } else {
      return res.status(401).json({ error: "缺少触发凭证" });
    }

    // 同步等结果：老师点了按钮，就让他当场看到成功还是失败；
    // 上传页那边不 await，家长看到的是上传成功 + 稍后的结论。
    try {
      const result = await runAnalysis(id);
      return res.status(200).json({
        ok: !!result.ok,
        analysis: familyOnly ? publicFamilyView(result) : publicView(result),
      });
    } catch (e) {
      return res.status(502).json({ error: e?.message || "分析失败" });
    }
  }

  return res.status(405).json({ error: "只支持 GET / POST" });
}
