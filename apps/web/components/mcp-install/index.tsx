"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useToast } from "@/components/ui/use-toast";

const MCP_URL = "https://mcp.bu.finance/mcp";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const SIZES = {
  idle: { width: 160, height: 36, radius: 8 },
  ad: { width: 300, height: 50, radius: 999 },
  expanded: { width: 300, height: 310, radius: 16 },
} as const;

function ClaudeCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path clipRule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" fill="#D97757" fillRule="evenodd" />
    </svg>
  );
}

function ClaudeDesktopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fillRule="nonzero" />
    </svg>
  );
}

function CodexIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z" fill="#fff" />
      <path d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z" fill="url(#codex-grad)" />
      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" id="codex-grad" x1="12" x2="12" y1="3" y2="21">
          <stop stopColor="#B1A7FF" />
          <stop offset=".5" stopColor="#7A9DFF" />
          <stop offset="1" stopColor="#3941FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function McpIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
      <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const INSTALL_OPTIONS = [
  {
    id: "claude-code",
    label: "Claude Code",
    Icon: ClaudeCodeIcon,
    payload: `claude mcp add --transport http bufi-hyper ${MCP_URL}`,
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    Icon: ClaudeDesktopIcon,
    payload: JSON.stringify(
      { mcpServers: { "bufi-hyper": { command: "npx", args: ["-y", "mcp-remote", MCP_URL, "--allow-http"] } } },
      null, 2,
    ),
  },
  {
    id: "codex",
    label: "Codex",
    Icon: CodexIcon,
    payload: `codex --approval-mode full-auto -q "claude mcp add --transport http bufi-hyper ${MCP_URL}"`,
  },
  {
    id: "mcp-json",
    label: ".mcp.json",
    Icon: McpIcon,
    payload: JSON.stringify(
      { mcpServers: { "bufi-hyper": { type: "url", url: MCP_URL } } },
      null, 2,
    ),
  },
] as const;

type ViewState = "idle" | "ad" | "expanded";

export function McpInstallDropdown() {
  const { toast } = useToast();
  const [view, setView] = useState<ViewState>("idle");
  const [openOpt, setOpenOpt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const showAd = () => {
      setView("ad");
      hideTimer = setTimeout(() => setView("idle"), 4200);
    };
    const first = setTimeout(showAd, 10_000);
    const interval = setInterval(showAd, 45_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => () => clearTimer(), []);

  const handleCopy = useCallback(
    (e: React.MouseEvent, opt: (typeof INSTALL_OPTIONS)[number]) => {
      e.stopPropagation();
      navigator.clipboard.writeText(opt.payload);
      toast({ description: `${opt.label} config copied` });
    },
    [toast],
  );

  const toggleOpt = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    clearTimer();
    setOpenOpt((cur) => (cur === id ? null : id));
  }, []);

  const handleClick = () => {
    clearTimer();
    if (view === "expanded") {
      setView("idle");
      return;
    }
    setView("expanded");
    timerRef.current = setTimeout(() => setView("idle"), 10_000);
  };

  const inlineSize = view === "ad" ? SIZES.ad : SIZES.idle;
  const inlineBg =
    view === "ad" ? "rgba(10, 8, 18, 0.96)" : "rgba(255, 255, 255, 1)";
  const inlineBgDark =
    view === "ad" ? "rgba(10, 8, 18, 0.96)" : "rgba(27, 20, 45, 1)";

  return (
    <div className="relative shrink-0 z-[200]">
      {/* Inline pill — idle / ad */}
      <motion.div
        onClick={handleClick}
        initial={false}
        animate={{
          width: inlineSize.width,
          height: inlineSize.height,
          borderRadius: inlineSize.radius,
        }}
        transition={{ type: "spring", bounce: 0.28, duration: 0.55 }}
        style={{ transformOrigin: "100% 50%" }}
        className="relative overflow-hidden ring-1 backdrop-blur-xl cursor-pointer shadow-xl ring-purpleDanis/20 dark:ring-white/10"
      >
        <motion.div
          className="absolute inset-0 dark:hidden"
          initial={false}
          animate={{ backgroundColor: inlineBg }}
          transition={{ duration: 0.3 }}
        />
        <motion.div
          className="absolute inset-0 hidden dark:block"
          initial={false}
          animate={{ backgroundColor: inlineBgDark }}
          transition={{ duration: 0.3 }}
        />

        <AnimatePresence mode="wait" initial={false}>
          {view === "ad" ? (
            <motion.div
              key="ad"
              initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
              animate={{
                opacity: 1,
                scale: 1,
                filter: "blur(0px)",
                transition: { duration: 0.24, ease: EASE_OUT, delay: 0.08 },
              }}
              exit={{
                opacity: 0,
                scale: 0.92,
                filter: "blur(6px)",
                transition: { duration: 0.18 },
              }}
              className="relative h-full w-full flex items-center gap-2.5 pl-1.5 pr-4"
            >
              <span
                className="h-9 w-9 grid place-items-center rounded-full bg-gradient-to-br from-purpleDanis to-[#9F8AE8] shrink-0 shadow-[0_4px_12px_-4px_rgba(105,84,207,0.6)]"
                aria-hidden
              >
                <McpIcon className="h-4 w-4 text-white" />
              </span>
              <div className="leading-tight min-w-0 flex-1 text-left">
                <div className="text-[12px] font-semibold text-white tracking-tight">
                  Automate your trades
                </div>
                <div className="text-[10px] text-white/55 truncate">
                  Connect an AI agent to trade for you
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.88, filter: "blur(4px)" }}
              animate={{
                opacity: 1,
                scale: 1,
                filter: "blur(0px)",
                transition: { duration: 0.2, ease: EASE_OUT },
              }}
              exit={{
                opacity: 0,
                scale: 0.88,
                filter: "blur(4px)",
                transition: { duration: 0.16 },
              }}
              className="relative h-full w-full flex items-center justify-center gap-1.5 px-3 text-purpleDanis dark:text-[#E2D0FD]"
            >
              <McpIcon className="h-4 w-4 shrink-0" />
              <span className="text-xs font-bold whitespace-nowrap">Connect Agent</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Floating panel — expanded */}
      <AnimatePresence>
        {view === "expanded" && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.92, y: -4, filter: "blur(6px)" }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              filter: "blur(0px)",
              transition: { type: "spring", bounce: 0.25, duration: 0.45 },
            }}
            exit={{
              opacity: 0,
              scale: 0.92,
              y: -4,
              filter: "blur(6px)",
              transition: { duration: 0.18 },
            }}
            style={{ width: SIZES.expanded.width }}
            className="absolute right-0 top-[calc(100%+8px)] rounded-2xl bg-white dark:bg-[#1B142D] backdrop-blur-xl ring-1 ring-purpleDanis/20 dark:ring-white/10 shadow-[0_20px_60px_-16px_rgba(105,84,207,0.35)] dark:shadow-[0_20px_60px_-16px_rgba(105,84,207,0.5)] p-3 flex flex-col gap-2"
          >
            <div className="text-left">
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-purpleDanis/45 dark:text-white/40">
                Step 1
              </div>
              <div className="text-[13px] font-bold text-purpleDanis dark:text-white tracking-tight">
                Connect your AI agent
              </div>
              <div className="text-[11px] text-purpleDanis/50 dark:text-white/50">
                Copy a config to power automated trading
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              {INSTALL_OPTIONS.map((opt) => {
                const open = openOpt === opt.id;
                return (
                  <div
                    key={opt.id}
                    className="overflow-hidden rounded-lg bg-purpleDanis/5 dark:bg-white/8"
                  >
                    <motion.button
                      type="button"
                      onClick={(e) => toggleOpt(e, opt.id)}
                      whileTap={{ scale: 0.98 }}
                      className="flex items-center gap-2.5 w-full px-2.5 py-2 hover:bg-purpleDanis/10 dark:hover:bg-white/15 transition-colors text-left cursor-pointer"
                      title={`Show ${opt.label} config`}
                      aria-expanded={open}
                    >
                      <opt.Icon className="h-4 w-4 shrink-0" />
                      <span className="text-[12px] font-medium text-purpleDanis/90 dark:text-white/90 flex-1">
                        {opt.label}
                      </span>
                      <motion.span
                        animate={{ rotate: open ? 180 : 0 }}
                        transition={{ duration: 0.2, ease: EASE_OUT }}
                        className="text-purpleDanis/40 dark:text-white/40"
                      >
                        <ChevronIcon className="h-3.5 w-3.5" />
                      </motion.span>
                    </motion.button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          key="cfg"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: EASE_OUT }}
                          className="overflow-hidden"
                        >
                          <div className="px-2.5 pb-2.5 pt-0.5">
                            <pre className="max-h-28 overflow-auto rounded-md bg-purpleDanis/8 dark:bg-black/30 p-2 text-[10px] leading-relaxed font-mono text-purpleDanis/80 dark:text-white/70 whitespace-pre-wrap break-all">
                              {opt.payload}
                            </pre>
                            <motion.button
                              type="button"
                              onClick={(e) => handleCopy(e, opt)}
                              whileTap={{ scale: 0.98 }}
                              className="mt-1.5 flex items-center justify-center gap-1.5 w-full px-2.5 py-1.5 rounded-md bg-purpleDanis text-white dark:bg-violetDanis dark:text-[#1B142D] text-[11px] font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                            >
                              <CopyIcon className="h-3 w-3" /> Copy config
                            </motion.button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Agent Wallet — Circle Agent Stack */}
            <div className="mt-1 pt-2 border-t border-purpleDanis/10 dark:border-white/10">
              <a
                href="/ai"
                onClick={(e) => e.stopPropagation()}
                className="mb-2 flex items-center justify-center gap-1.5 w-full px-2.5 py-1.5 rounded-lg border border-purpleDanis/20 dark:border-violetDanis/25 text-[11px] font-medium text-purpleDanis dark:text-violetDanis hover:bg-purpleDanis/8 dark:hover:bg-white/8 transition-colors"
              >
                <span aria-hidden>✦</span> Agent Docs
                <span aria-hidden className="opacity-60">→</span>
              </a>
              <div className="text-left mb-1.5">
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-purpleDanis/45 dark:text-white/40">
                  Step 2
                </div>
                <div className="text-[11px] font-bold text-purpleDanis/70 dark:text-white/70 uppercase tracking-widest">
                  Agent Wallet
                </div>
                <div className="text-[10px] text-purpleDanis/40 dark:text-white/40">
                  Fund your agent with USDC via Circle
                </div>
              </div>
              <motion.button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(
                    'Run curl -sL https://agents.circle.com/skills/setup.md, and use the returned setup instructions to set up my agent wallet.'
                  );
                  toast({ description: "Agent wallet setup prompt copied" });
                }}
                whileHover={{ backgroundColor: "rgba(105,84,207,0.1)" }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg bg-gradient-to-r from-purpleDanis/8 to-[#0052FF]/8 dark:from-white/8 dark:to-[#0052FF]/15 hover:from-purpleDanis/15 hover:to-[#0052FF]/15 transition-colors text-left cursor-pointer"
                title="Copy agent wallet setup prompt"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" className="text-[#0052FF]" />
                  <path d="M12 7v10M7 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-[#0052FF]" />
                </svg>
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-semibold text-purpleDanis/90 dark:text-white/90 block">
                    Get Agent Wallet
                  </span>
                  <span className="text-[9px] text-purpleDanis/40 dark:text-white/40 block truncate">
                    Paste in Claude, Codex, or Cursor to set up
                  </span>
                </div>
                <CopyIcon className="h-3.5 w-3.5 text-purpleDanis/40 dark:text-white/40" />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
