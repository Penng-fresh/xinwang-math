// 名单文本解析：把老师粘贴进来的一坨文字变成一串干净的名字。
//
// 单独成文件是为了能直接跑测试（tests/test_names.mjs）。
// 老师实际会怎么粘贴，我按这几种最常见的来：
//   ① 纯一列姓名（记事本/微信里复制）：  张三\n李四\n王五
//   ② Excel 多列（序号 / 班级 / 姓名 / 性别）：  1\t初一1班\t张三\t男
//   ③ 带各种序号前缀：  1.张三 / 1、张三 / （1）张三 / 1 张三
//
// 挡掉的脏数据：表头行、性别列、班级列、纯数字、含数字的整行说明、带标点的句子。
//
// 三条判据（都是「中文姓名不会有 X」这个事实）：
//   · 姓名里不会有阿拉伯数字
//   · 姓名里不会有标点（中点 · 例外，允许少数民族姓名）
//   · 姓名长度不会超过 10 个字

const HEADER_WORDS = [
  "姓名", "学生", "学生姓名", "名字", "序号", "编号", "班级", "学号",
  "学生名单", "名单", "年级", "学校", "性别", "备注", "电话", "手机",
  "手机号", "联系电话", "家长", "分数", "成绩", "男", "女"
];

const NOISE = new Set(HEADER_WORDS);

// 像班级名/年级名的字段：含「班/年级/组/校」且不是单纯的姓名
function looksLikeClassField(s) {
  return /[班级年级组校]/.test(s) && s.length > 2;
}

export function parseNames(text) {
  const out = [];
  const seen = new Set();

  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      let s = line.replace(/\u3000/g, " ").trim();
      if (!s) return;

      // ① Excel 复制多列时会带制表符。中文姓名习惯放在靠右，所以从后往前找，
      //    跳过序号列、表头列、性别列、班级列，取第一个像姓名的字段。
      if (s.includes("\t")) {
        const parts = s.split("\t").map((x) => x.trim()).filter(Boolean);
        let picked = null;
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          if (/^\d+$/.test(p)) continue;      // 序号列
          if (NOISE.has(p)) continue;         // 表头 / 性别 / 备注
          if (looksLikeClassField(p)) continue; // 初一1班
          picked = p;
          break;
        }
        // 整行都是噪声（就是表头那一行），跳过
        if (!picked) return;
        s = picked;
      }

      // ② 去掉各种序号前缀
      s = s.replace(/^[（(]?\d{1,3}[）)]?\s*[.、．,，:：]?\s*/, "");
      // ③ 去掉老师导出名单时自带的重复尾号（张伟(2) → 张伟），后面会重新分配
      s = s.replace(/[（(]\d{1,2}[）)]$/, "");
      // ④ 去掉名字中间的空白（粘贴时常混进全角空格）
      s = s.replace(/\s+/g, "");
      if (!s) return;

      // ⑤ 三条判据挡脏数据
      if (NOISE.has(s)) return;
      if (/\d/.test(s)) return;                 // 姓名里不会有数字
      if (s.length > 10) return;                // 整行说明文字
      if (/[，。；：！？、,;:!?]/.test(s)) return; // 姓名里不会有标点
      if (seen.has(s)) return;                  // 本次粘贴内去重

      seen.add(s);
      out.push(s);
    });

  return out;
}

// 同组内重名处理：张伟 → 张伟(2) → 张伟(3)
export function dedupeName(name, existingNames) {
  if (!existingNames.has(name)) return name;
  let i = 2;
  while (existingNames.has(`${name}(${i})`)) i++;
  return `${name}(${i})`;
}
