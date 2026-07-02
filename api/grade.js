// 后端代理：浏览器把作业照片发到这里，这里再用服务器端的密钥去调用智谱 GLM 视觉模型。
// 密钥只存在于 Vercel 项目的环境变量里（ZHIPU_API_KEY），前端代码和浏览器永远看不到它。
const MODEL = "glm-4.6v"; // 付费旗舰版，106B参数，视觉理解精度更高，独立资源池不易被限流
const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// 【两次调用架构说明】
// 第一次调用：图片 + 不开思考模式（跟以前一样快，几秒到十几秒）。
//   负责识别图片内容、给出初步的批改结果（overall/issues/score等）。
// 第二次调用：只在第一次判定"有问题"的题目上进行，纯文字（不再传图片）+
//   开启思考模式，专门针对 issues 里列出的每一条错误重新演算校验一遍。
//   因为不需要处理图片、且只校验少量文字内容，速度比"图片+思考"快得多，
//   目的是避免 Vercel Hobby 套餐 300 秒的硬性执行时间上限被触发。
// 如果第二次调用超时或失败，会直接使用第一次的结果兜底，不会导致整个
// 批改请求失败——宁可保留一次调用的结果，也不要因为校验环节拖垮整体。
// ============================================================

// 第二次调用（校验环节）专用的系统提示词
const VERIFY_SYSTEM_PROMPT = `你是一位极其严谨的数学验证专家，任务是复核另一位阅卷老师给出的批改结果里，"issues"数组中的每一条判定是否真的站得住脚。

你会收到若干道题目，每道题目包含：该题学生解题过程的逐行内容（transcription），以及当前被判定为"有问题"的 issues 列表。请对每一条 issue 都重新演算一遍，遵循以下原则：

1. 如果某条 issue 声称"某个变形是错误的"，请代入具体数值，亲自验证变形前后两边是否真的相等。常见的合法等价变形包括：把"÷某数的n次方"改写成"×这个数的倒数的n次方"（因为 1÷aⁿ = (1÷a)ⁿ 恒成立）；小数与分数互化；带分数与假分数互化。只要代入验证后发现变形前后数值相等，这条 issue 判断错误，必须删除，不能保留。
2. 如果发现学生解题过程中存在 issues 里没有列出来的真实错误（比如把不属于同一项的两个数字跨加减号拼到了一起进行计算），请把这条遗漏的错误补充进 issues。
3. 如果多条 issues 描述的其实是同一个根源问题引发的连锁反应（比如前一步的错误直接导致了后一步数字异常，后一步的"异常"本身没有独立分析价值），只保留最早、最根本的一条，删除其余的下游连锁反应。
4. 对于你反复验证后，确认判断合理、证据充分的 issue，原样保留，不要为了"显得有改动"而强行修改。
5. 每条 issue 的 description 必须具体点出是哪个数字、来自哪一项、发生了什么错误，不能用"符号处理不规范"这类笼统措辞。

修正完成后，针对每一道题目，请重新评估 overall（如果 issues 变成空数组，overall 改为"正确"；如果原本是"正确"但你发现了遗漏的真实错误，issues 不能为空，overall 改为"有问题"）、score（可参考原有扣分幅度自行调整）、以及 summary（必须和最终的 issues 内容一致，不能自相矛盾）。

只返回 JSON，不要有任何其他文字，格式：{"problems":[{"problem_number":1,"issues":[{"line":1,"type":"错误类型","content":"该行内容","description":"含原理的说明","suggestion":"正确写法"}],"overall":"正确","score":90,"summary":"总体评价"}]}

所有字段中如果出现数学表达式（分数、根号、绝对值等），必须用 $ 符号包裹，用标准 LaTeX 语法（如 \\frac{分子}{分母}），且每一个 \\frac{...}{...} 必须左右花括号都完整闭合。`;

