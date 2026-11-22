// AI 卷面分析：读红笔分 → 按卷子结构归类 → 存回结果。
//
// 这个文件被两处调用：
//   1) answer-sheets.js 上传成功后自动触发（不阻塞上传响应）
//   2) analysis.js 老师手动重试
// 两处走同一套逻辑，避免"自动分析"和"手动重跑"结果不一致。
//
// 设计原则（跟 exam-analyze.js 一致，但这里是落库版）：
//   - 只读红笔手写分，印刷的满分数字不当得分
//   - 每个数字独立读，绝不为凑总分而改数
//   - 读不出就标 null / 待核对，绝不猜
//   - 分析失败绝不影响答题卡本身 —— 原件收下来才是第一位

import { visionJSON, aiConfigured } from "./ai.js";
import { K, redisCmd, getJSON, setJSON } from "./store.js";

const LEVEL_NAME = { base: "不该丢", mid: "讲过", hard: "压轴" };

// 一份答题卡最多送几张图给 AI。拼图 8 页一张就够了；
// 一页一张的传到 4 张以上，AI 读不过来也容易串页，这里封顶。
const MAX_IMAGES = 6;

function buildSystem(paper) {
  const lines = (paper.sections || []).map(
    (s, i) => `${i + 1}. key="${s.key}"  卷面位置：${s.label}  满分 ${s.fullScore} 分`
  );

  return `你在帮一位初中数学老师读试卷分数。用户提供的是智学网的「作答原卷」截图
（学生答题卡的扫描件，上面有老师用红笔手写的得分）。

这份卷子的大题结构如下（满分是印刷的，得分是红笔手写的，两者常常不同）：
${lines.join("\n")}

你要做的是：把每一块的红笔得分读出来，以及左上角的总分。

读数字的规则，严格遵守：
1. 只读红笔（或彩色粗笔）手写的得分数字。学生自己写的铅笔/黑笔答案不要读。
2. 印刷文字里的"满分 36"这种 36 是满分不是得分。得分是老师另写的红字。
3. 某个大题的红字被遮挡、太模糊、或根本找不到，value 填 null。
   绝对不要猜，更不要用"满分减一点"凑一个数。
4. 不要把不同大题的分数张冠李戴。卷面上的题号（21、22、23）和上面的 label 对应。
5. 每个数字必须**独立**照你看到的读。绝不能为了让"各题相加=总分"而回头改任何数字。
   模型曾经为了凑总数把 85 改成 95，这种"自作聪明"比单纯读错危害大得多。
6. 不要做任何评价、分析、建议。只返回 JSON。

返回格式（严格 JSON，不要 markdown 代码块，不要额外说明）：
{
  "total": 总分数字或null,
  "sections": [{"key":"上面给的key", "value":数字或null, "raw":"你在图上看到的原文"}],
  "notes": "看不清或有疑问的地方，一句话；没有就空字符串"
}`;
}

function align(paper, got) {
  const byKey = new Map();
  for (const s of got?.sections || []) {
    if (s && s.key) byKey.set(String(s.key), s);
  }
  return (paper.sections || []).map((s) => {
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
      invalid: value !== null && (value < 0 || value > s.fullScore),
    };
  });
}

