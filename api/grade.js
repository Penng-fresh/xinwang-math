// 后端代理：浏览器把作业照片发到这里，这里再用服务器端的密钥去调用智谱 GLM 视觉模型。
// 密钥只存在于 Vercel 项目的环境变量里（ZHIPU_API_KEY），前端代码和浏览器永远看不到它。

// 如果以后想换成付费、效果更好的模型，把下面这个常量改成 "glm-4.6v" 即可，其他代码不用动。
const MODEL = "glm-4.6v-flash"; // 免费视觉模型，支持图片输入 + 工具调用 + 长上下文

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
    const zhipuRes = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
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
        max_tokens: 4096,
      }),
    });

    if (!zhipuRes.ok) {
      const errData = await zhipuRes.json().catch(() => ({}));
      const msg = errData?.error?.message || ("智谱 API 错误 " + zhipuRes.status);
      return res.status(zhipuRes.status).json({ error: msg });
    }

    const data = await zhipuRes.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "调用智谱 API 失败：" + e.message });
  }
}
