// 后端代理：浏览器把作业照片发到这里，这里再用服务器端的密钥去调用智谱 GLM 视觉模型。
// 密钥只存在于 Vercel 项目的环境变量里（ZHIPU_API_KEY），前端代码和浏览器永远看不到它。
// 如果以后想换成付费、效果更好的模型，把下面这个常量改成 "glm-4.6v" 即可，其他代码不用动。
const MODEL = "glm-4.6v"; // 付费旗舰版，106B参数，视觉理解精度更高，独立资源池不易被限流
// 免费模型偶尔会遇到"访问量过大"(429)，这是智谱那边资源池繁忙，不是账户问题。
// 自动重试几次，大多数情况下等一两秒就能成功，不需要让家长自己手动重试。
const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// 兜底修复：GLM 有时会在输出较长、字段较复杂时，把 \frac{分子}{分母}
// 这种 LaTeX 语法的收尾花括号漏掉（比如写成 \frac{25}{4 就断了），
// 导致前端 KaTeX 渲染失败、直接把原始代码露出来给家长看到。
// 这里不依赖模型"自觉"，而是在服务器返回结果前，扫描全文里所有的
// \frac{...}{...} 片段，只要发现分母那一半没有被正确的 '}' 收尾，
// 就自动补上缺失的花括号，不影响任何已经写完整的正常公式。
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
    // 读取分子，直到遇到本层的 '}' 或者意外遇到另一个 '{'（说明格式不规范，放弃修复这一处）
    while (pos < text.length && text[pos] !== "}" && text[pos] !== "{") pos++;
    if (text[pos] !== "}") {
      // 分子都没写完整，无法安全修复，原样保留，跳过这个 marker 继续往后扫描
      result += marker;
      i = idx + marker.length;
      continue;
    }
    const numerator = text.slice(numStart, pos);
    pos++; // 跳过分子收尾的 '}'
    if (text[pos] !== "{") {
      // 不是标准的 \frac{a}{b} 结构，原样保留
      result += `\\frac{${numerator}}`;
      i = pos;
      continue;
    }
    pos++; // 跳过分母开头的 '{'
    const denomStart = pos;
    while (pos < text.length && text[pos] !== "}" && text[pos] !== "{") pos++;
    const denominator = text.slice(denomStart, pos);
    // 不管原文这里有没有正确的收尾 '}'，都重新拼接出完整、闭合的 \frac{分子}{分母}
    result += `\\frac{${numerator}}{${denominator}}`;
    i = text[pos] === "}" ? pos + 1 : pos; // 如果原本就有收尾括号，跳过它；如果没有，说明刚好是我们要修复的缺失情况，不需要跳过任何字符
  }
  return result;
}

async function callZhipu(apiKey, body) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const zhipuRes = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify(body),
    });
    if (zhipuRes.ok) {
      return await zhipuRes.json();
    }
    const errData = await zhipuRes.json().catch(() => ({}));
    const msg = errData?.error?.message || ("智谱 API 错误 " + zhipuRes.status);
    lastError = { status: zhipuRes.status, msg };
    // 只对"访问量过大/限流"这类临时性错误做重试，其他错误（比如密钥错误、参数错误）直接放弃重试
    if (zhipuRes.status === 429 && attempt < MAX_RETRIES - 1) {
      await sleep(1000 * Math.pow(2, attempt)); // 1秒、2秒、4秒，逐次延长等待
      continue;
    }
    throw lastError;
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
    const data = await callZhipu(apiKey, {
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
      thinking: { type: "enabled" }, // 【测试用】临时开启思维链，用于验证开启后能否修复乘方括号误判、运算顺序漏检这类需要演算验证的问题，以及实际要等待多久。如果等待时间不可接受，把 "enabled" 改回 "disabled" 即可恢复原状，其他代码不受影响。
    });
    const choice = data?.choices?.[0];
    let text = choice?.message?.content || "";
    if (!text) {
      // 返回成功但内容为空，常见原因是模型判断无法处理、或被安全过滤拦截。
      // 把 finish_reason 和原始响应的关键信息一起返回，方便定位具体原因。
      const reason = choice?.finish_reason || "未知";
      return res.status(502).json({
        error: "AI返回了空结果（结束原因：" + reason + "），可能是图片内容被安全过滤拦截，或模型处理异常，请换一张照片重试",
        debugRaw: JSON.stringify(data).slice(0, 500),
      });
    }
    // 在返回给前端之前，自动修复可能存在的 \frac 缺失花括号问题
    text = repairFracBraces(text);
    return res.status(200).json({ text });
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
