// 考试答题卡上传（家长端）—— 目前是「期中后开放」的说明页
//
// 为什么先把这个空页面放出来：家长页头上那句「考试答题卡上传」如果点了没反应，
// 家长会以为坏了；点了进去看到一句「期中后开放」，反而会记住这件事，
// 也会顺手把答题卡拍照留好——这正是我期中最需要家长配合的地方。
//
// 内容上故意写得很短，且只说三件不会打脸的话：
//   1. 分数和章节失分，智学网上有，这里不重复
//   2. 这里只说丢的分属于哪一类（概念 / 中档 / 压轴）
//   3. 家长现在能做的事：答题卡拍照留着
// 等功能真上线了，这个文件的正文会被上传入口替换掉，壳子不用动。

import { useState } from "react";

const C = {
  dark: "#2a2218",
  bg: "#f5f0e8",
  card: "#fff",
  soft: "#faf6ee",
  accent: "#e8a030",
  border: "#e0d0b0",
  line: "#e8d0a0",
  muted: "#8a7a5a",
  dim: "#a08060",
  cream: "#f0e8d0",
  cream2: "#d0c0a0"
};

export default function ExamParent({ onBack }) {
  const [showDetail, setShowDetail] = useState(false);

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

      <div style={{ padding: "20px 16px 90px", maxWidth: 680, margin: "0 auto" }}>
        <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 10, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "#7a5a20", lineHeight: 1.8 }}>
          <b>这一页期中考试后开放。</b>上传入口还没放出来，先把下面的提醒看完。
        </div>

        <div style={{ background: C.card, borderRadius: 14, border: "1px solid " + C.line, padding: "20px 18px", marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.dark, marginBottom: 12 }}>它和智学网不重复</div>
          <div style={{ fontSize: 13.5, color: "#5a4a30", lineHeight: 2 }}>
            <div style={{ marginBottom: 8 }}>分数多少、哪一章失分，智学网上写得比这里清楚，这里不再说一遍。</div>
            <div style={{ marginBottom: 8 }}>
              这里说的是另一件事：<b>丢掉的这些分，到底属于哪一种</b>——
            </div>
            <div style={{ background: C.soft, border: "1px solid " + C.border, borderRadius: 10, padding: "12px 14px", marginBottom: 8, fontSize: 13, color: "#5a4a30", lineHeight: 2 }}>
              <div>① 基本概念有盲点 —— 该会没会</div>
              <div>② 中档题的套路缺了一块 —— 会，但做不顺</div>
              <div>③ 压轴题本来就难 —— 大部分人都拿不到</div>
            </div>
            <div>三道题都扣 3 分，可这三种完全不是一回事。第一种要回课本，第二种要练手感，第三种可以暂时放下——先补哪一块，家长和我就不会各猜各的。</div>
          </div>
        </div>

        <div style={{ background: C.card, borderRadius: 14, border: "1px solid " + C.line, padding: "20px 18px", marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.dark, marginBottom: 10 }}>现在麻烦你配合两件事</div>
          <div style={{ fontSize: 13.5, color: "#5a4a30", lineHeight: 2 }}>
            <div style={{ marginBottom: 8 }}>
              <b>1. 答题卡拍照留着。</b>考完学校发下来的答题卡，整张平放拍一张，别折、别卷、别丢。字要看得清，尤其是老师打叉的地方。
            </div>
            <div>
              <b>2. 别只留分数。</b>只告诉我「考了 82」我没法分析；有答题卡，我才知道他这 18 分丢在哪、为什么丢。
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={() => setShowDetail(!showDetail)}
            style={{ background: "transparent", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", padding: "8px 12px", fontFamily: "inherit" }}
          >
            {showDetail ? "收起" : "这项功能具体怎么用"}
          </button>
        </div>

        {showDetail && (
          <div style={{ background: C.soft, border: "1px solid " + C.border, borderRadius: 12, padding: "16px 16px", marginTop: 6, fontSize: 13, color: "#5a4a30", lineHeight: 2 }}>
            <div style={{ marginBottom: 8 }}>每次考完，我会拿到这次的卷子和答案，把每道题按难度分好类。你上传答题卡之后，系统对照答案看他错的是哪几题，再按上面的三类算一遍。</div>
            <div style={{ marginBottom: 8 }}>你看到的只有三样东西：<b>他的分数</b>、<b>丢的分属于哪一类</b>、<b>错的是第几题</b>。不给排名，不给平均分，也不跟别人比。</div>
            <div>答案是我核对过的，不是 AI 猜的；AI 只负责看他答题卡上写了什么。这一步一旦出错，整个分析就废了，所以我宁可慢一点。</div>
          </div>
        )}

        <div style={{ textAlign: "center", color: C.dim, fontSize: 11.5, marginTop: 22, lineHeight: 1.9 }}>
          有疑问随时联系我
        </div>
      </div>
    </div>
  );
}