// ============================================================
// 兜底修复：把字符串里所有 \frac{分子}{分母 这种缺失收尾花括号的情况，
// 自动补全为完整闭合的 \frac{分子}{分母}，不影响本来就写完整的公式。
// ============================================================
function repairFracBraces(text) {
  if (typeof text !== "string" || text.indexOf("\\frac{") === -1) return text;
  const marker = "\\frac{";
  let result = "";
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(marker, i);
    if (idx === -1) {
      result += text.slice(i);
      break;
    }
    result += text.slice(i, idx);
    let pos = idx + marker.length;
    const numStart = pos;
    while (pos < text.length && text[pos] !== "}" && text[pos] !== "{") pos++;
    if (text[pos] !== "}") {
      result += marker;
      i = idx + marker.length;
      continue;
    }
    const numerator = text.slice(numStart, pos);
    pos++;
    if (text[pos] !== "{") {
      result += `\\frac{${numerator}}`;
      i = pos;
      continue;
    }
    pos++;
    const denomStart = pos;
    while (pos < text.length && text[pos] !== "}" && text[pos] !== "{") pos++;
    const denominator = text.slice(denomStart, pos);
    result += `\\frac{${numerator}}{${denominator}}`;
    i = text[pos] === "}" ? pos + 1 : pos;
  }
  return result;
}

// 递归地对一个对象/数组里所有的字符串值做 repairFracBraces 修复
function deepRepairFracBraces(value) {
  if (typeof value === "string") return repairFracBraces(value);
  if (Array.isArray(value)) return value.map(deepRepairFracBraces);
  if (value && typeof value === "object") {
    const out = {};
    for (const k in value) out[k] = deepRepairFracBraces(value[k]);
    return out;
  }
  return value;
}

