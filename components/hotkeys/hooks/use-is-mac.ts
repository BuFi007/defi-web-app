"use client";

import { useEffect, useState } from "react";

export const isMac =
  typeof window !== "undefined"
    ? /Mac|iPod|iPhone|iPad/.test(window.navigator.userAgent)
    : false;

export function useIsMac() {
  const [isMacState, setIsMacState] = useState(isMac);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMacState(/Mac|iPod|iPhone|iPad/.test(window.navigator.userAgent));
    }
  }, []);

  return isMacState;
}
