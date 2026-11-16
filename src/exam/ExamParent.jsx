// 考试答题卡上传（家长端整页）
//
// 顺序是刻意的：上传框放在最上面，说明文字全部压在下面。
// 家长进来是要办事的，不是来读说明的；把说明放前面，滑动两屏才能看到按钮。
//
// 页面上必须说清三件事，其余一律不写：
//   1. 现在只能收，还出不了分析，以及为什么（卷子难度还没分好类）
//   2. 以后会看到什么（该会没会 / 讲过没练熟 / 压轴本来就难）
//   3. 压轴题多数孩子做不出来，这是正常的 —— 这句一定要说，
//      否则家长看到一屏红叉只会焦虑，然后逼孩子刷压轴题，方向全错
//
// 这一页不写排名、不写平均分、不跟别人比。

import { useState } from "react";
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

function Card({ title, children }) {
  return (
    <div style={{ background: C.card, borderRadius: 14, border: "1px solid " + C.line, padding: "18px 16px", marginTop: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.dark, marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: "#5a4a30", lineHeight: 2 }}>{children}</div>
    </div>
  );
}

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

      <div style={{ padding: "16px 16px 90px", maxWidth: 680, margin: "0 auto" }}>
        <ExamUpload />

        <Card title="现在只收，还出不了分析">
          <div style={{ marginBottom: 8 }}>
            先说实话：现在传上来，我<strong>只能收着</strong>，还没法给你出分析。
          </div>
          <div style={{ marginBottom: 8 }}>
            要给一份卷子下判断——哪些分是该会没会的、哪些是练得不熟的——我得先把这套卷子从头到尾做一遍，把每道题的难度分好类。这件事没法提前做，得等卷子到手。
          </div>
          <div>但答题卡等不了。考完那阵子还在，过两周就找不着了。所以先传，卷子理顺了我一起算。</div>
        </Card>

        <Card title="能出分析之后，你会看到的是这三类">
          <div style={{ background: C.soft, border: "1px solid " + C.border, borderRadius: 10, padding: "12px 14px", marginBottom: 10, lineHeight: 2.1 }}>
            <div>① <strong>该会没会</strong> —— 应知应会，丢了必须补</div>
            <div>② <strong>讲过、还没练熟</strong> —— 课上有同类，缺的是手感</div>
            <div>③ <strong>压轴本来就难</strong> —— 大部分孩子拿不到</div>
          </div>
          <div style={{ marginBottom: 8 }}>
            三道题都扣 3 分，可这三回事完全不同：第一种要回课本，第二种要练，第三种可以先放下。
          </div>
          <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#7a5a20", lineHeight: 1.9 }}>
            第③类我要多说一句：<strong>压轴题多数孩子做不出来，这是正常的。</strong>看到一屏红叉先别急，方向要是搞反了，越使劲越费孩子。
          </div>
        </Card>

        <Card title="先看你属于哪种，再决定怎么传">
          <div style={{ background: C.soft, border: "1px solid " + C.border, borderRadius: 10, padding: "12px 14px", marginBottom: 12, lineHeight: 2 }}>
            <div><strong>A. 智学网上能下载原卷或答题卡</strong>（有「下载原卷」按钮）→ 下载下来直接传，PDF 最好，最清楚。</div>
            <div><strong>B. 能看，但下载不了</strong> → 放大后一页一张截图，别把整份缩在一张图里。</div>
            <div><strong>C. 智学网上没有，只有纸质答题卡</strong> → 拍照，也是一张只拍一页。</div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <strong>先找一找有没有「下载原卷」。</strong>有的话直接传文件，比拍照、截图都清楚，孩子每一步写了什么都能看见。
          </div>

          <div style={{ background: "#fdf3dc", border: "1px solid #e8c870", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#7a5a20", marginBottom: 10 }}>
            <strong>最怕整份拼成一张长图。</strong>把六到八页缩到一屏里，每页只剩两三百像素，字糊成一团，我看不出他错在哪一步。有几页就分几次传，一页一张。
          </div>

          <div>
            <strong>不管哪种，字要清楚。</strong>你眯着眼看不清的，我也看不清。光线足、拍正、四个角都进画面，老师打的叉别挡住。
          </div>
        </Card>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={() => setShowDetail(!showDetail)}
            style={{ background: "transparent", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", padding: "10px 12px", fontFamily: "inherit" }}
          >
            {showDetail ? "收起" : "为什么不用智学网那套"}
          </button>
        </div>

        {showDetail && (
          <div style={{ background: C.soft, border: "1px solid " + C.border, borderRadius: 12, padding: "16px 16px", marginTop: 4, fontSize: 13, color: "#5a4a30", lineHeight: 2 }}>
            <div style={{ marginBottom: 8 }}>
              分数多少、哪一章失分，智学网上写得比这里清楚，这里不再说一遍。
            </div>
            <div style={{ marginBottom: 8 }}>
              这里说的是另一件事：<strong>丢掉的这些分，到底属于哪一种</strong>。智学网给的是"第几题扣了几分"，给不了"这几分该不该丢"——那要靠老师对这道题的判断。
            </div>
            <div>你看到的只有三样：<strong>他的分数</strong>、<strong>丢的分属于哪一类</strong>、<strong>错的是第几题</strong>。不给排名，不给平均分，也不跟别人比。</div>
          </div>
        )}

        <div style={{ textAlign: "center", color: C.dim, fontSize: 11.5, marginTop: 22, lineHeight: 1.9 }}>
          有疑问随时联系我
        </div>
      </div>
    </div>
  );
}
