import { CSSProperties, useEffect, useRef, useState } from "react";

export function ScrollingName({ name }: { name: string }) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [textWidthPx, setTextWidthPx] = useState(0);

  useEffect(() => {
    function measure() {
      const container = containerRef.current;
      const text = textRef.current;
      if (!container || !text) {
        return;
      }
      const measuredTextWidth = Math.ceil(text.scrollWidth);
      setTextWidthPx(measuredTextWidth);
      setOverflowPx(Math.max(0, measuredTextWidth - container.clientWidth));
    }

    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    if (textRef.current) {
      observer.observe(textRef.current);
    }
    return () => observer.disconnect();
  }, [name]);

  const isTruncated = overflowPx > 0;
  const style = (
    isTruncated
      ? {
          ["--light-name-shift" as string]: `${Math.max(1, textWidthPx)}px`,
          ["--light-name-duration" as string]: `${Math.max(2.2, textWidthPx / 52)}s`,
        }
      : {}
  ) as CSSProperties;

  return (
    <span ref={containerRef} className={isTruncated ? "light-name-fade light-name-fade-both" : "light-name-fade"}>
      {isTruncated ? (
        <span style={style} className="light-name-scroll-track">
          <span ref={textRef} className="light-name-copy">
            {name}
            {"\u00a0\u00a0"}
          </span>
          <span className="light-name-copy" aria-hidden="true">
            {name}
            {"\u00a0\u00a0"}
          </span>
        </span>
      ) : (
        <span ref={textRef} className="light-name-static">
          {name}
        </span>
      )}
    </span>
  );
}
