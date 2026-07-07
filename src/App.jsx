import { useState, useRef, useEffect } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// MathText：把 AI 返回的混合文本（中文 + LaTeX 公式）渲染成可读排版。
// AI 有时会用 $...$ 包裹公式（如 $\frac{1}{2}$），有时直接裸写 \frac{1}{2}，
// 这个组件两种情况都能处理，不会让 $ 符号残留在页面上。
function MathText({ children }) {
  const text = String(children ?? "");
  if (!text) return <span />;

  // 第一步：先按 $...$ 整体切分（优先处理带定界符的完整公式块）
  // 同时也匹配裸露的 \frac{}{} 和 \sqrt{}，统一放入 parts 队列
  const parts = [];
  // 正则：匹配 $...$（非贪婪）或 \frac{}{} 或 \sqrt{} 三种情况
  const TOKEN = /\$([^$]+)\$|\\frac\{[^{}]*\}\{[^{}]*\}|\\sqrt\{[^{}]*\}/g;
  let last = 0, m;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) {
      // 中间的普通文字：去掉孤立的 $ 符号（可能是 AI 格式不规范的残留）
      const txt = text.slice(last, m.index).replace(/\$/g, "");
      if (txt) parts.push({ t: "text", v: txt });
    }
    // m[1] 有值说明是 $...$ 包裹的，取内部公式；否则整体就是 \frac 或 \sqrt
    parts.push({ t: "formula", v: m[1] !== undefined ? m[1] : m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const txt = text.slice(last).replace(/\$/g, "");
    if (txt) parts.push({ t: "text", v: txt });
  }

  return <>{parts.map((p, i) => {
    if (p.t === "formula") {
      try {
        const html = katex.renderToString(p.v, { throwOnError: false, displayMode: false, strict: false });
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch { return <span key={i}>{p.v}</span>; }
    }
    return <span key={i}>{p.v}</span>;
  })}</>;
}

// 全局样式注入
const GlobalStyle = () => {
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      @import url('https://fonts.loli.net/css2?family=Noto+Serif+SC:wght@400;500;700;900&family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; }
      body { font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);
  return null;
};

// ══════════════════════════════════════════════════
//  主页面组件
// ══════════════════════════════════════════════════

const RESULTS = [
  { name: "李同学", grade: "初三", before: "58分", after: "91分", duration: "4个月", quote: "第一次觉得数学是讲道理的。" },
  { name: "陈同学", grade: "初二", before: "67分", after: "88分", duration: "3个月", quote: "老师会把为什么讲清楚，不只告诉我怎么做。" },
  { name: "王同学", grade: "小六", before: "72分", after: "95分", duration: "5个月", quote: "现在遇到新题也不慌了。" },
];

const PHILOSOPHY = [
  { icon: "◎", title: "概念先行", body: "每道题背后都有它的道理。我先让孩子弄懂概念从哪里来、为什么成立，再讲解题步骤。" },
  { icon: "✕", title: "反对刷题", body: "大量重复练习无法替代真正的理解。一道真正弄懂的例题，远胜二十道机械练习。" },
  { icon: "→", title: "理解即效率", body: "孩子一旦真正理解了概念，掌握新题型的速度会让你吃惊。理解是最高效的学习方式。" },
  { icon: "♡", title: "关注心理", body: "不认同\"你不学有的是人学\"的筛选逻辑。会尽量让孩子在轻松的状态下慢慢建立自信。" },
];

const FAQS = [
  { q: "适合什么阶段的学生？", a: "主要面向初中生（初一到初三），同时接受小学高年级（四至六年级）的学生。" },
  { q: "小班课一般几个人？", a: "通常3-6人，确保每个孩子都能得到足够的关注。按程度分班，保证同班孩子的基础相近。" },
  { q: "你对学生有什么要求？", a: "只有一条：主观上愿意学。我会负责讲清楚、讲耐心，但如果孩子完全没有学习意愿，我们可能不是最合适的组合。" },
  { q: "会布置大量课后作业吗？", a: "不会。课后练习以精为主，我更看重孩子能否用自己的话解释解题逻辑，而不是完成多少道题。" },
];

function useFadeIn() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, visible];
}

