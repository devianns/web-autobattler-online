"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const GAME_WIDTH = 1440;
const GAME_HEIGHT = 900;

export default function GameViewport({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => {
      const styles = getComputedStyle(frame);
      const width = frame.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
      const height = frame.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
      setScale(Math.max(0.1, Math.min(width / GAME_WIDTH, height / GAME_HEIGHT)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, []);

  return <div className="game-viewport-frame" ref={frameRef}>
    {scale !== null && <div className="game-viewport-box" style={{ width: GAME_WIDTH * scale, height: GAME_HEIGHT * scale }}>
      <div className="game-viewport-canvas" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>}
  </div>;
}
