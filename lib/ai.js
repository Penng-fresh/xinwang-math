// AI 模型网关（视觉 + 强制 JSON，默认优先 Google Gemini，保留 DeepSeek 热切换兜底）
//
// 切换规则：
// 1. 配置了 GEMINI_API_KEY（且未把 AI_PROVIDER 设为 "deepseek"）→ 全站自动走 Google Gemini；
//    默认模型 gemini-3.8-flash，可通过环境变量 GEMINI_MODEL 随时切换（如 gemini-4-neon）。
// 2. 未配置 GEMINI_API_KEY，或显式设置 AI_PROVIDER="deepseek" → 自动回落 DeepSeek，线上零中断。
// 3. 所有请求均在 Vercel 海外云函数内发出，前端不直连 Google、不暴露任何 API Key。

export function getAIConfig() {
  const provider = (process.env.AI_PROVIDER || "").toLowerCase().trim();
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  const deepseekKey = (process.env.DEEPSEEK_API_KEY || "").trim();

  const useGemini =
    provider === "gemini" || (provider !== "deepseek" && !!geminiKey);

  if (useGemini) {
    return {
      provider: "gemini",
      key: geminiKey,
      baseUrl:
        process.env.GEMINI_BASE_URL ||
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    };
  }

  return {
    provider: "deepseek",
    key: deepseekKey,
    baseUrl:
      process.env.DEEPSEEK_BASE_URL ||
      "https://api.deepseek.com/v1/chat/completions",
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
  };
}

// 兼容提取 OpenAI / Gemini 兼容接口的报错文本（Gemini 偶尔返回数组包裹的 error 对象）
export function extractAIErrorMessage(rawText, fallback = "") {
  if (!rawText) return fallback;
  try {
    const parsed = JSON.parse(rawText);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const msg = first?.error?.message || first?.message;
    if (msg) return String(msg);
  } catch (_) {}
  return String(rawText).slice(0, 200) || fallback;
}

export function aiConfigured() {
  const { key } = getAIConfig();
  return !!key;
}

export function currentAIProvider() {
  const { provider, model } = getAIConfig();
  return { provider, model };
}

// 模型有时会把 JSON 包在 ```json 里，或在前面加一句"好的，这是结果："。
// 这两种都能救；真读不出来才报错。
function extractJSON(text) {
  if (!text) throw new Error("模型没有返回内容");
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch (_) {
    // 兜底：截取第一个 { 到最后一个 }，中间的多余说明文字丢掉
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      const sliced = s.slice(a, b + 1);
      try {
        return JSON.parse(sliced);
      } catch (e2) {
        throw new Error("模型返回的不是合法 JSON：" + e2.message);
      }
    }
    throw new Error("模型返回里找不到 JSON 对象");
  }
}

/**
 * 发送图片 + 指令，获得结构化 JSON 对象。
 *
 * @param {object} o
 * @param {string} o.system       系统指令
 * @param {string} o.user         用户提示词
 * @param {string} [o.imageBase64]单张图片 base64（与 o.images 二选一）
 * @param {Array}  [o.images]     多张图片数组 [{ data, mediaType }]
 * @param {string} [o.mediaType]  单图类型 image/jpeg | image/png
 * @param {number} [o.maxTokens]  默认 8192
 * @param {number} [o.attempts]   默认 2
 * @param {number} [o.budgetMs]   单次请求时限，默认 100s
 */
