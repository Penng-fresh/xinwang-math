// 新模块（考试答题卡 / 名单 / 统计）共用的 Redis 读写封装。
//
// 为什么另起一份而不复用 api/submissions.js 里的 redisCmd：
//   1) 旧接口的写法是「GET 整个数组 → 改 → SET 回去」。两个人同时提交时，
//      后写的会把先写的覆盖掉。这是现存流程里的隐性 bug，旧文件不动，
//      但新模块绝不能沿用。新模块一律用原子命令（ZADD / HSET / HINCRBY / SADD），
//      需要多条时用 pipeline 一次发完 —— Vercel 上每一次往返都算进函数耗时。
//   2) 新模块的 key 必须带命名空间前缀，防止 Preview 部署把测试数据写进生产库。
//
// 前缀规则：
//   生产（VERCEL_ENV=production）→  "xw:"
//   本地 / 未设置           →  "xw:"
//   预览（VERCEL_ENV=preview）  →  "xw:preview:"
//
// 旧 key（submissions_index / submission_<id>）不带前缀，保持原样，互不干扰。

function baseUrl() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "服务器未配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN，请在 Vercel 项目设置里添加"
    );
  }
  return { url: url.replace(/\/+$/, ""), token };
}

export function ns() {
  return process.env.VERCEL_ENV === "preview" ? "xw:preview:" : "xw:";
}

// key 统一从这里出，避免各处手写前缀导致漏加或写错
export const K = {
  group: (gid) => ns() + "group:" + gid,
  groupIdx: () => ns() + "group:idx",
  groupMembers: (gid) => ns() + "group:" + gid + ":members",

  student: (sid) => ns() + "student:" + sid,
  studentIdx: () => ns() + "student:idx",
  studentSum: () => ns() + "student:sum",
  studentSubs: (sid) => ns() + "student:" + sid + ":subs",

  exam: (id) => ns() + "exam:" + id,
  examIdx: () => ns() + "exam:idx",
  examSum: () => ns() + "exam:sum",
  examStat: (id) => ns() + "exam:" + id + ":stat",

  sub: (id) => ns() + "sub:" + id,
  subIdx: () => ns() + "sub:idx",
  subSum: () => ns() + "sub:sum",

  schoolSubs: (school) => ns() + "school:" + school + ":subs",
  schools: () => ns() + "schools"
};

// 单条命令。cmd 形如 ["GET", "key"]
export async function redisCmd(cmd) {
  const { url, token } = baseUrl();
  let host = "(URL 无法解析)";
  try {
    host = new URL(url).host;
  } catch (_) {
    host = String(url).slice(0, 60);
  }

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(cmd)
    });
  } catch (e) {
    // 网络层就挂了（DNS 解析不了 / TLS 失败 / 地址非法）。
    // 只报 "fetch failed" 定位不了，把实际 host 和底层错误码带出来。（上一轮踩过这个坑）
    const code = e?.cause?.code || e?.cause?.errno || "";
    throw new Error(`连不上 Upstash（host=${host}${code ? "，code=" + code : ""}）：${e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(`${data.error}（host=${host}）`);
  return data.result;
}

// 批量命令，一次往返。cmds 是命令数组，返回结果数组（顺序一一对应）。
// 任何一条命令报错时，Upstash 会在对应位置返回 {error}，这里抛出以便定位。
export async function redisPipe(cmds) {
  if (!cmds || cmds.length === 0) return [];
  const { url, token } = baseUrl();

  // 只有一条时不必走 pipeline 端点，省一次重定向
  if (cmds.length === 1) return [await redisCmd(cmds[0])];

  let res;
  try {
    res = await fetch(url + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(cmds)
    });
  } catch (e) {
    const code = e?.cause?.code || e?.cause?.errno || "";
    throw new Error(`连不上 Upstash pipeline${code ? "（code=" + code + "）" : ""}：${e.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) {
    throw new Error(`Upstash pipeline 返回异常：${JSON.stringify(data).slice(0, 200)}`);
  }
  data.forEach((item, i) => {
    if (item && item.error) {
      throw new Error(`Upstash 命令失败（第 ${i + 1} 条 ${cmds[i]?.[0]}）：${item.error}`);
    }
  });
  return data.map((item) => item?.result);
}

// ── 常用原子操作的小包装 ────────────────────────────────

export async function getJSON(key) {
  const raw = await redisCmd(["GET", key]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export async function setJSON(key, value) {
  return redisCmd(["SET", key, JSON.stringify(value)]);
}

// key 不存在才写。用于「首次创建」，避免并发时互相覆盖。
// 返回 true 表示这次真的写进去了。
export async function setJSONIfAbsent(key, value) {
  const r = await redisCmd(["SET", key, JSON.stringify(value), "NX"]);
  return r === "OK";
}

// 取 hash 里的多个字段，返回对象（批量列表页用这个，避免 N 次 GET）
export async function getHash(key, fields) {
  if (!fields || fields.length === 0) return {};
  const vals = await redisCmd(["HMGET", key, ...fields]);
  const out = {};
  fields.forEach((f, i) => {
    const v = vals?.[i];
    if (v === null || v === undefined) return;
    try {
      out[f] = JSON.parse(v);
    } catch (_) {
      out[f] = v;
    }
  });
  return out;
}

// 写 hash 的多个字段，一次往返
export async function setHash(key, obj) {
  const flat = [];
  Object.keys(obj).forEach((f) => {
    if (obj[f] === undefined) return;
    flat.push(f, JSON.stringify(obj[f]));
  });
  if (flat.length === 0) return;
  return redisCmd(["HSET", key, ...flat]);
}

// ── 工具函数 ────────────────────────────────────────────

// 12 位随机 id，够用且短（Redis key 短一点，省内存也省带宽）
export function newId() {
  const uuid = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return uuid.replace(/-/g, "").slice(0, 12);
}

// 4 位数字考试码（家长凭证看分析用）
export function newAccessCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