// 归类 + 校验。跟 exam-analyze.js 的 summarize 同口径，
// 这样后台看到的三档和将来家长报告里的三档是同一套数字。
function summarize(paper, rows, total, aiNotes) {
  const missing = rows.filter((r) => r.score === null || r.invalid).map((r) => r.label);
  const known = rows.filter((r) => r.score !== null && !r.invalid);
  const sumGot = known.reduce((n, r) => n + r.score, 0);
  const sumFullAll = rows.reduce((n, r) => n + r.fullScore, 0);

  const allRead = missing.length === 0;
  const sumOk = allRead && total !== null && sumGot === total;

  const problems = [];
  if (!allRead) problems.push(`有 ${missing.length} 个大题没读出来（${missing.join("、")}）`);
  if (allRead && total === null) problems.push("总分没读出来");
  if (allRead && total !== null && sumGot !== total) {
    problems.push(`各题得分相加是 ${sumGot}，卷面总分写的是 ${total}，差 ${Math.abs(sumGot - total)} 分`);
  }
  if (sumFullAll !== paper.totalScore) {
    problems.push(`卷子结构满分合计 ${sumFullAll}，与设定总分 ${paper.totalScore} 不一致`);
  }

  const groups = { base: [], mid: [], hard: [] };
  for (const r of known) {
    const lost = r.fullScore - r.score;
    if (lost <= 0) continue;
    const g = groups[r.level] ? r.level : "base";
    groups[g].push({
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

  const worst = known
    .map((r) => ({ label: r.label, name: r.name, lost: r.fullScore - r.score }))
    .filter((r) => r.lost > 0)
    .sort((a, b) => b.lost - a.lost)[0] || null;

  return {
    score: { total, sumGot, sumFullAll, lostAll: lostBase + lostMid + lostHard },
    rows,
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

// 写状态。分析过程中的每一步都落库，后台能看到 pending → running → done/error。
async function save(id, patch) {
  const prev = (await getJSON(K.analysis(id))) || {};
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  await setJSON(K.analysis(id), next);
  return next;
}

/**
 * 跑一份答题卡的分析。
 * @param {string} id sheet id
 * @returns {object} 最终分析结果（失败也返回结果对象，不抛）
 */
export async function runAnalysis(id) {
  if (!id) return { ok: false, status: "error", error: "缺少答题卡 id" };
  if (!aiConfigured()) {
    return save(id, { status: "error", ok: false, error: "AI 未配置（缺少密钥）" });
  }

  await save(id, { status: "running", ok: false, error: "", id });

  try {
    const meta = await getJSON(K.sheet(id));
    if (!meta) throw new Error("找不到这份答题卡");

    const exam = await getJSON(K.exam(meta.examId));
    const paper = exam?.paper;
    if (!paper || !Array.isArray(paper.sections) || paper.sections.length === 0) {
      return save(id, {
        status: "pending",
        ok: false,
        error: "这场考试还没配卷子结构，配好后可重新分析",
      });
    }

    // 逐张取图。图片切片在 Redis list 里，拼回来就是 base64。
    const images = [];
    for (let n = 0; n < Math.min(meta.imageCount || 0, MAX_IMAGES); n++) {
      const parts = await redisCmd(["LRANGE", K.sheetImg(id, n), "0", "-1"]);
      const data = (parts || []).join("");
      if (!data) continue;
      const im = (meta.images || [])[n] || {};
      if (im.mediaType === "application/pdf") continue; // PDF 不送视觉模型
      images.push({ data, mediaType: im.mediaType || "image/jpeg", n });
    }
    if (images.length === 0) throw new Error("没有可读的图片（PDF 暂不支持 AI 读分）");

    // 升级为全页连贯识读：将家长上传的所有答题卡页面一次性送入多模态模型，
    // 全面覆盖后面的解答题、几何大题与压轴题，杜绝只读第一页漏分的历史硬伤。
    const { json } = await visionJSON({
      system: buildSystem(paper),
      user: `用户上传了 ${images.length} 张答题卡页面照片。请通读所有页面的手写批改痕迹，读出卷面总分以及全部 ${paper.sections.length} 个大题的红笔得分，按给定 key 返回 JSON。`,
      images,
      maxTokens: 8192,
      attempts: 2,
      budgetMs: 120000,
    });

    const total = typeof json.total === "number" && isFinite(json.total) ? json.total : null;
    const report = summarize(paper, align(paper, json), total, json.notes);

    // 家长可能手填了分。这里只记录 AI 读到的，不覆盖家长的分 ——
    // 后台并排显示两个值，不一致时提示老师核对。
    return save(id, {
      status: "done",
      ok: true,
      error: "",
      paperTitle: paper.title || "",
      totalScore: paper.totalScore,
      levelNames: LEVEL_NAME,
      ...report,
      sourceImages: images.length,
      analyzedFirstOnly: false,
    });
  } catch (e) {
    console.error("[analyze] 失败 id=" + id, e?.message);
    return save(id, {
      status: "error",
      ok: false,
      error: e?.message || "分析失败",
    });
  }
}

// 上传后自动触发：不 await，让上传先返回；失败只记库不影响上传。
export function triggerAnalysis(id) {
  try {
    const p = runAnalysis(id);
    // Vercel 上函数可能被冻结，但上传后短时间内通常还在跑。
    // 不 catch 这里会让未处理的 rejection 冒到日志，吞掉即可 —— runAnalysis 内部已落库。
    if (p && typeof p.catch === "function") p.catch((e) => console.error("[analyze] trigger", e));
  } catch (e) {
    console.error("[analyze] trigger 启动失败", e);
  }
}
