// 答题卡全屏看图器（老师端）
//
// 只做「看」。删除留在后台列表里，不放进来 —— 看图时手指/鼠标最容易误触，
// 一份原件删掉就找不回来了。
//
// 为什么不做成「新标签打开原图」：图片是 data: URL，Chrome/Edge 明确禁止
// 顶层导航到 data: URL，点了只会得到一张白页（实测过，连 1×1 的图都被拦）。
// 页面内的浮层没有这个问题，而且列表 DOM 不卸载，关掉之后滚动位置原样还在。
//
// 不引第三方手势库：缩放/拖动/滑动用原生 pointer 事件 + CSS transform 足够，
// 多一个依赖要多对齐一次 React 版本，这里不值得。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SWIPE_MIN = 60; // 横向滑多少像素算换页
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const UI = {
  text: "#f0e8d0",
  dim: "#c8b898",
  faint: "#8a7a5a",
  line: "rgba(240,232,208,0.18)",
  panel: "rgba(240,232,208,0.10)"
};

export default function SheetImageViewer({ items, index = 0, title = "", onClose }) {
  const list = Array.isArray(items) ? items.filter((x) => x && x.dataUrl) : [];
  const total = list.length;
  const [cur, setCur] = useState(() => clamp(index, 0, Math.max(0, total - 1)));
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [touchOnly, setTouchOnly] = useState(false);

  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const pointers = useRef(new Map());
  const pinchRef = useRef(null);
  const dragRef = useRef(null);
  const swipeRef = useRef(null);
  const downOnBg = useRef(false);

  const item = list[cur];

  // 触屏设备不显示左右箭头：手指会盖住两侧，箭头反而挡图。
  useEffect(() => {
    try {
      setTouchOnly(window.matchMedia("(pointer: coarse)").matches);
    } catch (_) {}
  }, []);

  // 锁背景滚动。只改 body 的 overflow，不动列表本身，
  // 所以关掉浮层后 scrollTop 还是原来那个位置。补 padding-right 防止滚动条消失导致的横向跳动。
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = gap + "px";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, []);

  // 关闭后把焦点还给刚才那张缩略图。preventScroll 是关键，
  // 否则浏览器会把元素滚到视口中央，等于把「回到原位置」这件事又做坏了。
  useEffect(() => {
    const el = document.activeElement;
    return () => {
      try {
        if (el && el.focus) el.focus({ preventScroll: true });
      } catch (_) {}
    };
  }, []);

  const reset = () => setView({ scale: 1, x: 0, y: 0 });

  const go = (next) => {
    if (next < 0 || next >= total) return;
    setCur(next);
    reset();
  };

  // 滚轮缩放：以指针位置为锚点，指针底下的那一点不动。
  // React 的 onWheel 是 passive 的，取消不了页面滚动，所以挂原生监听。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setView((v) => {
        const next = clamp(v.scale * Math.exp(-e.deltaY * 0.0016), MIN_SCALE, MAX_SCALE);
        if (next <= 1.001) return { scale: 1, x: 0, y: 0 };
        if (Math.abs(next - v.scale) < 0.001) return v;
        const k = next / v.scale;
        return { scale: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(cur - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(cur + 1);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setView((v) => ({ ...v, scale: clamp(v.scale * 1.3, MIN_SCALE, MAX_SCALE) }));
      } else if (e.key === "-") {
        e.preventDefault();
        setView((v) => {
          const s = clamp(v.scale / 1.3, MIN_SCALE, MAX_SCALE);
          return s <= 1.001 ? { scale: 1, x: 0, y: 0 } : { ...v, scale: s };
        });
      } else if (e.key === "0") {
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, total]);

  // ── 指针：单指拖动 / 单指横滑换页 / 双指捏合 ──
  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    downOnBg.current = e.target === stageRef.current;
    try {
      stageRef.current.setPointerCapture(e.pointerId);
    } catch (_) {}
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: view.scale,
        x: view.x,
        y: view.y
      };
      dragRef.current = null;
      swipeRef.current = null;
    } else if (pointers.current.size === 1) {
      dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: 0 };
      swipeRef.current = { px: e.clientX, py: e.clientY, done: false };
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 双指：只按距离比缩放，不跟手平移 —— 跟手会让画面在捏合时乱飘。
    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = clamp(pinchRef.current.scale * (d / pinchRef.current.d), MIN_SCALE, MAX_SCALE);
      setView(s <= 1.001 ? { scale: 1, x: 0, y: 0 } : { scale: s, x: pinchRef.current.x, y: pinchRef.current.y });
      return;
    }

    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));

    // 放大后才拖：没放大时单指移动留给「换页」。
    if (view.scale > 1) {
      setDragging(true);
      const img = imgRef.current;
      const stage = stageRef.current;
      setView((v) => {
        // 图片是 object-fit: contain 铺满容器的，实际显示尺寸得按原图比例算，
        // 直接拿 offsetWidth 会把容器尺寸当成图片尺寸，边界就不对了。
        let limX = 0;
        let limY = 0;
        if (img && stage && img.naturalWidth && img.naturalHeight) {
          const fit = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
          limX = Math.max(0, (img.naturalWidth * fit * v.scale - stage.clientWidth) / 2);
          limY = Math.max(0, (img.naturalHeight * fit * v.scale - stage.clientHeight) / 2);
        }
        return { scale: v.scale, x: clamp(d.x + dx, -limX, limX), y: clamp(d.y + dy, -limY, limY) };
      });
    }
  };

  const endPointer = (e) => {
    const had = pointers.current.has(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;

    const d = dragRef.current;
    const sw = swipeRef.current;

    // 单指横滑换页：未放大、位移够大、且横向为主。
    if (had && pointers.current.size === 0 && sw && !sw.done && view.scale <= 1 && total > 1) {
      const dx = e.clientX - sw.px;
      const dy = e.clientY - sw.py;
      if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.4) {
        sw.done = true;
        go(cur + (dx < 0 ? 1 : -1));
      }
    }

    // 点空白处关闭：必须是真的没移动过（<6px），否则拖完一松手就关掉了。
    if (had && pointers.current.size === 0 && downOnBg.current && d && d.moved < 6) onClose();

    if (pointers.current.size === 0) {
      dragRef.current = null;
      swipeRef.current = null;
      downOnBg.current = false;
      setDragging(false);
    }
  };

  const onDoubleClick = () => {
    setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
  };

  const fileName =
    (title || "答题卡").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() + "-" + (cur + 1) + ".jpg";

  const arrowStyle = (side) => ({
    position: "absolute",
    [side]: 10,
    top: "50%",
    transform: "translateY(-50%)",
    width: 44,
    height: 44,
    borderRadius: 22,
    background: "rgba(240,232,208,0.12)",
    border: "1px solid " + UI.line,
    color: UI.text,
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontFamily: "inherit"
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="答题卡查看"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(18,14,8,0.97)",
        display: "flex",
        flexDirection: "column",
        overscrollBehavior: "contain"
      }}
    >
      {/* 顶栏：谁 · 哪场 · 第几张 · 下载 · 关闭 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", flexShrink: 0, borderBottom: "1px solid " + UI.line }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: UI.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        {total > 1 && (
          <div style={{ fontSize: 12.5, color: UI.dim, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {cur + 1} / {total}
          </div>
        )}
        <a
          href={item?.dataUrl}
          download={fileName}
          style={{ flexShrink: 0, background: UI.panel, border: "1px solid " + UI.line, color: UI.text, borderRadius: 8, padding: "7px 14px", fontSize: 12.5, textDecoration: "none" }}
        >
          下载
        </a>
        <button
          onClick={onClose}
          aria-label="关闭"
          style={{ flexShrink: 0, width: 34, height: 34, background: UI.panel, border: "1px solid " + UI.line, color: UI.text, borderRadius: 8, fontSize: 15, cursor: "pointer", padding: 0, fontFamily: "inherit", lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {/* 舞台 */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onDoubleClick={onDoubleClick}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            touchAction: "none",
            cursor: view.scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in"
          }}
        >
          {item?.dataUrl ? (
            <img
              ref={imgRef}
              src={item.dataUrl}
              alt={"第 " + (cur + 1) + " 张"}
              draggable={false}
              style={{
                // 用 100% + contain，不用 maxWidth/maxHeight：img 是 flex 子项，
                // max-height 百分比在 Flexbox 里会失效，长图会被纵向裁掉一截。
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
                userSelect: "none",
                WebkitUserDrag: "none",
                transform: "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")",
                transition: dragging ? "none" : "transform 0.14s ease-out",
                willChange: "transform"
              }}
            />
          ) : (
            <div style={{ color: UI.dim, fontSize: 13 }}>这张还没取回来</div>
          )}
        </div>

        {!touchOnly && total > 1 && (
          <>
            <button
              onClick={() => go(cur - 1)}
              disabled={cur <= 0}
              aria-label="上一张"
              style={{ ...arrowStyle("left"), opacity: cur <= 0 ? 0.25 : 1, cursor: cur <= 0 ? "default" : "pointer" }}
            >
              ‹
            </button>
            <button
              onClick={() => go(cur + 1)}
              disabled={cur >= total - 1}
              aria-label="下一张"
              style={{ ...arrowStyle("right"), opacity: cur >= total - 1 ? 0.25 : 1, cursor: cur >= total - 1 ? "default" : "pointer" }}
            >
              ›
            </button>
          </>
        )}
      </div>

      <div style={{ flexShrink: 0, textAlign: "center", padding: "8px 12px 12px", fontSize: 11, color: UI.faint, lineHeight: 1.6 }}>
        {touchOnly ? "双指缩放 · 左右滑动换页 · 双击放大" : "滚轮缩放 · ← → 换页 · 双击放大 · Esc 关闭"}
      </div>
    </div>,
    document.body
  );
}
