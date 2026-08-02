import { useEffect, useState } from "react";

/** 打字机：逐字打出 → 停顿 → 逐字删除 → 切换下一句 */
export function Typewriter({
  phrases,
  className = "",
}: {
  phrases: string[];
  className?: string;
}) {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = phrases[index % phrases.length];
    let timeout: number;

    if (!deleting) {
      if (text.length < current.length) {
        timeout = window.setTimeout(
          () => setText(current.slice(0, text.length + 1)),
          70 + Math.random() * 60,
        );
      } else {
        timeout = window.setTimeout(() => setDeleting(true), 2400);
      }
    } else {
      if (text.length > 0) {
        timeout = window.setTimeout(() => setText(current.slice(0, text.length - 1)), 28);
      } else {
        setDeleting(false);
        setIndex((i) => (i + 1) % phrases.length);
      }
    }
    return () => clearTimeout(timeout);
  }, [text, deleting, index, phrases]);

  return (
    <span className={className}>
      {text}
      <span className="typewriter-caret" />
    </span>
  );
}
