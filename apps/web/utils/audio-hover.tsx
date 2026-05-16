
import { useRef } from "react";

export function useHoverAudio(audioFilePath: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!audioRef.current) {
    audioRef.current = new Audio(audioFilePath);
  }

  const playHoverSound = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((err) => console.warn("Hover audio failed:", err));
    }
  };

  const resetHoverSound = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  return { playHoverSound, resetHoverSound };
}
