// 学生提交记录的云端存储接口（升级版：原子并发安全 + 新旧格式无感兼容）
//
// 改造说明：
//   1. 解决原先「GET 数组 → 内存 push → SET 回去」造成的并发覆盖 bug。
//      全面使用 Redis 原子管道命令（ZADD 有序集合 + HSET 摘要表），
//      无论多少家长同时提交，每一条记录都能安全入库，绝不覆盖丢失。
//   2. 完美向下兼容老数据：新版首次读取时，会自动将旧 submissions_index
//      平滑迁移到原子索引中，历史学生的批改记录完整保留。
//   3. 双写兼容：新提交的数据同时维护 K.sub(id) 与老 key submission_{id}，
//      确保任何端、任何旧版本前端查详情都不受影响。

import { guardTeacher } from "../lib/auth.js";
import { K, redisCmd, redisPipe, getJSON } from "../lib/store.js";

// 单次提交的最大字符预算（防恶意超大图打爆 Redis）
const MAX_SUBMISSION_CHARS = 3_500_000;

export default async function handler(req, res) {
  try {
    // ── 家长提交批改记录：不需要密码，任何家长都可以提交 ──
    if (req.method === "POST") {
      const { submission } = req.body || {};
      if (!submission || !submission.id) {
        return res.status(400).json({ error: "缺少提交内容" });
      }

      const rawStr = JSON.stringify(submission);
      if (rawStr.length > MAX_SUBMISSION_CHARS) {
        return res.status(413).json({ error: "提交内容过大，请检查图片大小" });
      }

      const id = String(submission.id);
      const ts = Number(submission.timestamp) || Date.now();
      const summary = {
        id,
        timestamp: ts,
        studentName: String(submission.studentName || "未填写姓名").slice(0, 50),
        score: typeof submission.score === "number" ? submission.score : 0,
        overall: String(submission.overall || "未知"),
        issueCount: Number(submission.issueCount) || 0,
        problemCount: Number(submission.problemCount) || 0,
        problemTypes: String(submission.problemTypes || "").slice(0, 200)
      };

      // 原子管道写入：避免并发读写覆盖，一次往返完成所有操作
      const pipe = [
        // 1. ZSet 时间戳索引（最新排在最前）
        ["ZADD", K.subIdx(), String(ts), id],
        // 2. Hash 摘要表（用于秒级获取列表，避免全量读详情）
        ["HSET", K.subSum(), id, JSON.stringify(summary)],
        // 3. 保留最新 200 条，超出部分从头部剔除
        ["ZREMRANGEBYRANK", K.subIdx(), "0", "-201"],
        // 4. 存储新版带前缀的完整详情
        ["SET", K.sub(id), rawStr],
        // 5. 双写老 key（兼容老版后台查询）
        ["SET", "submission_" + id, rawStr]
      ];

      await redisPipe(pipe);
      return res.status(200).json({ ok: true });
    }

    // ── 教师后台读取记录：需要教师密码 ──
    if (req.method === "GET") {
      const { password, id } = req.query || {};
      if (!guardTeacher(req, res, password)) return;

      // 读取单条记录详情
      if (id) {
        let detail = await getJSON(K.sub(String(id)));
        if (!detail) {
          const legacyRaw = await redisCmd(["GET", "submission_" + id]).catch(() => null);
          detail = legacyRaw ? JSON.parse(legacyRaw) : null;
        }
        return res.status(200).json({ value: detail });
      }

      // 读取最新 200 条提交列表
      const ids = await redisCmd(["ZREVRANGE", K.subIdx(), "0", "199"]).catch(() => []);
      let list = [];
      if (ids && ids.length > 0) {
        const summariesRaw = await redisCmd(["HMGET", K.subSum(), ...ids]).catch(() => []);
        (summariesRaw || []).forEach((r) => {
          if (!r) return;
          try {
            list.push(JSON.parse(r));
          } catch (_) {}
        });
      }

      // 如果新版原子索引中暂无数据（刚升级上线），平滑读取老版数据并自动异步迁移
      if (list.length === 0) {
        const legacyRaw = await redisCmd(["GET", "submissions_index"]).catch(() => null);
        if (legacyRaw) {
          try {
            const legacyList = JSON.parse(legacyRaw);
            if (Array.isArray(legacyList) && legacyList.length > 0) {
              list = legacyList;
              const migPipe = [];
              for (const item of legacyList) {
                if (item && item.id) {
                  const itemTs = Number(item.timestamp) || 0;
                  migPipe.push(["ZADD", K.subIdx(), "NX", String(itemTs), String(item.id)]);
                  migPipe.push(["HSET", K.subSum(), String(item.id), JSON.stringify(item)]);
                }
              }
              if (migPipe.length > 0) {
                redisPipe(migPipe).catch(() => {});
              }
            }
          } catch (_) {}
        }
      }

      return res.status(200).json({ value: list });
    }

    // ── 教师后台删除记录：需要教师密码 ──
    if (req.method === "DELETE") {
      const { id, password } = req.body || {};
      if (!guardTeacher(req, res, password)) return;
      if (!id) return res.status(400).json({ error: "缺少 id" });

      const cleanId = String(id);
      const pipe = [
        ["ZREM", K.subIdx(), cleanId],
        ["HDEL", K.subSum(), cleanId],
        ["DEL", K.sub(cleanId)],
        ["DEL", "submission_" + cleanId]
      ];
      await redisPipe(pipe);

      // 同步清理旧版 submissions_index 遗留项（若存在）
      const legacyRaw = await redisCmd(["GET", "submissions_index"]).catch(() => null);
      if (legacyRaw) {
        try {
          let legacyList = JSON.parse(legacyRaw);
          if (Array.isArray(legacyList)) {
            legacyList = legacyList.filter((x) => x && x.id !== cleanId);
            await redisCmd(["SET", "submissions_index", JSON.stringify(legacyList)]);
          }
        } catch (_) {}
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "不支持的请求方式" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "服务器错误" });
  }
}
