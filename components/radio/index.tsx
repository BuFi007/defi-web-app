"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useHotkeys } from "react-hotkeys-hook";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Radio,
  X,
} from "lucide-react";
import { cn } from "@/utils";
import { CHANNELS, type Channel } from "./channels";
import { useChannelAvailability } from "./use-channel-availability";
import { useYouTubePlayer } from "./use-yt-player";

type View = "idle" | "expanded";

// Hardcoded morph dimensions — must match the inner content layout.
const SIZES = {
  idle: { width: 200, height: 34, radius: 999 },
  expanded: { width: 420, height: 432, radius: 28 },
} as const;

export default function RadioBar() {
  const [view, setView] = useState<View>("idle");
  const [channelIdx, setChannelIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const videoSlotRef = useRef<HTMLDivElement | null>(null);
  const [slotBounds, setSlotBounds] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const { unavailable, markUnavailable } = useChannelAvailability();

  const visibleChannels = useMemo(
    () => CHANNELS.filter((c) => !unavailable.has(c.id)),
    [unavailable],
  );

  // Find next/prev channel index in CHANNELS that skips dead ones.
  const findNextAvailable = useCallback(
    (fromIdx: number, direction: 1 | -1) => {
      const len = CHANNELS.length;
      for (let i = 1; i <= len; i++) {
        const idx = ((fromIdx + direction * i) % len + len) % len;
        if (!unavailable.has(CHANNELS[idx].id)) return idx;
      }
      return fromIdx;
    },
    [unavailable],
  );

  // If the current channel just became unavailable, hop to the next live one.
  useEffect(() => {
    if (unavailable.has(CHANNELS[channelIdx].id)) {
      const nextIdx = findNextAvailable(channelIdx, 1);
      if (nextIdx !== channelIdx) setChannelIdx(nextIdx);
    }
  }, [unavailable, channelIdx, findNextAvailable]);

  const channel = CHANNELS[channelIdx];

  const { mountRef, player } = useYouTubePlayer({
    videoId: channel.videoId,
    onStateChange: (state) => {
      if (state === 1) setPlaying(true);
      else if (state === 2 || state === 0) setPlaying(false);
    },
    onError: (code) => {
      // 2 = invalid id, 100 = not found, 101/150 = embedding disallowed
      if (code === 2 || code === 100 || code === 101 || code === 150) {
        markUnavailable(channel.id);
        const nextIdx = findNextAvailable(channelIdx, 1);
        if (nextIdx !== channelIdx) setChannelIdx(nextIdx);
      }
    },
  });

  const togglePlay = useCallback(() => {
    if (!player) return;
    if (playing) player.pauseVideo();
    else player.playVideo();
  }, [player, playing]);

  const goToChannelId = useCallback((id: string) => {
    const idx = CHANNELS.findIndex((c) => c.id === id);
    if (idx < 0) return;
    setChannelIdx(idx);
    requestAnimationFrame(() => {
      const node = scrollerRef.current?.querySelector<HTMLElement>(
        `[data-channel-id="${id}"]`,
      );
      node?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    });
  }, []);

  const prev = useCallback(() => {
    const idx = findNextAvailable(channelIdx, -1);
    goToChannelId(CHANNELS[idx].id);
  }, [channelIdx, findNextAvailable, goToChannelId]);

  const next = useCallback(() => {
    const idx = findNextAvailable(channelIdx, 1);
    goToChannelId(CHANNELS[idx].id);
  }, [channelIdx, findNextAvailable, goToChannelId]);

  // ⌘B / Ctrl+B — toggle the radio dynamic island (BUFX Radio hotkey)
  useHotkeys(
    "mod+b",
    () => setView((v) => (v === "idle" ? "expanded" : "idle")),
    { preventDefault: true, enableOnFormTags: false },
  );

  // Esc — collapse the expanded radio
  useHotkeys(
    "esc",
    () => {
      if (view === "expanded") setView("idle");
    },
    { enabled: view === "expanded" },
    [view],
  );

  // Track the video slot's viewport coords so the persistent iframe can
  // overlay it visually. Iframe stays mounted permanently so audio keeps
  // playing across morph state changes.
  useLayoutEffect(() => {
    if (view !== "expanded") {
      setSlotBounds(null);
      return;
    }
    const update = () => {
      if (!videoSlotRef.current) return;
      const rect = videoSlotRef.current.getBoundingClientRect();
      setSlotBounds({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };
    // Poll during morph animation; settle after spring completes.
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      update();
      if (performance.now() - start < 700) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    const onResize = () => update();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [view]);

  const currentSize = SIZES[view];

  return (
    <>
      {/* Footer line — chevrons together, island on far right */}
      <div className="relative z-10 flex items-center w-full mt-6 pb-5 gap-1.5 px-2">
        <span className="h-px flex-1 bg-purpleDanis" />

        <div className="flex items-center gap-0.5">
          <IconButton onClick={prev} ariaLabel="Previous channel">
            <ChevronLeft className="h-4 w-4 text-purpleDanis dark:text-violetDanis" />
          </IconButton>
          <IconButton onClick={next} ariaLabel="Next channel">
            <ChevronRight className="h-4 w-4 text-purpleDanis dark:text-violetDanis" />
          </IconButton>
        </div>

        {/* Morph slot — reserves space for the idle pill so the bar layout is stable */}
        <div
          className="relative"
          style={{ width: SIZES.idle.width, height: SIZES.idle.height }}
        >
          <motion.div
            initial={false}
            animate={{
              width: currentSize.width,
              height: currentSize.height,
              borderRadius: currentSize.radius,
            }}
            transition={{ type: "spring", bounce: 0.32, duration: 0.5 }}
            style={{ transformOrigin: "100% 100%" }}
            className={cn(
              "absolute right-0 bottom-0 overflow-hidden backdrop-blur-xl ring-1 z-50",
              "bg-white/95 ring-purpleDanis/15 shadow-[0_14px_36px_-12px_rgba(105,84,207,0.4)]",
              "dark:bg-black/95 dark:ring-white/10 dark:shadow-[0_18px_50px_-16px_rgba(105,84,207,0.65)]",
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {view === "idle" ? (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0, scale: 0.92, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.92, filter: "blur(4px)" }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full w-full"
                >
                  <IdleView
                    channel={channel}
                    playing={playing}
                    onTogglePlay={togglePlay}
                    onExpand={() => setView("expanded")}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0, scale: 0.94, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.94, filter: "blur(4px)" }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
                  className="h-full w-full"
                >
                  <ExpandedView
                    channel={channel}
                    channels={visibleChannels}
                    playing={playing}
                    videoSlotRef={videoSlotRef}
                    scrollerRef={scrollerRef}
                    onTogglePlay={togglePlay}
                    onChannelSelect={goToChannelId}
                    onClose={() => setView("idle")}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>

      {/* Persistent YouTube iframe — fixed-positioned overlay that mirrors
          the video slot inside the expanded card. Never unmounted, so audio
          keeps playing when the morph collapses. */}
      <div
        className="fixed overflow-hidden bg-black transition-opacity duration-300 ease-out"
        style={{
          top: slotBounds?.top ?? -9999,
          left: slotBounds?.left ?? -9999,
          width: slotBounds?.width ?? 1,
          height: slotBounds?.height ?? 1,
          opacity: view === "expanded" && slotBounds ? 1 : 0,
          pointerEvents: view === "expanded" && slotBounds ? "auto" : "none",
          borderRadius: 16,
          zIndex: 51,
        }}
        aria-hidden={view !== "expanded"}
      >
        <div ref={mountRef} className="w-full h-full" />
      </div>
    </>
  );
}

function IdleView({
  channel,
  playing,
  onTogglePlay,
  onExpand,
}: {
  channel: Channel;
  playing: boolean;
  onTogglePlay: () => void;
  onExpand: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pl-1.5 pr-3 h-full">
      <motion.button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePlay();
        }}
        whileTap={{ scale: 0.88 }}
        transition={{ type: "spring", stiffness: 700, damping: 22 }}
        aria-label={playing ? "Pause" : "Play"}
        className={cn(
          "h-6 w-6 shrink-0 grid place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2",
          "bg-purpleDanis text-white hover:bg-[#7864E0] focus-visible:ring-purpleDanis/50",
          "dark:bg-white dark:text-purpleDanis dark:hover:bg-white dark:focus-visible:ring-white/60",
        )}
      >
        <AnimatePresence initial={false} mode="wait">
          {playing ? (
            <motion.span
              key="pause"
              initial={{ opacity: 0, scale: 0.5, filter: "blur(2px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.5, filter: "blur(2px)" }}
              transition={{ duration: 0.1 }}
            >
              <Pause className="h-2.5 w-2.5 fill-current" />
            </motion.span>
          ) : (
            <motion.span
              key="play"
              initial={{ opacity: 0, scale: 0.5, filter: "blur(2px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.5, filter: "blur(2px)" }}
              transition={{ duration: 0.1 }}
            >
              <Play className="h-2.5 w-2.5 fill-current translate-x-[0.5px]" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <button
        type="button"
        onClick={onExpand}
        className="flex items-center gap-1.5 min-w-0 focus-visible:outline-none rounded-full flex-1 text-left"
        aria-label="Open radio"
      >
        <span className="text-[11px] leading-none shrink-0" aria-hidden>
          {channel.emoji}
        </span>
        <span className="text-[11px] font-semibold tracking-tight truncate text-purpleDanis dark:text-white">
          {channel.name}
        </span>
        <motion.span
          className="ml-auto shrink-0 text-purpleDanis/50 dark:text-white/55"
          animate={{ opacity: playing ? [0.4, 1, 0.4] : 0.4 }}
          transition={
            playing
              ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.2 }
          }
          aria-hidden
        >
          <Radio className="h-3 w-3" />
        </motion.span>
      </button>
    </div>
  );
}

function ExpandedView({
  channel,
  channels,
  playing,
  videoSlotRef,
  scrollerRef,
  onTogglePlay,
  onChannelSelect,
  onClose,
}: {
  channel: Channel;
  channels: Channel[];
  playing: boolean;
  videoSlotRef: React.MutableRefObject<HTMLDivElement | null>;
  scrollerRef: React.RefObject<HTMLDivElement>;
  onTogglePlay: () => void;
  onChannelSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="relative" style={{ width: SIZES.expanded.width }}>
      <div
        className="absolute inset-x-0 top-0 h-32 pointer-events-none opacity-50 dark:opacity-70"
        style={{
          background: `radial-gradient(60% 100% at 50% 0%, ${channel.accent}55 0%, transparent 70%)`,
        }}
        aria-hidden
      />

      {/* Video slot — empty placeholder; the persistent iframe overlays here */}
      <div className="relative px-3 pt-3">
        <div
          ref={videoSlotRef}
          className="relative aspect-video w-full overflow-hidden rounded-2xl ring-1 ring-black/10 dark:ring-white/10 bg-black shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]"
        />
      </div>

      <div className="relative flex items-center gap-3 px-4 pt-3 pb-2">
        <PlayPauseButton playing={playing} onClick={onTogglePlay} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <LivePulse />
            <span className="text-[10px] uppercase tracking-[0.22em] font-semibold text-rose-500 dark:text-rose-400">
              On Air
            </span>
          </div>
          <div className="mt-0.5 text-[13px] font-semibold leading-tight truncate text-purpleDanis dark:text-white">
            {channel.emoji} {channel.name}
          </div>
          <div className="text-[10.5px] truncate text-purpleDanis/60 dark:text-white/55">
            {channel.mood}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse radio"
          className={cn(
            "h-7 w-7 grid place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2",
            "text-purpleDanis/70 hover:text-purpleDanis hover:bg-purpleDanis/10 focus-visible:ring-purpleDanis/40",
            "dark:text-white/70 dark:hover:text-white dark:hover:bg-white/10 dark:focus-visible:ring-white/40",
          )}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.4} />
        </button>
      </div>

      <ChannelScroller
        ref={scrollerRef}
        channels={channels}
        activeChannelId={channel.id}
        onSelect={onChannelSelect}
      />
    </div>
  );
}

function PlayPauseButton({
  playing,
  onClick,
  size,
}: {
  playing: boolean;
  onClick: () => void;
  size: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const iconClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 700, damping: 22 }}
      aria-label={playing ? "Pause" : "Play"}
      className={cn(
        sizeClass,
        "shrink-0 grid place-items-center rounded-full shadow-[0_2px_8px_-2px_rgba(105,84,207,0.5)] transition-colors focus-visible:outline-none focus-visible:ring-2",
        "bg-purpleDanis text-white hover:bg-[#7864E0] focus-visible:ring-purpleDanis/50",
        "dark:bg-white dark:text-purpleDanis dark:hover:bg-white dark:focus-visible:ring-white/60",
      )}
    >
      <AnimatePresence initial={false} mode="wait">
        {playing ? (
          <motion.span
            key="pause"
            initial={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
            transition={{ duration: 0.12 }}
          >
            <Pause className={cn(iconClass, "fill-current")} />
          </motion.span>
        ) : (
          <motion.span
            key="play"
            initial={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
            transition={{ duration: 0.12 }}
          >
            <Play className={cn(iconClass, "fill-current translate-x-[1px]")} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function LivePulse() {
  return (
    <span className="relative grid place-items-center">
      <span className="absolute inline-flex h-2 w-2 rounded-full bg-rose-400 dark:bg-rose-500 opacity-60 animate-ping" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500 dark:bg-rose-400" />
    </span>
  );
}

const ChannelScroller = ({
  channels,
  activeChannelId,
  onSelect,
  ref,
}: {
  channels: Channel[];
  activeChannelId: string;
  onSelect: (id: string) => void;
  ref: React.RefObject<HTMLDivElement>;
}) => {
  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute left-0 top-0 bottom-2 w-6 z-10 bg-gradient-to-r from-white/95 dark:from-black/95 to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute right-0 top-0 bottom-2 w-6 z-10 bg-gradient-to-l from-white/95 dark:from-black/95 to-transparent"
        aria-hidden
      />
      <div
        ref={ref}
        className="overflow-x-auto overflow-y-hidden scrollbar-none px-3 pb-3 pt-1"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex gap-1.5 min-w-max">
          {channels.map((c) => {
            const active = c.id === activeChannelId;
            return (
              <motion.button
                key={c.id}
                data-channel-id={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                whileTap={{ scale: 0.93 }}
                transition={{ type: "spring", stiffness: 700, damping: 22 }}
                className={cn(
                  "shrink-0 w-[72px] h-[72px] rounded-2xl flex flex-col items-center justify-center gap-1 text-[10px] font-medium ring-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2",
                  active
                    ? [
                        "text-white ring-transparent shadow-[0_8px_22px_-8px_rgba(105,84,207,0.6)] focus-visible:ring-purpleDanis/60",
                        "dark:text-purpleDanis dark:focus-visible:ring-white/70",
                      ]
                    : [
                        "bg-purpleDanis/[0.05] text-purpleDanis/80 ring-purpleDanis/15 hover:bg-purpleDanis/[0.1] hover:text-purpleDanis focus-visible:ring-purpleDanis/40",
                        "dark:bg-white/[0.04] dark:text-white/70 dark:ring-white/10 dark:hover:bg-white/[0.08] dark:hover:text-white dark:focus-visible:ring-white/60",
                      ],
                )}
                style={
                  active
                    ? {
                        background: `linear-gradient(135deg, ${c.accent}ee 0%, ${c.accent}cc 60%, ${c.accent}aa 100%)`,
                      }
                    : undefined
                }
                aria-label={`Switch to ${c.name}`}
                aria-pressed={active}
              >
                <span
                  className="text-base leading-none drop-shadow-sm"
                  aria-hidden
                >
                  {c.emoji}
                </span>
                <span className="leading-tight text-center px-1 line-clamp-2">
                  {c.name}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function IconButton({
  children,
  onClick,
  ariaLabel,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 700, damping: 22 }}
      className={cn(
        "p-1.5 rounded-full transition-colors duration-200 hover:bg-purpleDanis/10 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purpleDanis/40 dark:focus-visible:ring-white/40",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}
