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
const VERIFY_SYSTEM_PROMPT = `你是一位极其严谨的数学验证专家，任务是复核另一位阅卷老师给出的批改结果里，"issues"数组中的每一条判定**不仅要验证对错，更要验证分类是否准确**。

你会收到若干道题目，每道题目包含：该题学生解题过程的逐行内容（transcription），以及当前被判定为"有问题"的 issues 列表。

【最容易出问题的地方，请特别注意】另一位阅卷老师经常会犯这样的错误：明明发现某一步的数字不对，但归因归错了方向——比如看到"25/64"这个不合理的结果，就笼统地说"计算 -4×(-1/64) 时数值算错了"，但实际上真正的病根可能是**这两个数字根本不是同一次运算的产物**（比如分子25来自另一个独立的项，分母64来自这一项），学生根本没有"算错乘法"，而是把两个不同项的数字拼到了一起。这种"表面现象对了、但归因错了"的情况，光"验证结果对不对"是发现不了的，必须重新去追溯每个数字的来源。

请对每一条 issue，按以下步骤重新分析（不只是简单地打对错勾）：

第一步，追溯来源：找到这条 issue 里出现的每一个数字，回到原式（transcription 的前几行）里，确认这个数字具体是从哪一步、哪一项计算出来的。

第二步，判断错误的真正机制，对照下面的分类框架，重新确定这条 issue 应该属于哪一类（如果发现原来标注的 type 不准确，必须改正，不要因为"原来就是这么标的"而沿用错误分类）：
- 运算顺序错误：如果你发现某一步里的数字，其分子/分母/系数分别来自加减号两侧的不同项（也就是说这两个数字压根不该出现在同一次运算里），这属于"运算顺序错误"（跨项拼凑），不是"计算错误"，也不是"漏负号"。描述时必须明确指出：具体是哪个数字，来自哪一项，被错误地和另一项的哪个数字拼在了一起。
- 漏负号：仅当参与运算的两个数字确实来自同一次加减运算、只是最终结果的正负号判断错了，才用这个分类。
- 乘方括号错误：仅当学生真的把 -aⁿ 和 (-a)ⁿ 弄反了、算出的数值体现出这种混淆，才用这个分类；把"÷aⁿ"等价改写成"×(1/a)ⁿ"是合法变形，不属于此类。
- 预处理不彻底（跳步）：小数没化最简分数、带分数没化假分数、除法没有先转成乘倒数再计算，这类"该做的等价变形没做"的情况。
- 如果代入数值验证后发现某个"等价变形"其实是完全正确的（例如 1÷aⁿ = (1÷a)ⁿ 这类恒等变形），这条 issue 判断错误，必须整条删除，不能保留。

第三步，处理重复与连锁：如果发现学生解题过程中存在 issues 里没有列出来的真实错误，请补充进去；如果多条 issues 描述的其实是同一个根源问题引发的连锁反应，只保留最早、最根本的一条。

【重要，防止遗漏】你的任务是"精修"这份 issues 清单，不是"重新生成"一份新清单。对于原始 issues 数组里的**每一条**，你都必须明确交代它的去留：保留（判断准确，原样保留）、修改（类型或描述不准，予以更正）、合并（属于同一根源的连锁反应，与另一条合并保留其中更根本的一条）、删除（代入验证后确认是误判）。除非你有明确理由判定某一条属于"合并"或"删除"，否则都必须出现在最终的 issues 数组里，不能因为把注意力放在修正某一条上，就无意中把其他没问题的条目漏掉。在最终输出前，请对照原始 issues 的条数，确认自己已经对每一条都做出了处理，而不是只处理了其中一部分。

第四步，重写 description：必须具体点出是哪个数字、来自哪一项、发生了什么错误，禁止使用"计算错误""数值不对""符号处理不规范"这类不指出具体机制的笼统措辞。

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
