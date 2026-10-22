// DeepSeek 调用封装（视觉 + 强制 JSON）
//
// 为什么单独抽出来：读作答原卷、拆卷子、以后别的 AI 环节都要走同一套
// 超时 / 重试 / JSON 提取逻辑。原来 /api/grade 里这套逻辑是内联的，
// 再复制一份就会出现两套行为不一致的坑（一边重试两次一边重试一次，
// 家长看到的报错话术还不一样）。
//
// 这里只做一件事：发一张图 + 一段指令，拿回一个能 JSON.parse 的对象。
// 解析不出来就重试，重试还不行就抛错 —— 绝不返回"半截东西"当成功。

const BASE_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-flash";

export function aiConfigured() {
  return !!process.env.DEEPSEEK_API_KEY;
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
 * 发一张图 + 指令，要一个 JSON 回来。
 *
 * @param {object} o
 * @param {string} o.system      系统指令
 * @param {string} o.user        用户这一轮的话
 * @param {string} o.imageBase64 图片 base64（不带 data: 前缀）
 * @param {string} [o.mediaType] image/jpeg | image/png ...
 * @param {number} [o.maxTokens] 默认 8192。推理模型的思考也算在这里面
 * @param {number} [o.attempts]  默认 2
 * @param {number} [o.budgetMs]  单次请求上限，默认 100s
 */
export async function visionJSON(o) {
  const {
    system,
    user,
    imageBase64,
    mediaType = "image/jpeg",
    maxTokens = 8192,
    attempts = 2,
    budgetMs = 100000,
  } = o;

  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY) throw new Error("AI 未配置（缺少 DEEPSEEK_API_KEY）");
  if (!imageBase64) throw new Error("没有图片");

  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), budgetMs);

    let data;
    try {
      const r = await fetch(BASE_URL, {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          // 第一次求稳，第二次稍微放开一点，避免同样的输入同样的死法
          temperature: attempt === 1 ? 0.1 : 0.4,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
                { type: "text", text: user },
              ],
            },
          ],
        }),
      });

      if (!r.ok) {
        const body = await r.text().catch(() => "");
        // 429 / 5xx 可以重试；401 / 400 重试也没用，直接抛
        if (r.status === 429 || r.status >= 500) {
          lastErr = new Error(`AI 服务繁忙（${r.status}）`);
          continue;
        }
        throw new Error(`AI 服务返回 ${r.status}：${body.slice(0, 200)}`);
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
      return { json, text, finish, usage, attempts: attempt };
    } catch (e) {
      lastErr = e;
      console.error(
        `[ai] 第 ${attempt} 次未拿到 JSON finish=${finish}` +
          ` reasoning=${usage?.completion_tokens_details?.reasoning_tokens ?? "-"}` +
          ` contentLen=${text.length}`
      );
    }
  }

  throw lastErr || new Error("AI 调用失败");
}
