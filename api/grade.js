// 后端代理：浏览器把作业照片发到这里，这里再用服务器端的密钥去调用智谱 GLM 视觉模型。
// 密钥只存在于 Vercel 项目的环境变量里（ZHIPU_API_KEY），前端代码和浏览器永远看不到它。

// 如果以后想换成付费、效果更好的模型，把下面这个常量改成 "glm-4.6v" 即可，其他代码不用动。
const MODEL = "glm-4.6v"; // 付费旗舰版，106B参数，视觉理解精度更高，独立资源池不易被限流

// 免费模型偶尔会遇到"访问量过大"(429)，这是智谱那边资源池繁忙，不是账户问题。
// 自动重试几次，大多数情况下等一两秒就能成功，不需要让家长自己手动重试。
const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      max_tokens: 2048,
    });

    const text = data?.choices?.[0]?.message?.content || "";
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
