import { useIsMac } from "../hooks/use-is-mac";
import { useEffect, useState } from "react";
export function GlobalHotkeys() {
  const isMac = useIsMac();
  const [isHidden, setIsHidden] = useState(true);

  useEffect(() => {
    const getModifierKey = () => (isMac ? "meta" : "ctrl");

    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = getModifierKey() === "meta" ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === "k") {
        e.preventDefault();

        setIsHidden((prev) => {
          const newState = !prev;
          return newState;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMac]);
}
