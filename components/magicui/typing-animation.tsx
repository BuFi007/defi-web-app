"use client";

import { HTMLAttributes, ReactNode, useEffect, useState } from "react";

type TypingAnimationProps = HTMLAttributes<HTMLSpanElement> & {
  children: string;
  delay?: number;
  duration?: number;
  renderText?: (text: string) => ReactNode;
};

export function TypingAnimation({
  children,
  className,
  delay = 220,
  duration = 42,
  renderText,
  ...props
}: TypingAnimationProps) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    let interval: number | undefined;

    const startTimer = window.setTimeout(() => {
      let index = 0;
      interval = window.setInterval(() => {
        index += 1;
        setDisplayedText(children.slice(0, index));

        if (index >= children.length) {
          window.clearInterval(interval);
        }
      }, duration);
    }, delay);

    return () => {
      window.clearTimeout(startTimer);
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [children, delay, duration]);

  return (
    <span className={className} aria-label={children} {...props}>
      <span aria-hidden="true">
        {renderText ? renderText(displayedText) : displayedText}
      </span>
    </span>
  );
}