// 从模型返回的原始文字里，尽量稳健地提取出 JSON 对象。
// 模型有时会在 JSON 前后多加说明文字或代码块围栏，这里做兼容处理。
function extractJson(text) {
  if (typeof text !== "string") return null;
  let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// 调用智谱 API，支持限流重试；timeoutMs 用于给单次请求设置硬性超时，
// 超时后会主动中断请求并抛出错误，方便上层做"超时就放弃校验、直接用兜底结果"的处理。
async function callZhipu(apiKey, body, timeoutMs) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = timeoutMs ? new AbortController() : null;
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const zhipuRes = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey,
        },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (zhipuRes.ok) {
        return await zhipuRes.json();
      }
      const errData = await zhipuRes.json().catch(() => ({}));
      const msg = errData?.error?.message || ("智谱 API 错误 " + zhipuRes.status);
      lastError = { status: zhipuRes.status, msg };
      if (zhipuRes.status === 429 && attempt < MAX_RETRIES - 1) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      throw lastError;
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (e.name === "AbortError") {
        throw { status: 408, msg: "请求超时" };
      }
      if (e && e.status) throw e; // 已经是我们自己包装过的错误，直接往外抛
      lastError = { status: 500, msg: e.message };
      throw lastError;
    }
  }
  throw lastError;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "只支持 POST 请求" });
  }
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "服务器未配置 ZHIPU_API_KEY，请在 Vercel 项目设置里添加环境变量" });
  }
  const { imageData, mediaType, systemPrompt, userPrompt } = req.body || {};
  if (!imageData) {
    return res.status(400).json({ error: "缺少图片数据" });
  }

  try {
    // ------------------------------------------------------------
    // 第一次调用：图片 + 不开思考，跟以前完全一样，负责识别和初步批改
    // ------------------------------------------------------------
    const firstData = await callZhipu(apiKey, {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt || "" },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:" + (mediaType || "image/jpeg") + ";base64," + imageData } },
            { type: "text", text: userPrompt || "请分析这张图片。" },
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 8192,
      thinking: { type: "disabled" },
    });
    const firstChoice = firstData?.choices?.[0];
    const firstText = firstChoice?.message?.content || "";
    if (!firstText) {
      const reason = firstChoice?.finish_reason || "未知";
      return res.status(502).json({
        error: "AI返回了空结果（结束原因：" + reason + "），可能是图片内容被安全过滤拦截，或模型处理异常，请换一张照片重试",
        debugRaw: JSON.stringify(firstData).slice(0, 500),
      });
    }

    const parsed = extractJson(firstText);
    // 如果第一次结果没法解析成 JSON，没办法做结构化校验，
    // 退回到"只做花括号文本修复、跳过第二次校验"的兜底路径，保证至少不报错。
    if (!parsed || !Array.isArray(parsed.problems)) {
      return res.status(200).json({ text: repairFracBraces(firstText) });
    }

    // 找出所有被判定"有问题"、需要送去二次校验的题目
    const problemsNeedingVerify = parsed.problems.filter(
      (p) => p && Array.isArray(p.issues) && p.issues.length > 0
    );

    if (problemsNeedingVerify.length === 0) {
      // 全部题目都判定正确，没有需要校验的内容，直接返回第一次结果
      const finalText = JSON.stringify(deepRepairFracBraces(parsed));
      return res.status(200).json({ text: finalText });
    }

    // ------------------------------------------------------------
    // 第二次调用：纯文字 + 开思考，只针对有问题的题目做演算校验
    // 给一个较短的超时时间（150秒），确保总耗时留有余量，
    // 不会撞到 Vercel Hobby 套餐 300 秒的硬性上限。
    // 如果校验调用超时或失败，直接使用第一次的结果兜底，不影响整体返回。
    // ------------------------------------------------------------
    const verifyInput = problemsNeedingVerify.map((p) => ({
      problem_number: p.problem_number,
      transcription: p.transcription || [],
      issues: p.issues,
    }));

    let verifiedProblems = null;
    try {
      const verifyData = await callZhipu(
        apiKey,
        {
          model: MODEL,
          messages: [
            { role: "system", content: VERIFY_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "请复核以下批改结果：\n" + JSON.stringify({ problems: verifyInput }) },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 4096,
          thinking: { type: "enabled" },
        },
        150000 // 150秒超时
      );
      const verifyChoice = verifyData?.choices?.[0];
      const verifyText = verifyChoice?.message?.content || "";
      const verifyParsed = extractJson(verifyText);
      if (verifyParsed && Array.isArray(verifyParsed.problems)) {
        verifiedProblems = verifyParsed.problems;
      }
    } catch (verifyErr) {
      // 校验失败（超时/网络问题/解析失败等），静默降级，使用第一次的结果
      verifiedProblems = null;
    }

    // 把校验结果按 problem_number 合并回原始结果里，只覆盖 issues/overall/score/summary，
    // 其余字段（transcription、problem_type、steps_detected、praise等）保持第一次调用的内容不变
    if (verifiedProblems) {
      const verifiedMap = new Map(verifiedProblems.map((v) => [v.problem_number, v]));
      parsed.problems = parsed.problems.map((p) => {
        const v = verifiedMap.get(p.problem_number);
        if (!v) return p; // 这道题没有被送去校验（本来就没问题），原样保留
        return {
          ...p,
          issues: Array.isArray(v.issues) ? v.issues : p.issues,
          overall: v.overall || p.overall,
          score: typeof v.score === "number" ? v.score : p.score,
          summary: v.summary || p.summary,
        };
      });
    }

    const finalText = JSON.stringify(deepRepairFracBraces(parsed));
    return res.status(200).json({ text: finalText });
  } catch (e) {
    if (e && e.status) {
      const friendlyMsg = e.status === 429
        ? "当前批改请求较多，请稍等几秒后重新点击批改"
        : e.msg;
      return res.status(e.status).json({ error: friendlyMsg });
    }
    return res.status(500).json({ error: "调用智谱 API 失败：" + e.message });
  }
}
