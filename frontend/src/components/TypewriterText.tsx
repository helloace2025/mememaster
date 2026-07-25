"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  text: string;
  /** ms per character; lower = faster */
  speed?: number;
  className?: string;
  /** show blinking caret while typing / when busy */
  caret?: boolean;
  /** force caret even when idle */
  forceCaret?: boolean;
};

/**
 * Terminal-style typewriter: re-types when `text` changes.
 */
export default function TypewriterText({
  text,
  speed = 18,
  className = "",
  caret = true,
  forceCaret = false,
}: Props) {
  const [shown, setShown] = useState(text);
  const [typing, setTyping] = useState(false);
  const targetRef = useRef(text);
  const indexRef = useRef(text.length);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const prevTarget = targetRef.current;
    targetRef.current = text;

    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!text) {
      setShown("");
      setTyping(false);
      indexRef.current = 0;
      return;
    }

    // same message — no retype
    if (text === prevTarget && indexRef.current >= text.length) {
      setShown(text);
      setTyping(false);
      return;
    }

    // continue if extended prefix match, else restart
    setShown((current) => {
      if (text.startsWith(current) && current.length > 0) {
        indexRef.current = current.length;
        return current;
      }
      indexRef.current = 0;
      return "";
    });

    setTyping(true);
    timerRef.current = window.setInterval(() => {
      const target = targetRef.current;
      const i = indexRef.current;
      if (i >= target.length) {
        setShown(target);
        setTyping(false);
        if (timerRef.current != null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return;
      }
      indexRef.current = i + 1;
      setShown(target.slice(0, i + 1));
    }, speed);

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [text, speed]);

  const showCaret = caret && (typing || forceCaret);

  return (
    <span className={className}>
      {shown}
      {showCaret && <span className="mm-term-caret" aria-hidden />}
    </span>
  );
}
