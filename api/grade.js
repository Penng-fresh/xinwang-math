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

// 第二次调用（校验环节）专用的系统提示词，按题型分别放在各自的小文件里：
//   - 有理数运算：api/lib/rationalCheck.js（含 VERIFY_SYSTEM_PROMPT + Plan B 验算引擎）
//   - 混合运算：api/lib/mixedOpsCheck.js（含 MIXED_OPS_VERIFY_SYSTEM_PROMPT）
// 这样以后每加一种新题型，只需要新增一个小文件，不用继续在这一个文件里无限堆砌。
import { VERIFY_SYSTEM_PROMPT as RATIONAL_VERIFY_PROMPT, codeVerifyRationalSteps } from "./lib/rationalCheck.js";
import { MIXED_OPS_VERIFY_SYSTEM_PROMPT } from "./lib/mixedOpsCheck.js";

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
// 如果直接 JSON.parse 失败（常见于 AI 在字符串里写了没有正确转义的引号/反斜杠，
// 混合运算这类结构复杂的题目更容易出现），再用一次"逐字符修复转义"的方式抢救一遍——
// 这段修复逻辑跟前端 App.jsx 里 parseResult 函数的第二层修复完全对应，只是挪到
// 后端来，这样"能不能救回一次完整的验算流程"就不再完全依赖前端那个正则兜底解析器
// （前端那个解析器解析不了 issues 这种对象数组，只能被迫留空，导致分数、总评还在，
// issues 却是空的这种自相矛盾的结果）。
function repairJsonEscaping(js) {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < js.length; i++) {
    const c = js[i], code = c.charCodeAt(0);
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\" && inStr) { esc = true; out += c; continue; }
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue; }
      let j = i + 1;
      while (j < js.length && " \t\n\r".includes(js[j])) j++;
      const nx = js[j];
      if (nx === ":" || nx === "," || nx === "}" || nx === "]" || j >= js.length) { inStr = false; out += c; }
      else { out += '\\"'; }
      continue;
    }
    if (inStr && code < 32) { if (code === 10) { out += "\\n"; continue; } if (code === 13) { out += "\\r"; continue; } if (code === 9) { out += "\\t"; continue; } continue; }
    out += c;
  }
  return out;
}
function extractJson(text) {
  if (typeof text !== "string") return null;
  let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const js = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(js);
  } catch {
    try {
      return JSON.parse(repairJsonEscaping(js));
    } catch {
      return null;
    }
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

// 兜底修复：不管模型自己在 JSON 里怎么写 overall/score，都用 issues 数组的
// 真实内容强制校正一遍，保证"没有任何 issue 却不是正确/满分"这种自相矛盾
// 的结果不会出现在最终返回给前端的数据里——这一步不依赖模型是否遵守提示词，
// 是纯代码逻辑的最后一道保险。
function normalizeOverallAndScore(problems) {
  if (!Array.isArray(problems)) return problems;
  return problems.map((p) => {
    if (!p || typeof p !== "object") return p;
    const hasIssues = Array.isArray(p.issues) && p.issues.length > 0;
    if (!hasIssues) {
      // 没有任何具体错误：必须判定为"正确"，且给满分，不允许模型自己扣分；
      // summary 也统一换成干净的肯定表述，不管 AI 原来写了什么"但/仍需注意"之类的话。
      return { ...p, overall: "正确", score: 100, summary: "解题过程规范，未发现问题。" };
    }
    // 有具体错误：必须判定为"有问题"，不允许模型自相矛盾地标"正确"
    return { ...p, overall: "有问题" };
  });
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
    // 给一个240秒的超时上限（留60秒余量给后续处理和可能的二次校验兜底逻辑），
    // 避免智谱接口偶发响应缓慢时，直接把 Vercel Hobby 套餐300秒的硬上限撞穿、
    // 报出一个前端完全不知所云的失败。
    // max_tokens 从原先的 8192 调大到 16384：如果一次上传的照片里题目较多
    // （比如一整页七八道题，每道题都要输出逐行 transcription + issues），
    // 8192 很容易在写到中间某道题时就被截断，而 extractJson 用
    // lastIndexOf("}") 去找收尾括号，截断后的文本仍可能拼出一个"看起来
    // 完整"但其实只包含前几道题的 JSON，导致后面的题目被无声地漏掉。
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
      max_tokens: 16384,
      thinking: { type: "disabled" },
    }, 240000);
    const firstChoice = firstData?.choices?.[0];
    const firstText = firstChoice?.message?.content || "";
    if (!firstText) {
      const reason = firstChoice?.finish_reason || "未知";
      return res.status(502).json({
        error: "AI返回了空结果（结束原因：" + reason + "），可能是图片内容被安全过滤拦截，或模型处理异常，请换一张照片重试",
        debugRaw: JSON.stringify(firstData).slice(0, 500),
      });
    }

    // 【截断检测】如果模型是因为撞到 max_tokens 上限而被迫中断输出
    // （finish_reason === "length"），说明这次返回的 JSON 大概率是不完整的——
    // 可能刚好在某道题写到一半就被切断，也可能表面上拼出了完整 JSON、
    // 实际上少了后面的题目。这种情况不能当作正常结果直接返回给前端，
    // 否则家长和老师看到的会是一份"看起来没问题、实际上被悄悄截断"的批改，
    // 比直接报错更危险。
    const wasTruncated = firstChoice?.finish_reason === "length";

    const parsed = extractJson(firstText);
    // 如果连修复后都没法解析成 JSON，说明这次 AI 输出的格式问题比较严重，
    // 不能再像以前那样把这份未经任何验算、未经二次校验的原始文字直接甩给前端——
    // 那样会导致 Plan B 验算引擎、normalizeOverallAndScore 这道"没issue就必须
    // 满分"的保险、二次AI校验全部被绕过，前端只能靠一个很脆弱的正则兜底解析器
    // 去硬抠，抠不出 issues 这种对象数组，就会出现"有分数、有总评，却没有任何
    // issue"这种自相矛盾的结果。与其让半成品蒙混过关，不如明确报错，请家长
    // 重新拍一次——这比一份看似正常、实则数据不一致的结果更安全。
    if (!parsed || !Array.isArray(parsed.problems)) {
      if (wasTruncated) {
        return res.status(502).json({
          error: "本次识别的题目较多，AI 输出在中途被截断导致无法解析，请尝试拍摄更少题目的照片，或分多次上传",
        });
      }
      return res.status(502).json({
        error: "AI 返回的批改结果格式异常，暂时无法解析，请重新拍照提交一次试试",
      });
    }

    // ------------------------------------------------------------
    // 【一次一题】产品层面已明确要求学生每次只拍一道自己拿不准的题，
    // 不再支持"一整页多道题"一起批改——多题挤在一张照片里，每道题分到
    // 的像素会骤降，OCR 更容易认错手写的正负号等细节，识别质量下降的
    // 同时批改复杂度还会累积升高，两者叠加导致体验和准确度都打折扣。
    // 这里加一道"门槛"：一旦识别出题目数量大于 1，直接提示学生重新
    // 只拍一题，不再往下走多题批改流程——下面的验算引擎、二次校验、
    // 去重等逻辑完全不用改动，因为走到这里时题目数量必然是 1。
    // ------------------------------------------------------------
    if (parsed.problems.length > 1) {
      return res.status(200).json({
        error: "检测到这张照片里有多道题目。为了保证批改的准确度，请每次只拍一道题上传哦～",
        multipleDetected: true,
      });
    }

    // 把"\frac{分子}{分母"缺失收尾花括号"这种 AI 常见的 LaTeX 输出瑕疵，提前在这里
    // 修复好，而不是像以前那样只在最后返回前才修——因为下面的代码验算引擎需要
    // 正确闭合的 \frac{}{} 才能把每一行精确解析成数字，如果留着缺陷跑代码校验，
    // 会把"4\frac{2}{9"这种残缺文本拆解成好几个不相关的独立数字，产生新的误判。
    Object.assign(parsed, deepRepairFracBraces(parsed));
    parsed.problems = normalizeOverallAndScore(parsed.problems);
    // 【方案B】用代码对"有理数运算"题型的每一步做穷举验算，撤销证明是误判的
    // issue、把无法证伪的 issue 描述换成代码算出的真实情况、并对 AI 完全漏检的
    // 真实计算错误主动补上 issue——这一步跑在决定要不要送二次AI校验之前，
    // 如果代码发现了新的真实问题，这道题也会被正常送去二次校验兜底。
    parsed.problems = codeVerifyRationalSteps(parsed.problems);
    parsed.problems = normalizeOverallAndScore(parsed.problems);

    // 找出所有被判定"有问题"、需要送去二次校验的题目
    const problemsNeedingVerify = parsed.problems.filter(
      (p) => p && Array.isArray(p.issues) && p.issues.length > 0
    );

    if (problemsNeedingVerify.length === 0) {
      // 全部题目都判定正确，没有需要校验的内容，直接返回第一次结果
      const finalText = JSON.stringify(deepRepairFracBraces(parsed));
      if (wasTruncated) {
        return res.status(200).json({
          text: finalText,
          warning: "本次识别的题目较多，AI 输出可能在最后被截断，建议核对一下题目数量是否与原图一致",
        });
      }
      return res.status(200).json({ text: finalText });
    }

    // ------------------------------------------------------------
    // 按 problem_type 选择这道题该用哪一份"二次校验"提示词。因为现在已经
    // 是"一次一题"（parsed.problems 必然只有1道），可以直接取第一题的
    // problem_type 来决定。如果这道题的题型暂时还没有专属的二次校验提示词
    // （比如以后遇到"根式化简"这类还没做二次校验模块的新题型），宁可直接
    // 跳过二次校验、使用第一次调用的结果兜底，也不要把"有理数运算"或
    // "混合运算"的规则硬套到不匹配的题型上——那样只会引入新的、文不对题
    // 的误判，比不做二次校验更糟。
    // ------------------------------------------------------------
    const singleProblemType = String(parsed.problems[0]?.problem_type || "");
    let verifySystemPromptToUse = null;
    if (singleProblemType.includes("有理数")) verifySystemPromptToUse = RATIONAL_VERIFY_PROMPT;
    else if (singleProblemType.includes("混合运算")) verifySystemPromptToUse = MIXED_OPS_VERIFY_SYSTEM_PROMPT;

    if (!verifySystemPromptToUse) {
      const finalText = JSON.stringify(deepRepairFracBraces(parsed));
      if (wasTruncated) {
        return res.status(200).json({
          text: finalText,
          warning: "本次识别的题目较多，AI 输出可能在最后被截断，建议核对一下题目数量是否与原图一致",
        });
      }
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
            { role: "system", content: verifySystemPromptToUse },
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
      parsed.problems = codeVerifyRationalSteps(parsed.problems);
      parsed.problems = normalizeOverallAndScore(parsed.problems);
    }

    const finalText = JSON.stringify(deepRepairFracBraces(parsed));
    if (wasTruncated) {
      return res.status(200).json({
        text: finalText,
        warning: "本次识别的题目较多，AI 输出可能在最后被截断，建议核对一下题目数量是否与原图一致",
      });
    }
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
