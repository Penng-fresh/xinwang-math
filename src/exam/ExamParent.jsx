// 考试答题卡上传（家长端整页）
//
// 这一页只做一件事：把答题卡收上来。
// 不解释产品阶段，不预告 AI，不教家长怎么操作 —— 表单本身要能说清。
// 上传要求只保留一句，写在 ExamUpload 里。

import ExamUpload from "./ExamUpload.jsx";

const C = {
  dark: "#2a2218",
  bg: "#f5f0e8",
  card: "#fff",
  soft: "#faf6ee",
  border: "#e0d0b0",
  line: "#e8d0a0",
  dim: "#a08060",
  cream: "#f0e8d0",
  cream2: "#d0c0a0"
};

export default function ExamParent({ onBack }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Noto Sans SC','PingFang SC',sans-serif" }}>
      <div style={{ background: C.dark, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#6a5a3a", marginBottom: 2 }}>信望数理 · 彭老师</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.cream }}>考试答题卡上传</div>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            style={{ background: "transparent", border: "1px solid rgba(240,232,208,0.25)", color: C.cream2, borderRadius: 16, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
          >
            ‹ 作业检查
          </button>
        )}
      </div>

      <div style={{ padding: "16px 16px 90px", maxWidth: 680, margin: "0 auto" }}>
        <ExamUpload />

        <div style={{ textAlign: "center", color: C.dim, fontSize: 11.5, marginTop: 22, lineHeight: 1.9 }}>
          有疑问随时联系我
        </div>
      </div>
    </div>
  );
}
