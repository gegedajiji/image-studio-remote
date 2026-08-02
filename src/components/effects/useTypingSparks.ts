import { useEffect, type RefObject } from "react";
import { burst } from "@/lib/fx";

/**
 * 打字火花：在 textarea 输入时，于光标处迸发微小粒子。
 * 使用镜像 div 精确计算光标视口坐标。
 */
export function useTypingSparks(ref: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // 镜像元素（屏外）
    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    Object.assign(mirror.style, {
      position: "absolute",
      top: "-9999px",
      left: "-9999px",
      visibility: "hidden",
      whiteSpace: "pre-wrap",
      wordWrap: "break-word",
      overflowWrap: "break-word",
    } as CSSStyleDeclaration);
    document.body.appendChild(mirror);

    const MIRROR_PROPS = [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "boxSizing",
    ] as const;

    const getCaretViewportPos = () => {
      const rect = textarea.getBoundingClientRect();
      const style = getComputedStyle(textarea);
      for (const p of MIRROR_PROPS) {
        mirror.style[p] = style[p] as string;
      }
      mirror.style.width = `${textarea.clientWidth}px`;

      const pos = textarea.selectionEnd ?? textarea.value.length;
      const before = textarea.value.substring(0, pos);
      mirror.textContent = before;
      mirror.appendChild(marker);
      // 处理末尾换行
      if (before.endsWith("\n")) {
        marker.textContent = "\u200b";
      }
      const markerRect = marker.getBoundingClientRect();
      return {
        x: rect.left + (markerRect.left - mirror.getBoundingClientRect().left) - textarea.scrollLeft,
        y: rect.top + (markerRect.top - mirror.getBoundingClientRect().top) - textarea.scrollTop + 8,
      };
    };

    let last = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.length !== 1 && e.key !== "Enter" && e.key !== "Backspace") return;
      const now = performance.now();
      if (now - last < 40) return; // 节流
      last = now;
      // 等浏览器先更新 selection
      requestAnimationFrame(() => {
        const { x, y } = getCaretViewportPos();
        burst({
          x,
          y,
          count: 5,
          power: 1.6,
          life: 26,
          size: 1.4,
          hueMin: 180,
          hueMax: 220,
        });
      });
    };

    textarea.addEventListener("keydown", onKeyDown);
    return () => {
      textarea.removeEventListener("keydown", onKeyDown);
      mirror.remove();
    };
  }, [ref]);
}
