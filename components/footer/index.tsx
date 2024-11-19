import React from "react";
import { Play, Pause, ChevronLeft, ChevronRight } from "lucide-react";
import { FooterProps } from "@/lib/types";

export default function Component(
  {
    isPlaying,
    togglePlay,
    playNextSong,
    playPreviousSong,
    currentSong,
  }: FooterProps = {
    isPlaying: false,
    togglePlay: () => {},
    playNextSong: () => {},
    playPreviousSong: () => {},
    currentSong: "Sample Song",
  }
) {
  const marqueeText = isPlaying ? `${currentSong}       ` : " BooFi Radio 👻";

  return (
    <footer className="fixed bottom-0 w-screen">
      <div className="flex items-center w-full mt-8">
        <span className="h-px flex-1 bg-black dark:bg-white"></span>
        <button
          onClick={playPreviousSong}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronLeft size={24} className="text-black dark:text-white" />
        </button>
        <button
          onClick={togglePlay}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {isPlaying ? (
            <Pause size={24} className="text-black dark:text-white" />
          ) : (
            <Play size={24} className="text-black dark:text-white" />
          )}
        </button>
        <button
          onClick={playNextSong}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronRight size={24} className="text-black dark:text-white" />
        </button>

        <div className="flex items-center mr-4 border border-black dark:border-white rounded group hover:animate-shimmer relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50 -translate-x-full group-hover:animate-shimmer"></div>
          <div className="w-full overflow-hidden whitespace-nowrap">
            <div className="inline-flex animate-marquee hover:[animation-play-state:paused]">
              <span className="text-indigo-500 text-lg font-bold max-w-[300px] inline-block">
                {marqueeText.repeat(10)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
