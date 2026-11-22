// 基于 Upstash Redis 的轻量级 IP 限流与防刷保护模块
//
// 设计原则（严格遵从彭老师的业务需求）：
// 1. 家长无需注册登录，正常使用完全不设每日使用次数门槛；
// 2. 仅拦截异常高频的自动化刷接口行为（如同一 IP 在 1 分钟内连续调用数十次）；
// 3. 失败降级保护：如果 Redis 偶发网络波动，限流器默认放行，绝不阻断正常家长的批改！

import { redisCmd, ns } from "./store.js";

export function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"] || "";
  if (xff) {
    const ip = xff.split(",")[0].trim();
    if (ip) return ip;
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown_ip";
}

/**
 * 检查当前 IP 是否超出滑动窗口频率限制
 * @param {object} req - HTTP Request
 * @param {string} action - 动作名称（如 "grade", "analysis", "submissions"）
 * @param {number} limit - 窗口期内允许的最大请求数（默认 15 次）
 * @param {number} windowSec - 窗口时长（秒，默认 60 秒）
 * @returns {Promise<{ allowed: boolean, remaining: number }>}
 */
export async function checkRateLimit(req, action, limit = 15, windowSec = 60) {
  try {
    const ip = getClientIp(req);
    const key = `${ns()}rl:${action}:${ip}`;

    const count = await redisCmd(["INCR", key]);
    if (count === 1) {
      await redisCmd(["EXPIRE", key, String(windowSec)]);
    }

    if (count > limit) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: Math.max(0, limit - count) };
  } catch (err) {
    // 降级保护：如果 Redis 限流查询异常，打印日志并直接放行，避免误伤真实家长
    console.warn(`[ratelimit] ${action} 限流检测跳过（服务异常）:`, err.message);
    return { allowed: true, remaining: 1 };
  }
}
