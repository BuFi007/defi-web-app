"use client";

import { useEffect, useRef } from "react";

export function useDocumentTitle(title: string | null): void {
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    if (title == null) return;
    if (prevRef.current === null) {
      prevRef.current = document.title;
    }
    document.title = title;
  }, [title]);

  useEffect(() => {
    return () => {
      if (prevRef.current !== null) {
        document.title = prevRef.current;
      }
    };
  }, []);
}