export async function visionJSON(o) {
  const {
    system,
    user,
    imageBase64,
    images,
    mediaType = "image/jpeg",
    maxTokens = 16384,
    attempts = 2,
    budgetMs = 100000,
  } = o;

  const { provider, key, baseUrl, model } = getAIConfig();
  if (!key) throw new Error(`AI 未配置（缺少 ${provider === "gemini" ? "GEMINI_API_KEY" : "DEEPSEEK_API_KEY"}）`);

  // 整理图片列表（支持单图或多图连贯输入）
  const imgList = [];
  if (Array.isArray(images) && images.length > 0) {
    for (const im of images) {
      if (im && im.data) {
        imgList.push({ data: im.data, mediaType: im.mediaType || "image/jpeg" });
      }
    }
  } else if (imageBase64) {
    imgList.push({ data: imageBase64, mediaType });
  }

  if (imgList.length === 0) throw new Error("没有可分析的图片");

  const userContent = [];
  for (const im of imgList) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${im.mediaType};base64,${im.data}` },
    });
  }
  userContent.push({ type: "text", text: user });

  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), budgetMs);

    let data;
    try {
      const r = await fetch(baseUrl, {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          // 第一次求稳 0.1，重试稍微放开到 0.35 避免陷入相同死循环
          temperature: attempt === 1 ? 0.1 : 0.35,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!r.ok) {
        const body = await r.text().catch(() => "");
        if (r.status === 429 || r.status >= 500) {
          lastErr = new Error(`AI 服务繁忙（HTTP ${r.status}）`);
          continue;
        }
        throw new Error(`AI 服务返回 ${r.status}：${extractAIErrorMessage(body, r.statusText)}`);
      }

      data = await r.json();
    } catch (err) {
      if (err?.name === "AbortError") {
        lastErr = new Error(`AI 响应超时（超过 ${Math.round(budgetMs / 1000)} 秒）`);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const choice = data?.choices?.[0];
    const text = (choice?.message?.content || "").trim();
    const finish = choice?.finish_reason || "";
    const usage = data?.usage || null;

    try {
      const json = extractJSON(text);
      return { json, text, finish, usage, attempts: attempt, provider, model };
    } catch (e) {
      lastErr = e;
      console.error(
        `[ai:${provider}] 第 ${attempt} 次未拿到合规 JSON finish=${finish}` +
          ` contentLen=${text.length}`
      );
    }
  }

  throw lastErr || new Error("AI 调用失败");
}

/**
 * 纯文本调用，拿回 JSON 对象。给不需要图片的场景用（试卷拆题、逐题分析）。
 * 与 visionJSON 共用同一套 provider 配置、重试策略和 JSON 提取逻辑，
 * 区别只是 messages 里不带 image_url。
 *
 * @param {object} o
 * @param {string} o.system       系统指令
 * @param {string} o.user         用户内容
 * @param {number} [o.maxTokens]  默认 8192
 * @param {number} [o.attempts]   默认 2
 * @param {number} [o.budgetMs]   单次请求时限，默认 100s
 */
export async function textJSON(o) {
  const { system, user, maxTokens = 16384, attempts = 2, budgetMs = 100000 } = o;

  const { provider, key, baseUrl, model } = getAIConfig();
  if (!key) throw new Error(`AI 未配置（缺少 ${provider === "gemini" ? "GEMINI_API_KEY" : "DEEPSEEK_API_KEY"}）`);
  if (!user) throw new Error("没有输入内容");

  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), budgetMs);

    let data;
    try {
      const r = await fetch(baseUrl, {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: attempt === 1 ? 0.1 : 0.35,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!r.ok) {
        const body = await r.text().catch(() => "");
        if (r.status === 429 || r.status >= 500) {
          lastErr = new Error(`AI 服务繁忙（HTTP ${r.status}）`);
          continue;
        }
        throw new Error(`AI 服务返回 ${r.status}：${extractAIErrorMessage(body, r.statusText)}`);
      }

      data = await r.json();
    } catch (err) {
      if (err?.name === "AbortError") {
        lastErr = new Error(`AI 响应超时（超过 ${Math.round(budgetMs / 1000)} 秒）`);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const choice = data?.choices?.[0];
    const text = (choice?.message?.content || "").trim();
    const finish = choice?.finish_reason || "";
    const usage = data?.usage || null;

    try {
      const json = extractJSON(text);
      return { json, text, finish, usage, attempts: attempt, provider, model };
    } catch (e) {
      lastErr = e;
      console.error(
        `[ai:${provider}] 文本第 ${attempt} 次未拿到 JSON finish=${finish} contentLen=${text.length}`
      );
    }
  }

  throw lastErr || new Error("AI 调用失败");
}