function FadeIn({ children, delay = 0 }) {
  const [ref, visible] = useFadeIn();
  return (
    <div ref={ref} style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s` }}>
      {children}
    </div>
  );
}

function HomePage({ onGoTool }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const SL = ({ id, children }) => (
    <a href={"#" + id} style={{ fontSize: 12, color: "#8a7a5a", textDecoration: "none", letterSpacing: "0.8px", transition: "color 0.2s" }}
      onMouseEnter={e => e.target.style.color = "#1a1410"}
      onMouseLeave={e => e.target.style.color = "#8a7a5a"}>{children}</a>
  );

  return (
    <div style={{ fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif", color: "#1e1a14", background: "#fff" }}>
      {/* Nav */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: scrolled ? "rgba(252,251,248,0.95)" : "transparent", backdropFilter: scrolled ? "blur(12px)" : "none", borderBottom: scrolled ? "0.5px solid #ede8df" : "none", transition: "all 0.3s", padding: "0 5%", display: "flex", alignItems: "center", justifyContent: "space-between", height: 58 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: "#1a1410" }}>信望数理 <span style={{ color: "#c8860a" }}>·</span> 彭老师</div>
        <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
          <SL id="理念">理念</SL>
          <SL id="成果">成果</SL>
          <SL id="工具">工具</SL>
          <SL id="常见问题">常见问题</SL>
          <SL id="联系">联系</SL>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "120px 8% 80px", background: "#fffdf8", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: "6%", top: "50%", transform: "translateY(-50%)", fontSize: 200, color: "#f0e8d0", fontWeight: 900, lineHeight: 1, userSelect: "none", pointerEvents: "none", fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>数</div>
        <div style={{ maxWidth: 600, position: "relative" }}>
          <div style={{ display: "inline-block", fontSize: 11, letterSpacing: "3px", color: "#c8860a", background: "#fef3dc", padding: "4px 14px", borderRadius: 20, marginBottom: 24, fontWeight: 500 }}>初中 · 小学数学 · 小班课</div>
          <h1 style={{ fontSize: "clamp(34px,5vw,54px)", fontWeight: 500, lineHeight: 1.3, color: "#1a1410", margin: "0 0 10px", fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>理解先于解题</h1>
          <h1 style={{ fontSize: "clamp(34px,5vw,54px)", fontWeight: 500, lineHeight: 1.3, color: "#c8860a", margin: "0 0 22px", fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>思维重于练习</h1>
          <p style={{ fontSize: 16, color: "#6a5a3a", lineHeight: 1.95, margin: "0 0 36px", maxWidth: 460 }}>数学不是做题量的竞赛。<br />当孩子真正读懂一个概念，<br />他面对新题型时的从容，会让你看到不同。</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a href="#联系" style={{ background: "#1a1410", color: "#fef3dc", padding: "13px 30px", borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: "none", letterSpacing: "1px" }}>预约体验课</a>
            <button onClick={onGoTool} style={{ background: "transparent", color: "#1a1410", padding: "13px 30px", borderRadius: 8, fontSize: 14, fontWeight: 500, border: "1.5px solid #c8a050", cursor: "pointer", letterSpacing: "1px" }}>试用 AI 作业检查</button>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 48, left: "8%", right: "8%", display: "flex", gap: 48, borderTop: "0.5px solid #e8dcc8", paddingTop: 28, flexWrap: "wrap" }}>
          {[["3+", "年教学经验"], ["50+", "服务学生"], ["平均↑22分", "中考提分"]].map(([n, l]) => (
            <div key={l}><div style={{ fontSize: 26, fontWeight: 500, color: "#1a1410", fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>{n}</div><div style={{ fontSize: 11, color: "#8a7a5a", letterSpacing: "1px", marginTop: 2 }}>{l}</div></div>
          ))}
        </div>
      </section>

      {/* Philosophy */}
      <section id="理念" style={{ padding: "80px 8%", background: "#1a1410" }}>
        <FadeIn>
          <div style={{ fontSize: 10, letterSpacing: "4px", color: "#c8860a", marginBottom: 12, fontWeight: 500 }}>TEACHING PHILOSOPHY</div>
          <div style={{ fontSize: 26, fontWeight: 500, color: "#f5ead0", marginBottom: 40, fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>教学理念</div>
        </FadeIn>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 2 }}>
          {PHILOSOPHY.map((p, i) => (
            <FadeIn key={p.title} delay={i * 0.1}>
              <div style={{ padding: "32px 24px", background: i % 2 === 0 ? "#211a12" : "#1e1812", transition: "background 0.2s", cursor: "default" }}
                onMouseEnter={e => e.currentTarget.style.background = "#b87820"}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "#211a12" : "#1e1812"}>
                <div style={{ fontSize: 22, color: "#c8a050", marginBottom: 14, fontFamily: "monospace" }}>{p.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: "#f5ead0", marginBottom: 10 }}>{p.title}</div>
                <div style={{ fontSize: 13, color: "#b0a080", lineHeight: 1.85 }}>{p.body}</div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* Results */}
      <section id="成果" style={{ padding: "80px 8%", background: "#fffdf8" }}>
        <FadeIn>
          <div style={{ fontSize: 10, letterSpacing: "4px", color: "#c8860a", marginBottom: 12, fontWeight: 500 }}>STUDENT RESULTS</div>
          <div style={{ fontSize: 26, fontWeight: 500, color: "#1a1410", marginBottom: 40, fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>学生成果</div>
        </FadeIn>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16, marginBottom: 20 }}>
          {RESULTS.map((r, i) => (
            <FadeIn key={r.name} delay={i * 0.1}>
              <div style={{ border: "0.5px solid #ede8df", borderRadius: 12, padding: "24px 20px", background: "#fff", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#c8a050,#e8c870)" }} />
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "flex-start" }}>
                  <div><div style={{ fontSize: 14, fontWeight: 500, color: "#1a1410" }}>{r.name}</div><div style={{ fontSize: 11, color: "#8a7a5a", marginTop: 2 }}>{r.grade} · {r.duration}</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 11, color: "#8a7a5a" }}>{r.before}</span>
                    <span style={{ color: "#c8a050" }}>→</span>
                    <span style={{ fontSize: 18, fontWeight: 500, color: "#2a7a2a", fontFamily: "monospace" }}>{r.after}</span>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "#4a3a20", lineHeight: 1.8, fontStyle: "italic", borderLeft: "2px solid #e8c870", paddingLeft: 12 }}>"{r.quote}"</div>
              </div>
            </FadeIn>
          ))}
        </div>
        <div style={{ background: "#fef3dc", borderRadius: 10, padding: "16px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, border: "0.5px solid #f0d880", flexWrap: "wrap" }}>
          <p style={{ fontSize: 12, color: "#7a5a20", lineHeight: 1.7, margin: 0 }}>以上数据来自真实学生，成绩提升因人而异。我不做夸大承诺，但会尽全力帮助每一个愿意学习的孩子。</p>
          <a href="#联系" style={{ background: "#1a1410", color: "#fef3dc", padding: "10px 20px", borderRadius: 6, fontSize: 12, fontWeight: 500, textDecoration: "none", whiteSpace: "nowrap" }}>预约体验课</a>
        </div>
      </section>

      {/* Tool */}
      <section id="工具" style={{ padding: "80px 8%", background: "#f0ebe0" }}>
        <FadeIn>
          <div style={{ fontSize: 10, letterSpacing: "4px", color: "#c8860a", marginBottom: 12, fontWeight: 500 }}>AI TOOL</div>
          <div style={{ fontSize: 26, fontWeight: 500, color: "#1a1410", marginBottom: 14, fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>AI 作业检查工具</div>
          <p style={{ fontSize: 14, color: "#6a5a3a", lineHeight: 1.85, maxWidth: 520, marginBottom: 28 }}>家长拍一张作业照片，AI 自动识别解题步骤，检测跳步、符号错误，并解释原因——不只告诉孩子"错了"，更告诉他"为什么错"。</p>
        </FadeIn>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
          {[["📷", "拍照上传", "家长直接用手机拍，无需下载app"], ["🔍", "AI识别", "自动识别手写，逐行分析步骤"], ["📋", "解释原因", "不只说错了，还解释为什么"], ["📡", "同步后台", "彭老师实时看到所有批改记录"]].map(([icon, title, desc]) => (
            <div key={title} style={{ background: "#fff", borderRadius: 10, padding: "18px 16px", border: "0.5px solid #e0d4c0" }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>{icon}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1410", marginBottom: 4 }}>{title}</div>
              <div style={{ fontSize: 11, color: "#8a7a5a", lineHeight: 1.7 }}>{desc}</div>
            </div>
          ))}
        </div>
        <div style={{ background: "#1a1410", borderRadius: 12, padding: "26px 30px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, color: "#fef3dc", marginBottom: 5 }}>现在就可以试用</div>
            <div style={{ fontSize: 12, color: "#a08040", lineHeight: 1.7 }}>无需下载，手机浏览器直接使用<br />支持一元一次方程、因式分解等多种题型</div>
          </div>
          <button onClick={onGoTool} style={{ background: "#c8a050", color: "#1a1410", padding: "13px 28px", borderRadius: 6, fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>立即体验 →</button>
        </div>
      </section>

      {/* FAQ */}
      <section id="常见问题" style={{ padding: "80px 8%", background: "#fffdf8" }}>
        <FadeIn>
          <div style={{ fontSize: 10, letterSpacing: "4px", color: "#c8860a", marginBottom: 12, fontWeight: 500 }}>FAQ</div>
          <div style={{ fontSize: 26, fontWeight: 500, color: "#1a1410", marginBottom: 36, fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>常见问题</div>
        </FadeIn>
        <div style={{ maxWidth: 640 }}>
          {FAQS.map((faq, i) => (
            <div key={i} style={{ borderBottom: "0.5px solid #ede8df" }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "18px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "#1a1410", lineHeight: 1.5 }}>{faq.q}</span>
                <span style={{ fontSize: 18, color: "#c8a050", flexShrink: 0, transform: openFaq === i ? "rotate(45deg)" : "rotate(0)", transition: "transform 0.2s" }}>+</span>
              </button>
              <div style={{ maxHeight: openFaq === i ? 200 : 0, overflow: "hidden", transition: "max-height 0.3s ease" }}>
                <div style={{ fontSize: 13, color: "#5a4a30", lineHeight: 1.9, paddingBottom: 18 }}>{faq.a}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section id="联系" style={{ padding: "80px 8%", background: "#1a1410" }}>
        <div style={{ maxWidth: 560 }}>
          <FadeIn>
            <div style={{ fontSize: 10, letterSpacing: "4px", color: "#c8860a", marginBottom: 12, fontWeight: 500 }}>CONTACT</div>
            <div style={{ fontSize: 26, fontWeight: 500, color: "#f5ead0", marginBottom: 16, fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif" }}>预约体验课</div>
            <p style={{ fontSize: 14, color: "#b0a080", lineHeight: 1.9, marginBottom: 32 }}>第一次课为体验课，先聊聊孩子目前的情况和困惑，看看是否合适一起合作。没有任何压力。</p>
          </FadeIn>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
            {[["💬", "微信", "请扫描下方二维码联系"], ["🖥", "授课方式", "线上（腾讯会议 / 钉钉）"], ["✓", "收费方式", "体验课后再决定是否继续，无需预付"]].map(([icon, label, val]) => (
              <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 14, background: "#211a12", borderRadius: 10, padding: "14px 18px" }}>
                <span style={{ fontSize: 17, color: "#c8a050" }}>{icon}</span>
                <div><div style={{ fontSize: 10, letterSpacing: "2px", color: "#a09070", marginBottom: 2 }}>{label}</div><div style={{ fontSize: 14, color: "#f0e4cc" }}>{val}</div></div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, width: 110, height: 110, background: "#2a2218", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6, border: "0.5px solid #3a3020" }}>
            <span style={{ fontSize: 26, color: "#6a5a40" }}>▦</span>
            <div style={{ fontSize: 10, color: "#6a5a40", textAlign: "center", lineHeight: 1.5 }}>微信二维码<br />（替换此处）</div>
          </div>
        </div>
      </section>

      <footer style={{ background: "#110e08", padding: "18px 8%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#8a7a5a" }}>信望数理 <span style={{ color: "#c8860a" }}>·</span> 彭老师</div>
        <div style={{ fontSize: 11, color: "#3a2a18" }}>专注初中 · 小学数学小班课辅导</div>
      </footer>
    </div>
  );
}

// ══════════════════════════════════════════════════
//  作业批改工具组件
// ══════════════════════════════════════════════════

const PROBLEM_TYPES = {
  "一元一次方程":   { steps: ["去分母","去括号","移项","合并同类项","系数化为1"], color: "#4080e0" },
  "一元二次方程":   { steps: ["整理标准形式","选择解法","求解","检验"], color: "#e04060" },
  "二元一次方程组": { steps: ["标注方程","消元","求解","代入验证"], color: "#c04080" },
  "因式分解":       { steps: ["提公因式","套用公式/十字相乘","验证"], color: "#c8860a" },
  "整式运算":       { steps: ["去括号","套乘法公式","合并同类项"], color: "#e08020" },
  "分式化简":       { steps: ["分解分子","分解分母","约分"], color: "#40a860" },
  "分式方程":       { steps: ["找最简公分母","去分母","解方程","验根"], color: "#9040c8" },
  "不等式":         { steps: ["去分母/去括号","移项","合并","系数化为1","数轴表示"], color: "#20a0c0" },
  "根式化简":       { steps: ["提完全平方数","化简","有理化分母"], color: "#60a030" },
  "实数运算":       { steps: ["处理绝对值/乘方/开方","按顺序计算"], color: "#8060c0" },
  "有理数运算":     { steps: ["化简符号","移项归类(带符号搬家)","分组口算","写出结果"], color: "#ff6b9d" },
  "其他计算题":     { steps: [], color: "#8a7a5a" }
};

const ISSUE_COLORS = { "移项符号错误":"#ff4d6d","跳步":"#ff9a3c","计算错误":"#c77dff","去括号错误":"#e05080","漏提公因式":"#ff6b35","分解不彻底":"#e8a030","漏验根":"#9040c8","约分错误":"#40a860","漏解":"#e04060","符号错误":"#ff4d6d","乘法公式错误":"#c8860a","不等号方向错误":"#20a0c0","漏验证":"#c04080","去分母漏乘":"#ff6b35","增根未舍去":"#9040c8","约项错误":"#e05080","运算顺序错误":"#8060c0","绝对值错误":"#8060c0","负数乘方错误":"#8060c0","漏负号":"#ff4d6d","去括号变号错误":"#e05080","乘方括号错误":"#c8860a","负号个数错误":"#ff6b9d","预处理不彻底":"#e8a030" };
const ISSUE_ICONS  = { "移项符号错误":"±","跳步":"⤵","计算错误":"✗","去括号错误":"()","漏提公因式":"∑","分解不彻底":"◑","漏验根":"✓?","约分错误":"÷","漏解":"②","符号错误":"±","乘法公式错误":"□","不等号方向错误":"≷","漏验证":"?","去分母漏乘":"×","增根未舍去":"⊗","约项错误":"÷","运算顺序错误":"①","绝对值错误":"|x|","负数乘方错误":"²","漏负号":"±","去括号变号错误":"()","乘方括号错误":"²","负号个数错误":"±±","预处理不彻底":"⇢" };
const issueColor = (t) => ISSUE_COLORS[t] || "#74c0fc";
const issueIcon  = (t) => ISSUE_ICONS[t]  || "!";

const SYSTEM_PROMPT = `你是一位严格但耐心的初中数学老师，能检查所有类型计算题的解题过程。图片中有几道题就批改几道题，一道都不能漏。识别变量名时只使用图片中实际出现的字母，不要捏造不存在的字母。发现第一处根本性错误后只报告该错误，不再分析后续步骤。识别算式时请特别注意区分"÷"（除号，上下各带一个小圆点）与"-"（减号/负号，单独一条横线）——手写体潦草时两者容易混淆，请仔细辨认图片中的实际笔画，不要凭"题目通常长什么样"去猜测符号，误判符号会导致后续所有分析都建立在错误的原题上。

【有理数运算专项标准（初一，竖式分步骤格式）】这是当前最重要的题型，重点不是"答案对不对"，而是"每一步的处理是否规范"。学生作业通常按步骤竖排书写，请逐步对照检查，严格遵循以下七类错误的判定标准，发现即标注，不得因最终数值答案凑巧正确而判定为"正确"：
1. 漏负号：这是最容易被忽略、也最需要重点核查的一类，请对解题过程中**每一步出现的加减运算**都执行以下独立验证，不要只在"看起来像例子"时才检查：先分别确定参与运算的两个数各自的符号和绝对值，再按"同号相加取相同符号、绝对值相加；异号相加取较大绝对值的符号、两绝对值相减"的法则重新推算一遍正确结果的符号，最后对照学生写出的符号是否一致。常见出错模式：学生只对绝对值/分子部分做了加减运算（比如 -1/4 与 3/4 相加，只算了 1+3=4 这部分数字），却没有按上述法则重新判断结果应该带的符号，而是直接沿用了某一项原有的负号或随意添加负号（比如把 -1/4+3/4 错误地写成 -1，正确结果应为异号相加、3/4绝对值更大，结果取正号，即 1/2）。只要发现某一步骤的符号与"先定符号再定绝对值"法则推算的结果不一致，立即判定为该错误，无论学生是否在后续步骤"碰巧"得到了正确的最终答案。
2. 去括号变号错误：括号前是负号、括号符号为小括号"()"或中括号"[]"时，括号内每一项符号必须取反（例如 -(3-5)=-3+5，而不是 -(3-5)=-3-5）；只要有一项符号未正确翻转，即判定为该错误。注意：此类错误专指"()"或"[]"小括号/中括号，不包括绝对值符号"| |"，绝对值符号的处理见第5类。
3. 乘方括号错误：必须区分 -2² 和 (-2)² ——前者表示"2²再取负"，结果为 -4；后者表示"先加括号再乘方"，结果为 4。只有当学生的计算结果**实际体现出**把两者弄反了（例如把 -2² 当成 (-2)² 来算、得到了 4 而不是 -4；或者反过来把 (-2)² 当成 -2² 来算、得到了 -4 而不是 4），才判定为该错误。如果学生自始至终都正确保留了 -2² 这种写法、只是暂时还没有把它代入具体数值参与下一步运算（这种"尚未计算"的情况属于第7类"预处理不彻底"，请归入第7类），不要重复判定为本类错误。【重要澄清，避免误判】把"÷(某数)ⁿ"改写成"×(1/某数)ⁿ"是完全合法的等价变形（因为 1÷aⁿ = (1÷a)ⁿ 恒成立，例如 ÷(-4)³ 等价于 ×(-1/4)³，两者数值必然相等，不存在"数值不同"的问题）；同理把除数直接写成分数形式、连同指数一起保留（如把 ÷(-4)³ 写成 ×(-1/4)³）也是合法的，不要因为学生把"底数"从整数换成了分数形式，就误判为"混淆了底数""数值不同"，这类等价变形本身没有错，只有当学生后续没有把这个式子算出正确数值时，才可能触发第7类"预处理不彻底"。【具体反例，务必记住】"-2²÷(-4)³ 改写为 -2²×(-1/4)³"这个具体变形是完全正确的，不涉及"-2² 与 (-2)² 混淆"这个问题（这一步压根没有对 -2² 本身做任何改动，只是把除法转成了乘法），如果你发现自己想把这一步判定为"乘方括号错误"，请停下来重新检查：真正的乘方括号错误必须是学生对某个"底数带负号的乘方"算出了错误的数值，而不是"除转乘"这个变形动作本身。
4. 负号个数错误：乘除运算中多个负数相乘除时，结果符号取决于负号个数的奇偶（奇数个负号→结果为负，偶数个负号→结果为正）。学生若数错负号个数导致最终符号判断错误，判定为该错误。
5. 绝对值错误：遇到绝对值符号"| |"时，必须先计算绝对值内部的真实数值（含符号的代数和），再根据正负判断去掉绝对值符号后的结果（内部为正或0则直接去掉符号，内部为负则取相反数）。常见错误：把绝对值符号内的算式直接拆开展开（如把 -|-1+1/2| 错误地展开成 -1+1/2，丢失了绝对值符号本应起到的"先算清楚内部、再判断正负"这一步），或绝对值内部算对了但取符号时出错。只要绝对值的处理过程（不管是符号"| |"丢失、内部计算错误，还是正负判断错误）出现问题，都归类为"绝对值错误"，不要归类为"去括号变号错误"。
6. 运算顺序错误：加号、减号两侧的每一"项"都是相互独立的，必须先在项内部把乘除运算独立算到底、得出该项的最终数值，才能进行项与项之间的加减；严禁跨越加号/减号，把不同项里的数字（例如某一项的分母与另一项的分子或整数）直接拿来约分或凑在一起计算——哪怕数字表面上能约分。判定方法：把学生的每一步按"加减号"切开分成若干项，检查每一项内部的数字是否只来自该项自身、有没有出现其他项的数字混入。只要发现某一步骤中，参与同一次乘除/约分的数字分别来自加减号两侧的不同项，即判定为该错误，描述中应指出具体是哪个数字被错误地跨项使用了。
7. 预处理不彻底（跳步）：在含有小数、带分数、除法的混合运算中，规范做法是先只做等价变形、不做实际运算，具体包括：(a) 小数应直接化为最简分数（如 0.8 应写成 4/5，而不是化成分母为10的分数或保留小数形式再往后算）；(b) 带分数应化为假分数；(c) 遇到除以一个数时，应先单独把除数变成分数，再单独写出一步把"除以"改写成"乘以其倒数"，这两步不能合并跳过；(d) 若算式中含有乘方且后续还需要对该项做除转乘等其他变形，应先把乘方独立算出具体数值、单独写出结果，再进行下一步变形，不要在乘方还未算出数值时就同时处理其他变形，避免一步内同时处理两件不同性质的事情。只要学生跳过了上述任一变形步骤、直接给出得数或下一步结果，即使数值凑巧正确，也应指出该步骤不规范、跳步了。
【steps_detected 判定标准，有理数运算题型专用】本题型的规范解法分为三步，请据此填写 steps_detected/skipped_steps（标签分别为"化简符号"、"移项归类(带符号搬家)"、"分组口算"、"写出结果"）：
- 化简符号：把算式中多重正负号按"奇负偶正"化简为单一符号，这一步只改符号、不改变任何数字本身。
- 移项归类(带符号搬家)：在化简符号之后，是否观察了数字特征（同分母、同号可凑整、异号且尾数相同可相消等），把式子里的项重新排列分组，方便计算——只要看到学生把项们重新排列组合、而不是死板地从左到右按原顺序逐项计算，就判定为检测到这一步；如果学生原式本身各项已经是最优顺序、无需搬家即可直接分组计算，也视为满足这一步，不要因为"没有明显搬家动作"就判定跳过。只有当学生完全按原始顺序从左到右逐项计算、且明显存在更简便的分组方式却没有使用时，才判定为跳过（skipped）这一步；这不算错误，不扣分，只是步骤完整性提示。
- 分组口算：分组后的计算本身是否正确（这一项如果出错，应体现在 issues 的具体错误分类里，不要在这里重复描述）。
- 写出结果：是否清晰写出最终结果。
这四项步骤检测仅用于步骤完整性展示，不作为扣分依据；扣分仍然完全依据前面的七类错误标准。

判分要求：只要解题过程中的任意一步触发上述七类错误之一，该题 overall 必须判定为"有问题"并相应扣分，即使学生最终写出的数值答案与正确答案一致（蒙对/抵消纠错），也不能给"正确"判定。请完整检查解题过程的每一步，不要在发现第一处错误后就停止分析——但 issues 数组最多列出 2-3 个最值得指出的错误（按出现顺序优先选择前面步骤的错误），避免一次性给出过多批注让学生困惑；若同一类错误在多个步骤重复出现，只需挑一次代表性的指出即可。【去重澄清，务必遵守】这里的"同一个错误"不是按"行号"区分，而是按"具体是哪个数字/哪个知识点没处理好"来判断——例如"0.2 这个小数没有化成 1/5 参与运算"，如果学生在第2行、第3行都保留着 0.2 没有转换，这是**同一个**预处理疏漏（他从头到尾就没做这个转换），只能算一条错误，只在它第一次出现的地方报告一次，不要在后面每一行只要看到 0.2 还在，就重复再报一次。
【根源错误合并，非常重要】在报告 issues 之前，请先判断：后面步骤里发现的"异常"，是不是**仅仅因为前面已经报告过的那一处错误导致的连锁反应**（也就是说，如果没有前面那个错误，后面这一步根本不会存在，或者后面这一步分析的数字本身就是前面错误直接产生的、不具备独立分析价值）。如果是，只报告最早、最根本的那一条错误，不要把它的下游连锁反应也当成独立的错误逐条列出——这样做只会让学生看到一堆其实指向同一件事的批注，无从下手。举例：如果某一步出现"跨项拼凑"的错误（第6类），导致下一步得到一个毫无意义的中间结果，那么下一步里针对这个毫无意义结果所做的"符号判断"分析（比如讨论它该不该带负号）就不应该再单独列为一条"漏负号"，因为这个数本身就是错的、讨论它的符号毫无意义，只需要保留"跨项拼凑"这一条根源错误即可。
【描述准确性自查，避免与实际内容矛盾】撰写 description 之前，请回头核对一遍：你声称"某一步骤没有做某个转换"，是否在该步骤或更早的步骤里其实已经做过了？如果一个转换已经体现在算式里（比如带分数已经变成了假分数），就不能再说"未化为假分数"，这种自相矛盾的描述会让学生和老师直接质疑批改的可信度。
【第1类与第6类的区分，容易混淆，请特别注意】漏负号（第1类）专指：针对**同一个加减运算**，学生正确识别了参与运算的两个数字本身，但对运算结果应带的正负号判断错误。运算顺序错误（第6类）专指：学生把本不该放在一起运算的**两个不同项**里的数字（例如某一项的分子、系数，和另一项的分母、系数）跨越加减号拼凑到了一起，导致算出的数字组合本身就不是任何一项的正确计算结果。判断时先确认：出错的数字组合，其两个数字是否分别来自不同的项？如果是，无论表面上是否也牵涉到负号，都应判定为第6类而不是第1类；只有当参与运算的两个数确实都来自同一次加减运算、纯粹是符号判断错了，才判定为第1类。
【description 字段具体化要求】所有 issues 中的 description 必须清楚点出：具体是哪个数字、来自算式中的哪一项、发生了什么样的错误（例如"被误算成了""被跨项拿来和……拼在一起""还没算出数值就……"），禁止使用"符号处理不规范""计算有误""结果不准确"等笼统措辞——这类描述无法让学生知道自己具体错在哪一步、哪个数字，起不到批改的作用。
【重要】summary 与 issues 必须一一对应，不允许出现不一致：如果 overall 判定为"有问题"，issues 数组绝对不能为空，必须至少包含一条与 summary 描述相符的具体错误；反之如果 issues 数组为空，overall 只能是"正确"，summary 也不能出现"存在错误/存在问题"之类的措辞。生成 summary 之前，请先确定 issues 数组的具体内容，再依据 issues 里实际列出的错误来撰写 summary，不要独立编写一段与 issues 数组脱节的总结文字。
【禁止无依据的保留措辞】当 issues 数组为空、overall 为"正确"时，summary 必须是纯粹的肯定评价，禁止出现"但""不过""仍需""需注意""需加强""应更加注意"等任何暗示"其实还有点问题/还不够好"的转折或保留用语——这类措辞如果不能对应到 issues 数组里的一条具体记录，就是没有事实依据的场面话，会让老师和家长误以为存在没写清楚的问题。如果你确实观察到某个值得提醒、但还不足以算作错误的细节（比如"这道题步骤简单，其实可以引导学生尝试更快的分组算法"），可以放进 praise 字段作为积极建议，但不要放进 summary、也不要用"但需注意"这种口吻。

【其他题型检查重点，仅在图片确实是对应题型时使用】一元一次方程：跳步（去分母和去括号合并），去括号符号（用乘法分配律解释），移项变号；一元二次方程：漏解，判别式，各解法符号；二元一次方程组：消元计算，漏验证；因式分解：漏提公因式，公式套用，分解不彻底；整式运算：乘法公式漏项，去括号负号；分式化简：约项错误，漏条件；分式方程：去分母漏乘，漏验根，增根；不等式：乘除负数不变号，数轴端点；根式化简：提取不彻底，有理化；实数运算（含根号/绝对值的混合运算，区别于初一有理数运算）：绝对值，负数乘方，运算顺序。

【二次根式专项标准（初二，涉及化简、乘除、加减合并）】判断这部分题目时，请用"同级可搬家、邻级可分配、跳级老实算"这套框架来组织分析：同一级运算（加减之间、乘除之间）内部的各项可以自由搬动位置和符号；相邻两级运算之间可以按"分配"的形式展开或合并（一级/二级之间即乘法对加减的分配律 a(b+c)=ab+ac，对任何实数都无条件成立；二级/三级之间即乘方/开方对乘除的类分配关系 √(ab)=√a·√b、(ab)ⁿ=aⁿbⁿ，但这一层**是有前提条件的**，仅当 a≥0 且 b≥0 时才成立，不能像一级/二级之间那样无条件套用）；跨越了中间层级（比如加法直接跳到乘方，中间跳过了乘除这一级）的，没有结构捷径可走，必须老老实实按顺序展开计算，例如 (a+b)²≠a²+b²，只能用完全平方公式展开。

请重点核查以下几类问题：
1. 化简不彻底：最简二次根式必须同时满足三个条件——被开方数不含能开得尽方的因数（如 √12 应化为 2√3）、被开方数不是分数（如 √(1/2) 应化为 √2/2）、分母不含根号（分母有理化）。只要有一条没做到、且后续运算基于这个未化简的形式继续进行，判定为化简不彻底。
2. √(a²)=|a| 的绝对值处理：只要 a 的正负不确定（a 是字母，或是一个可能为负的代数式），√(a²) 必须先写成 |a|，再根据题目给出的范围信息决定是否能去掉绝对值符号。直接把 √(a²) 写成 a、跳过绝对值这一步，判定为该错误，无论最终数值是否凑巧正确。
3. 同类二次根式合并错误：这是有理数运算里"运算顺序错误（跨项拼凑）"在根式语境下的对应情形，判断时必须先追溯每一项的来源——只有先化简成最简二次根式后，被开方数完全相同的项才能合并系数。常见两种反方向的错误都要抓：(a) 没有先化简就误判两个根式不是同类项，比如误认为 √8 和 √2 不能合并（其实 √8=2√2，能合并）；(b) 被开方数其实不同，却被强行合并（比如把 √2+√3 直接算成 √5）。描述时必须明确指出被合并（或被误判不能合并）的两个根式被开方数分别是什么，不能只笼统说"合并错误"。
4. 二次根式有意义的前提条件遗漏：算式中出现字母时，动笔化简或计算前必须先确认被开方数≥0（如果字母出现在分母，还需同时满足分母≠0）。跳过这一步直接开始计算，即使数值结果正确，也判定为过程不规范。
5. 乘除法则的适用条件：√a·√b=√(ab) 需要 a≥0 且 b≥0，√a/√b=√(a/b) 需要 a≥0 且 b>0。如果算式中的 a、b 是可能为负的字母或代数式，学生若没有确认这个前提就直接套用公式展开或合并，判定为该错误。
6. 完全平方公式/平方差公式在根式中的符号处理：例如展开 (√5-1)² 时漏掉中间的交叉项 -2√5，判定为该错误，描述中需具体指出漏掉或算错的是哪一项。
【多种解法都合法，不要误判方法选择本身，这一条极其重要】二次根式相乘（√a×√b）时，"先化简每个根式再相乘"和"先把被开方数相乘、结果再统一化简"两种方法都完全合法（例如 √8×√2，算成 2√2×√2=4 和算成 √16=4 都是正确解法），不能因为学生选择了其中一种方法、或者这种写法你觉得"不常见"，就判定为不规范或错误；只有当学生选择的方法本身在执行过程中出现了真正的计算错误（比如乘错数字、化简结果不是最简二次根式）时，才判定为错误，方法本身的选择不构成任何扣分点。
判分要求：与有理数运算部分一致——只要触发上述任意一类错误，overall 必须判定为"有问题"并相应扣分，即使最终数值凑巧正确也不能判"正确"；issues 数组同样最多列出2-3条最值得指出的错误，遵循前面"去重"和"根源错误合并"的原则处理。

【公式书写格式】所有字段（transcription、content、description、suggestion、summary、praise）中如果出现数学表达式（分数、根号、绝对值、括号算式等），必须用 $ 符号把公式片段包裹起来，公式用标准 LaTeX 语法（如分数写作 \\frac{分子}{分母}），中文说明文字放在 $ 符号外面。例如："绝对值运算错误，$|-1+\\frac{1}{2}|=\\frac{1}{2}$，原式应转化为 $-\\frac{1}{2}$"。这样前端才能正确渲染成可读的数学排版，不按此格式输出会导致家长看到无法理解的代码符号。【输出前必须自查】在最终输出 JSON 之前，请逐个检查你写出的每一个 \\frac{...}{...}，确认左右两个大括号都完整闭合（一个 \\frac 必须有且只有两对完整的 { }），以及每一个 $ 符号是否都成对出现、没有漏掉收尾的 $；只要发现任何一处大括号或 $ 没有闭合，必须在输出前修正补全，绝不能让不完整的 LaTeX 代码（如缺少右花括号的 \\frac{25}{4）出现在最终输出中。

只返回JSON，字段值不含换行符，issues为空写[]：{"problems":[{"problem_number":1,"problem_type":"题型","transcription":["第1行","第2行"],"overall":"正确","score":90,"steps_detected":["步骤"],"skipped_steps":[],"issues":[{"line":1,"type":"错误类型","content":"该行内容","description":"含原理的说明","suggestion":"正确写法"}],"praise":"","summary":"总体评价"}]}`;

// 提交记录（作业照片、批改结果）现在统一存到云端数据库，由 /api/submissions.js 负责，
// 这样彭老师在教师后台任何设备上都能看到所有家长提交的记录，不再只存在各自手机本地。

// 这里只保留一个纯本地的小工具：记住"这台设备最近用过的学生姓名"，
// 方便同一个孩子反复用同一台手机拍照时，不用每次重新打字。
const RECENT_NAMES_KEY = "recent_student_names";
const getRecentNames = () => { try { const v = localStorage.getItem(RECENT_NAMES_KEY); return v ? JSON.parse(v) : []; } catch { return []; } };
const addRecentName = (name) => { if (!name) return; try { let list = getRecentNames().filter(n => n !== name); list.unshift(name); if (list.length > 5) list = list.slice(0, 5); localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(list)); } catch (_) {} };

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取失败"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("图片解析失败"));
      img.onload = () => {
        const isLandscape = img.width > img.height * 1.15; // 宽明显大于高，判定为横拍
        const MAX = 900; // 单道题文字量不大，900px足够清晰识别，缩小可减少视觉token、提升推理速度
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        cv.toBlob((blob) => {
          if (!blob) return reject(new Error("压缩失败"));
          const r2 = new FileReader();
          r2.onload = (e2) => { const full = e2.target.result; resolve({ data: full.split(",")[1], mediaType: "image/jpeg", preview: full, isLandscape }); };
          r2.onerror = () => reject(new Error("读取失败"));
          r2.readAsDataURL(blob);
        }, "image/jpeg", 0.85);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function parseResult(raw) {
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("AI未按格式返回结果，原始内容：" + raw.slice(0, 200));
  const js = raw.slice(s, e + 1);
  try { return JSON.parse(js.replace(/[\x00-\x1F\x7F]/g, c => c==="\n"?"\\n":c==="\r"?"\\r":c==="\t"?"\\t":"")); } catch (_) {}
  try {
    let out = "", inStr = false, esc = false;
    for (let i = 0; i < js.length; i++) {
      const c = js[i], code = c.charCodeAt(0);
      if (esc) { out += c; esc = false; continue; }
      if (c === "\\" && inStr) { esc = true; out += c; continue; }
      if (c === '"') {
        if (!inStr) { inStr = true; out += c; continue; }
        let j = i + 1;
        while (j < js.length && " \t\n\r".includes(js[j])) j++;
        const nx = js[j];
        if (nx === ":" || nx === "," || nx === "}" || nx === "]" || j >= js.length) { inStr = false; out += c; }
        else { out += '\\"'; }
        continue;
      }
      if (inStr && code < 32) { if (code===10){out+="\\n";continue;} if (code===13){out+="\\r";continue;} if (code===9){out+="\\t";continue;} continue; }
      out += c;
    }
    return JSON.parse(out);
  } catch (_) {}
  const gStr = (key) => { const m = raw.match(new RegExp('"'+key+'"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); return m?m[1]:""; };
  const gNum = (key) => { const m = raw.match(new RegExp('"'+key+'"\\s*:\\s*(\\d+)')); return m?parseInt(m[1]):0; };
  const gArr = (key) => { const m = raw.match(new RegExp('"'+key+'"\\s*:\\s*\\[([\\s\\S]*?)\\]')); if(!m)return[]; const items=[],re=/"((?:[^"\\\\]|\\\\.)*)"/g; let hit; while((hit=re.exec(m[1]))!==null)items.push(hit[1]); return items; };
  const result = { problem_type:gStr("problem_type"), transcription:gArr("transcription"), overall:gStr("overall")||"有问题", score:gNum("score"), steps_detected:gArr("steps_detected"), skipped_steps:gArr("skipped_steps"), issues:[], praise:gStr("praise"), summary:gStr("summary")||"解析完成。" };
  if (result.problem_type||result.transcription.length>0) return [result];
  throw new Error("AI未按格式返回结果，原始内容：" + raw.slice(0, 200));
}

function parseMultiResult(raw) {
  let parsed;
  try { parsed = parseResult(raw); } catch(e) { throw e; }
  if (parsed && parsed.problems && Array.isArray(parsed.problems)) return parsed.problems;
  if (Array.isArray(parsed)) return parsed;
  return [parsed];
}

function fmtTime(ts) {
  const d = new Date(ts);
  return (d.getMonth()+1)+"/"+d.getDate()+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}

function ResultPanel({ result }) {
  const typeInfo = PROBLEM_TYPES[result.problem_type] || PROBLEM_TYPES["其他计算题"];
  const stepsToShow = typeInfo.steps.length > 0 ? typeInfo.steps : ["解题步骤"];
  return (
    <div>
      {result.problem_type && (
        <div style={{display:"inline-flex",alignItems:"center",gap:6,background:typeInfo.color+"18",border:"1px solid "+typeInfo.color+"40",borderRadius:20,padding:"4px 12px",marginBottom:12}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:typeInfo.color}}/><span style={{fontSize:12,color:typeInfo.color,fontWeight:600}}>{result.problem_type}</span>
        </div>
      )}
      <div style={{background:result.overall==="正确"?"#e8f5e8":"#fdf0e0",border:"2px solid "+(result.overall==="正确"?"#60c060":"#e8a030"),borderRadius:14,padding:"18px 20px",display:"flex",alignItems:"center",gap:18,marginBottom:14}}>
        <div style={{fontSize:52,fontWeight:800,lineHeight:1,color:result.overall==="正确"?"#3a8a3a":"#c06020",fontFamily:"monospace"}}>{result.score}</div>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:result.overall==="正确"?"#3a8a3a":"#c06020",marginBottom:4}}>{result.overall==="正确"?"✓ 解题过程规范":"✗ 发现 "+(result.issues?.length||0)+" 处问题"}</div>
          <div style={{fontSize:13,color:"#5a4a30",lineHeight:1.7}}><MathText>{result.summary}</MathText></div>
        </div>
      </div>
      <div style={{fontSize:11,color:"#a08060",lineHeight:1.6,marginBottom:14,padding:"0 2px"}}>💡 以上为 AI 自动批改结果，仅供参考，不代表最终标准答案。如发现批改与实际不符，欢迎随时联系彭老师核实。</div>
      {result.transcription&&result.transcription.length>0&&(
        <div style={{background:"#faf6ee",border:"1px solid #d8c8a0",borderRadius:12,padding:"14px 18px",marginBottom:12}}>
          <div style={{fontSize:10,letterSpacing:3,color:"#8a7a5a",marginBottom:10}}>识别内容</div>
          {result.transcription.map((line,i)=>{
            const issue=result.issues&&result.issues.find(x=>x.line===i+1);
            return(<div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 8px",borderRadius:6,marginBottom:3,background:issue?issueColor(issue.type)+"18":"transparent",borderLeft:"3px solid "+(issue?issueColor(issue.type):"transparent")}}>
              <span style={{fontSize:10,color:"#a08060",fontFamily:"monospace",minWidth:18,paddingTop:2}}>{i+1}</span>
              <span style={{fontSize:14,flex:1}}><MathText>{line}</MathText></span>
              {issue&&<span style={{fontSize:10,background:issueColor(issue.type),color:"#fff",padding:"2px 7px",borderRadius:10,whiteSpace:"nowrap"}}>{issueIcon(issue.type)} {issue.type}</span>}
            </div>);
          })}
        </div>
      )}
      <div style={{background:"#faf6ee",border:"1px solid #d8c8a0",borderRadius:12,padding:"14px 18px",marginBottom:12}}>
        <div style={{fontSize:10,letterSpacing:3,color:"#8a7a5a",marginBottom:10}}>步骤完整性</div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {stepsToShow.map((step,i)=>{
            const detected=result.steps_detected&&result.steps_detected.some(s=>s.includes(step));
            const skipped=result.skipped_steps&&result.skipped_steps.some(s=>s.includes(step));
            return(<div key={i} style={{padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:600,background:skipped?"#ffe0e0":detected?"#e0f5e0":"#f0ebe0",color:skipped?"#c03030":detected?"#3a8a3a":"#8a7a5a",border:"1px solid "+(skipped?"#f0a0a0":detected?"#80c080":"#c8b898")}}>{skipped?"✗":detected?"✓":"—"} {step}</div>);
          })}
        </div>
      </div>
      {result.issues&&result.issues.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,letterSpacing:3,color:"#8a7a5a",marginBottom:10}}>错误详情</div>
          {result.issues.map((issue,i)=>(
            <div key={i} style={{background:"#fff",borderRadius:12,padding:"14px 16px",marginBottom:8,border:"1px solid "+issueColor(issue.type)+"40",borderLeft:"4px solid "+issueColor(issue.type),boxShadow:"0 2px 6px rgba(0,0,0,0.05)"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{background:issueColor(issue.type),color:"#fff",padding:"3px 10px",borderRadius:12,fontSize:11,fontWeight:700}}>{issueIcon(issue.type)} {issue.type}</span>
                <span style={{color:"#a08060",fontSize:11}}>第 {issue.line} 行</span>
              </div>
              {issue.content&&<div style={{background:"#f5f0e8",borderRadius:7,padding:"7px 10px",fontSize:14,color:"#3a2a10",marginBottom:8,border:"1px solid #e0d0b0"}}><MathText>{issue.content}</MathText></div>}
              <div style={{fontSize:13,color:"#4a3a20",marginBottom:6,lineHeight:1.7}}><MathText>{issue.description}</MathText></div>
              {issue.suggestion&&<div style={{fontSize:12,color:"#3a7a3a",fontWeight:600,background:"#eaf5ea",padding:"6px 10px",borderRadius:6}}>✓ <MathText>{issue.suggestion}</MathText></div>}
            </div>
          ))}
        </div>
      )}
      {result.praise&&<div style={{background:"#e8f5e8",border:"1px solid #a0d0a0",borderRadius:12,padding:"12px 16px",fontSize:13,color:"#3a6a3a",lineHeight:1.7}}>💬 <MathText>{result.praise}</MathText></div>}
    </div>
  );
}

function ParentView() {
  const [image,setImage]=useState(null);
  const [preview,setPreview]=useState(null);
  const [studentName,setStudentName]=useState("");
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [loadingMsg,setLoadingMsg]=useState("");
  const [loadingSec,setLoadingSec]=useState(0);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);
  const [dragOver,setDragOver]=useState(false);
  const [showTips,setShowTips]=useState(false);
  const [recentNames,setRecentNames]=useState([]);
  const fileRef=useRef(null);
  const camRef=useRef(null);
  const msgs=["正在识别手写内容...","逐行分析解题步骤...","检查符号处理...","核查跳步情况...","AI正在仔细批改，请耐心等待..."];

  useEffect(()=>{ const list=getRecentNames(); setRecentNames(list); if(list[0])setStudentName(list[0]); },[]);

  const processFile=async(file)=>{ if(!file||!file.type.startsWith("image/")){setError("请上传图片文件");return;} setError("正在压缩图片..."); try{const c=await compressImage(file);setImage({data:c.data,mediaType:c.mediaType});setPreview(c.preview);setResult(null);setSaved(false);setError(c.isLandscape?"⚠️ 检测到这张照片是横着拍的，文字会变成竖排，AI容易看错数字。建议删除重拍：手机竖直拿、文字方向跟平时写字一样。":"");}catch(e){setError("图片处理失败："+e.message);} };

  const handleCheck=async()=>{ if(!image){setError("请先上传照片");return;} setError("");setLoading(true);setResult(null);setSaved(false); setLoadingSec(0);
    let idx=0;setLoadingMsg(msgs[0]);
    const msgTimer=setInterval(()=>{idx=Math.min(idx+1,msgs.length-1);setLoadingMsg(msgs[idx]);},6000); // 前4条按6秒推进，到第5条后停住循环重复同一句，不再快速轮播造成"卡住"的错觉
    const secTimer=setInterval(()=>{setLoadingSec(s=>s+1);},1000);
    try{
      const res=await fetch("/api/grade",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageData:image.data,mediaType:image.mediaType,systemPrompt:SYSTEM_PROMPT,userPrompt:"请识别图片中学生的计算题解题过程，判断题型，检查错误，只返回JSON。"})});
      if(!res.ok){const d=await res.json().catch(()=>({}));const dbg=d?.debugRaw?("\n[调试信息]"+d.debugRaw):"";throw new Error("批改服务出错："+(d?.error||res.statusText)+dbg);}
      const data=await res.json();
      const text=data.text||"";
      const problems=parseMultiResult(text);
      setResult(problems);
      const id=Date.now().toString();
      const totalIssues=problems.reduce((n,p)=>n+(p.issues||[]).length,0);
      const avgScore=Math.round(problems.reduce((n,p)=>n+(p.score||0),0)/problems.length);
      const types=problems.map(p=>p.problem_type).filter(Boolean).join("、");
      const finalName=studentName.trim()||"未填写姓名";
      const submission={id,timestamp:Date.now(),studentName:finalName,score:avgScore,overall:problems.some(p=>p.overall!=="正确")?"有问题":"正确",issueCount:totalIssues,problemCount:problems.length,problemTypes:types,problems,thumbnail:preview};
      const saveRes=await fetch("/api/submissions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({submission})});
      if(!saveRes.ok){const d=await saveRes.json().catch(()=>({}));throw new Error("批改结果同步到后台失败："+(d?.error||saveRes.statusText)+"（批改结果仍会显示在下方，但可能未存入教师后台，请稍后重试或联系彭老师）");}
      if(studentName.trim())addRecentName(studentName.trim());
      setSaved(true);
    }catch(e){setError(e.message);}finally{clearInterval(msgTimer);clearInterval(secTimer);setLoading(false);}
  };

  const reset=()=>{setPreview(null);setImage(null);setResult(null);setSaved(false);setError("");};

  return(
    <div style={{minHeight:"100vh",background:"#f5f0e8",fontFamily:"'Noto Sans SC','PingFang SC',sans-serif"}}>
      <div style={{background:"#2a2218",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:10,letterSpacing:3,color:"#6a5a3a",marginBottom:2}}>信望数理 · 彭老师</div>
          <div style={{fontSize:18,fontWeight:700,color:"#f0e8d0"}}>计算题解题检查</div>
        </div>
      </div>
      <div style={{padding:"20px 16px",maxWidth:680,margin:"0 auto"}}>
        <div style={{background:"#fdf3dc",border:"1px solid #e8c870",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12.5,color:"#7a5a20",lineHeight:1.8}}>
          ⚠️ <b>批改结果由 AI 自动生成，仅供参考，不代表最终标准答案。</b>AI 是根据规则和概率去判断解题过程，可能出现误判。如果发现批改结果和实际情况不符，欢迎随时联系彭老师核实，我会及时修正。
        </div>
        {!preview&&(
          <div style={{marginBottom:14}}>
            <div onClick={()=>setShowTips(!showTips)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#faf6ee",border:"1px solid #d8c8a0",borderRadius:10,padding:"10px 14px",cursor:"pointer"}}>
              <span style={{fontSize:13,color:"#6a5a3a",fontWeight:600}}>📌 拍照小贴士，提高识别准确率</span>
              <span style={{fontSize:12,color:"#8a7a5a"}}>{showTips?"收起 ▲":"展开 ▼"}</span>
            </div>
            {showTips&&(
              <div style={{background:"#fdf8ec",border:"1px solid #e8d8b0",borderTop:"none",borderRadius:"0 0 10px 10px",padding:"12px 16px",fontSize:12.5,color:"#6a5a3a",lineHeight:1.9}}>
                <div style={{marginBottom:6}}>📱 <b>手机保持竖直拍照</b>，文字方向跟平时写字一样；横着拍会让AI认错数字，别为了让算式显得长就横拍</div>
                <div style={{marginBottom:6}}>📷 建议<b>一次只拍一道题</b>，识别更准确；多题混拍容易串题或漏题</div>
                <div style={{marginBottom:6}}>✍️ <b>负号要写清楚</b>，别和数字连笔挤在一起——这是符号判断最容易出错的地方</div>
                <div style={{marginBottom:6}}>📝 按步骤一行一行竖着写；演草和正式解题过程分开写，改错处划一道线表示删除（别涂成一团黑）</div>
                <div>💡 光线充足、镜头正对纸面拍摄，避免反光和阴影，整道题完整入镜</div>
              </div>
            )}
          </div>
        )}
        {!preview?(
          <div onDrop={(e)=>{e.preventDefault();setDragOver(false);if(e.dataTransfer.files[0])processFile(e.dataTransfer.files[0]);}} onDragOver={(e)=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onClick={()=>fileRef.current&&fileRef.current.click()} style={{border:"2px dashed "+(dragOver?"#e8a030":"#c8b898"),borderRadius:16,background:dragOver?"#fdf5e0":"#faf6ee",padding:"40px 20px",textAlign:"center",cursor:"pointer",marginBottom:16}}>
            <div style={{fontSize:48,marginBottom:12}}>📷</div>
            <div style={{fontSize:17,fontWeight:600,color:"#4a3a20",marginBottom:6}}>拍照上传作业</div>
            <div style={{fontSize:13,color:"#8a7a5a",marginBottom:20}}>支持拖拽、点击选择、或直接拍照</div>
            <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
              <button onClick={(e)=>{e.stopPropagation();fileRef.current&&fileRef.current.click();}} style={{background:"#2a2218",color:"#f0e8d0",border:"none",borderRadius:10,padding:"11px 22px",fontSize:14,cursor:"pointer",fontWeight:600}}>📁 选择图片</button>
              <button onClick={(e)=>{e.stopPropagation();camRef.current&&camRef.current.click();}} style={{background:"#e8a030",color:"#fff",border:"none",borderRadius:10,padding:"11px 22px",fontSize:14,cursor:"pointer",fontWeight:600}}>📸 直接拍照</button>
            </div>
          </div>
        ):(
          <div style={{marginBottom:14}}>
            <div style={{borderRadius:14,overflow:"hidden",border:"2px solid #d8c8a0",position:"relative",background:"#2a2218",marginBottom:10}}>
              <img src={preview} alt="作业" style={{width:"100%",display:"block",maxHeight:340,objectFit:"contain"}}/>
              <button onClick={reset} style={{position:"absolute",top:10,right:10,background:"rgba(0,0,0,0.6)",color:"#fff",border:"none",borderRadius:20,padding:"5px 12px",fontSize:12,cursor:"pointer"}}>重新上传</button>
            </div>
            {recentNames.length>0&&(
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                {recentNames.map(n=>(
                  <button key={n} onClick={()=>setStudentName(n)} style={{background:studentName===n?"#e8a030":"#faf6ee",color:studentName===n?"#fff":"#6a5a3a",border:"1px solid "+(studentName===n?"#e8a030":"#d8c8a0"),borderRadius:16,padding:"5px 12px",fontSize:12.5,cursor:"pointer",fontWeight:studentName===n?600:400}}>{n}</button>
                ))}
              </div>
            )}
            <input value={studentName} onChange={(e)=>setStudentName(e.target.value)} placeholder="请输入学生姓名（首次输入后，这台设备下次会自动记住）" style={{width:"100%",background:"#faf6ee",border:"1px solid #d8c8a0",borderRadius:10,padding:"10px 14px",fontSize:14,color:"#2a2218",outline:"none",boxSizing:"border-box"}}/>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={(e)=>{if(e.target.files&&e.target.files[0])processFile(e.target.files[0]);}}/>
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={(e)=>{if(e.target.files&&e.target.files[0])processFile(e.target.files[0]);}}/>
        {error&&<div style={{background:"#fde8e8",border:"1px solid #f0a0a0",borderRadius:10,padding:"10px 14px",color:"#a03030",fontSize:13,marginBottom:12,lineHeight:1.6}}>{error}</div>}
        {preview&&!loading&&!result&&(<button onClick={handleCheck} style={{width:"100%",background:"linear-gradient(135deg,#2a2218,#4a3a20)",color:"#f0e8d0",border:"none",borderRadius:12,padding:16,fontSize:16,fontWeight:700,cursor:"pointer",letterSpacing:2,marginBottom:12}}>开始批改 →</button>)}
        {loading&&(<div style={{background:"#2a2218",borderRadius:14,padding:24,textAlign:"center",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:14}}>{["#e8a030","#e06040","#c040a0","#4080e0","#40b060"].map((c,i)=>(<div key={i} style={{width:9,height:9,borderRadius:"50%",background:c,animation:"bounce 1.2s ease-in-out "+(i*0.15)+"s infinite"}}/>))}</div>
          <div style={{color:"#d0c0a0",fontSize:14,fontWeight:500,marginBottom:6}}>{loadingMsg}</div>
          <div style={{color:"#8a7a5a",fontSize:12}}>已用时 {loadingSec} 秒，AI正在仔细思考解题过程，通常需要1~2分钟，请耐心等待，不要离开页面</div>
        </div>)}
        {result&&Array.isArray(result)&&(
          <div>
            {saved&&<div style={{background:"#e8f0ff",border:"1px solid #a0b8f0",borderRadius:10,padding:"8px 14px",fontSize:12,color:"#3a5aa0",marginBottom:12}}>✓ 已同步至教师后台</div>}
            {result.length>1&&(<div style={{background:"#2a2218",borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
              <div style={{color:"#f0e8d0",fontSize:14,fontWeight:600}}>共识别 {result.length} 道题</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{result.map((p,i)=>{const tc=(PROBLEM_TYPES[p.problem_type]||PROBLEM_TYPES["其他计算题"]).color;return(<div key={i} style={{background:tc+"22",border:"1px solid "+tc+"50",borderRadius:16,padding:"3px 10px",fontSize:11,color:tc,fontWeight:600}}>第{i+1}题 {p.problem_type||"计算题"}{p.issues&&p.issues.length>0?<span style={{marginLeft:5,color:"#ff9a3c"}}>{"×"+p.issues.length}</span>:<span style={{marginLeft:5,color:"#60c060"}}>✓</span>}</div>);})}</div>
            </div>)}
            {result.map((problem,idx)=>(<div key={idx} style={{marginBottom:20}}>
              {result.length>1&&(<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><div style={{width:28,height:28,borderRadius:"50%",background:"#2a2218",display:"flex",alignItems:"center",justifyContent:"center",color:"#f0e8d0",fontSize:13,fontWeight:700,flexShrink:0}}>{idx+1}</div><div style={{height:"0.5px",flex:1,background:"#e0d0b0"}}/></div>)}
              <ResultPanel result={problem}/>
            </div>))}
            <button onClick={reset} style={{width:"100%",marginTop:8,background:"transparent",color:"#6a5a40",border:"1px solid #c8b898",borderRadius:10,padding:12,fontSize:14,cursor:"pointer"}}>检查下一份作业</button>
          </div>
        )}
      </div>
      <style>{`@keyframes bounce{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(-7px);opacity:1}}*{box-sizing:border-box}input::placeholder{color:#b0a080}`}</style>
    </div>
  );
}

function TeacherView({ onLogout, password }) {
  const [list,setList]=useState([]);
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);
  const [loadingDetail,setLoadingDetail]=useState(false);
  const [listError,setListError]=useState("");
  useEffect(()=>{loadList();},[]);
  const loadList=async()=>{
    setListError("");
    try{
      const r=await fetch("/api/submissions?password="+encodeURIComponent(password));
      const d=await r.json().catch(()=>({}));
      if(!r.ok){setListError(d?.error||"读取失败");setList([]);return;}
      setList(d.value||[]);
    }catch(_){setListError("网络请求失败，请检查网络后重试");setList([]);}
  };
  const loadDetail=async(id)=>{
    if(selected===id){setSelected(null);setDetail(null);return;}
    setSelected(id);setLoadingDetail(true);setDetail(null);
    try{
      const r=await fetch("/api/submissions?id="+encodeURIComponent(id)+"&password="+encodeURIComponent(password));
      const d=await r.json().catch(()=>({}));
      if(r.ok)setDetail(d.value);
    }catch(_){}
    setLoadingDetail(false);
  };
  const deleteItem=async(id,e)=>{
    e.stopPropagation();if(!confirm("确认删除？"))return;
    try{
      const r=await fetch("/api/submissions",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,password})});
      if(!r.ok){const d=await r.json().catch(()=>({}));alert("删除失败："+(d?.error||r.statusText));return;}
      const newList=list.filter(x=>x.id!==id);setList(newList);
      if(selected===id){setSelected(null);setDetail(null);}
    }catch(_){alert("删除失败，请检查网络后重试");}
  };
  return(
    <div style={{minHeight:"100vh",background:"#f5f0e8",fontFamily:"'Noto Sans SC','PingFang SC',sans-serif"}}>
      <div style={{background:"#2a2218",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div><div style={{fontSize:10,letterSpacing:3,color:"#6a5a3a",marginBottom:2}}>信望数理 · 彭老师</div><div style={{fontSize:18,fontWeight:700,color:"#f0e8d0"}}>教师后台</div></div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={loadList} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,padding:"7px 14px",fontSize:12,color:"#c0b090",cursor:"pointer"}}>🔄 刷新</button>
          <button onClick={onLogout} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,padding:"7px 14px",fontSize:12,color:"#c0b090",cursor:"pointer"}}>退出</button>
        </div>
      </div>
      <div style={{padding:"20px 16px",maxWidth:680,margin:"0 auto"}}>
        {listError&&<div style={{background:"#fde8e8",border:"1px solid #f0a0a0",borderRadius:10,padding:"10px 14px",color:"#a03030",fontSize:13,marginBottom:12}}>⚠ {listError}</div>}
        {list.length===0?(
          <div style={{textAlign:"center",padding:"40px 20px",color:"#8a7a5a",background:"#faf6ee",borderRadius:14,border:"1px dashed #c8b898"}}>
            <div style={{fontSize:36,marginBottom:10}}>📭</div><div style={{fontSize:14}}>暂无提交记录</div>
          </div>
        ):list.map(item=>{
          const tc=(PROBLEM_TYPES[item.problemType]||PROBLEM_TYPES["其他计算题"]).color;
          return(<div key={item.id}>
            <div onClick={()=>loadDetail(item.id)} style={{background:selected===item.id?"#fff8ee":"#fff",border:"1px solid "+(selected===item.id?"#e8a030":"#e0d0b0"),borderRadius:12,padding:"12px 16px",marginBottom:6,cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:8,background:item.overall==="正确"?"#e0f5e0":"#ffe8e0",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:item.overall==="正确"?"#3a8a3a":"#c06020",flexShrink:0}}>{item.score}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span style={{fontWeight:600,fontSize:14,color:"#2a2218"}}>{item.studentName}</span>
                  {item.problemCount>1&&<span style={{background:"#f0e8d0",color:"#8a6a30",fontSize:10,padding:"1px 7px",borderRadius:10}}>{item.problemCount}道题</span>}
                  {item.problemTypes&&<span style={{background:tc+"18",color:tc,fontSize:10,padding:"1px 7px",borderRadius:10,border:"1px solid "+tc+"40"}}>{item.problemTypes}</span>}
                  {item.issueCount>0?<span style={{background:"#ff4d6d",color:"#fff",fontSize:10,padding:"1px 7px",borderRadius:10}}>{item.issueCount}处错误</span>:<span style={{background:"#60c060",color:"#fff",fontSize:10,padding:"1px 7px",borderRadius:10}}>无误</span>}
                </div>
                <div style={{fontSize:11,color:"#a08060",marginTop:2}}>{fmtTime(item.timestamp)}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={(e)=>deleteItem(item.id,e)} style={{background:"#fde8e8",border:"none",borderRadius:6,padding:"4px 8px",fontSize:11,color:"#c03030",cursor:"pointer"}}>删除</button>
                <span style={{color:"#c8b898",fontSize:14}}>{selected===item.id?"▲":"▼"}</span>
              </div>
            </div>
            {selected===item.id&&(<div style={{margin:"-2px 8px 8px",background:"#fffdf8",border:"1px solid #e8d0a0",borderTop:"none",borderRadius:"0 0 12px 12px",padding:16}}>
              {loadingDetail&&<div style={{textAlign:"center",padding:20,color:"#8a7a5a",fontSize:13}}>加载中...</div>}
              {detail&&(<div>
                {detail.thumbnail&&(<div style={{marginBottom:14}}><div style={{fontSize:10,letterSpacing:3,color:"#8a7a5a",marginBottom:8}}>提交照片</div><img src={detail.thumbnail} alt="作业照片" style={{maxWidth:"100%",borderRadius:8,border:"1px solid #d8c8a0",maxHeight:220,objectFit:"contain",display:"block"}}/></div>)}
                {Array.isArray(detail.problems)?detail.problems.map((p,i)=>(<div key={i} style={{marginBottom:16}}>
                  {detail.problems.length>1&&(<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><div style={{width:22,height:22,borderRadius:"50%",background:"#2a2218",display:"flex",alignItems:"center",justifyContent:"center",color:"#f0e8d0",fontSize:11,fontWeight:700}}>{i+1}</div><div style={{height:"0.5px",flex:1,background:"#e0d0b0"}}/></div>)}
                  <ResultPanel result={p}/>
                </div>)):<ResultPanel result={detail.result||detail.problems}/>}
              </div>)}
            </div>)}
          </div>);
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════
//  主入口 - 路由控制
// ══════════════════════════════════════════════════
export default function App() {
  const [page, setPage] = useState("tool"); // home | tool | login | teacher（默认直接进入批改功能，首页暂不展示）
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwChecking, setPwChecking] = useState(false);
  const [teacherPassword, setTeacherPassword] = useState(""); // 登录成功后保存，用于后续调用 /api/submissions 读取云端数据

  const handleLogin = async () => {
    setPwChecking(true);
    setPwError("");
    try {
      const res = await fetch("/api/teacher-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pwInput }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) { setTeacherPassword(pwInput); setPage("teacher"); setPwInput(""); setPwError(""); }
      else { setPwError(data.error || "密码错误，请重试"); }
    } catch (e) {
      setPwError("登录请求失败，请检查网络后重试");
    } finally {
      setPwChecking(false);
    }
  };

  if (page === "home") return (
    <>
      <GlobalStyle />
      <HomePage onGoTool={() => setPage("tool")} />
      <button onClick={() => setPage("login")} style={{ position: "fixed", bottom: 24, right: 24, background: "rgba(42,34,24,0.85)", color: "#c0b090", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: "8px 16px", fontSize: 12, cursor: "pointer", zIndex: 99 }}>教师后台</button>
    </>
  );

  if (page === "tool") return (
    <>
      <GlobalStyle />
      <ParentView />
      <button onClick={() => setPage("login")} style={{ position: "fixed", bottom: 24, right: 24, background: "rgba(42,34,24,0.85)", color: "#c0b090", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: "8px 16px", fontSize: 12, cursor: "pointer", zIndex: 99 }}>教师后台</button>
    </>
  );

  if (page === "teacher") return <><GlobalStyle /><TeacherView password={teacherPassword} onLogout={() => { setTeacherPassword(""); setPage("tool"); }} /></>;

  if (page === "login") return (
    <div style={{ minHeight: "100vh", background: "#f5f0e8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "32px 24px", maxWidth: 360, width: "90%", boxShadow: "0 4px 24px rgba(42,34,24,0.1)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔐</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>教师后台登录</div>
        </div>
        <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="请输入密码" style={{ width: "100%", background: "#faf6ee", border: "1px solid #d8c8a0", borderRadius: 10, padding: "12px 14px", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 12, fontFamily: "inherit" }} />
        {pwError && <div style={{ color: "#c03030", fontSize: 12, marginBottom: 10 }}>⚠ {pwError}</div>}
        <button onClick={handleLogin} disabled={pwChecking} style={{ width: "100%", background: "#2a2218", color: "#fef3dc", border: "none", borderRadius: 10, padding: 13, fontSize: 15, fontWeight: 700, cursor: pwChecking ? "default" : "pointer", opacity: pwChecking ? 0.6 : 1, marginBottom: 10 }}>{pwChecking ? "验证中…" : "登录"}</button>
        <button onClick={() => { setPage("tool"); setPwInput(""); setPwError(""); }} style={{ width: "100%", background: "transparent", color: "#8a7a5a", border: "1px solid #d8c8a0", borderRadius: 10, padding: 11, fontSize: 13, cursor: "pointer" }}>取消</button>
      </div>
    </div>
  );
}
