import React from "react";
import Image from "next/image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChainSelectProps } from "@/lib/types";

type ChainSelectVariant = "bordered" | "ghost";

export const ChainSelect: React.FC<
  ChainSelectProps & { variant?: ChainSelectVariant }
> = ({ value, onChange, chains, label, variant = "bordered" }) => {
  const renderChainOption = (chainId: string | number) => {
    const chain = chains.find((c) => c.chainId === Number(chainId));

    if (!chain) {
      return null;
    }

    return (
      <div className="flex items-center space-x-2">
        {chain.iconUrls?.[0] ? (
          // Some chain marks ship as non-square SVGs (Arc's 164x171, no
          // built-in background) — `rounded-full` clipped them awkwardly.
          // Use a fixed circular wrapper with `object-contain` so the
          // logo sits inside the circle instead of being cropped by it.
          <span
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-purpleDanis/5 dark:bg-violetDanis/15"
            aria-hidden="true"
          >
            <Image
              src={chain.iconUrls[0]}
              alt={chain.name || ""}
              width={28}
              height={28}
              // Inner logo at ~70% of the wrapper — gives the
              // non-square SVGs (Arc's 164×171 letter) padding from
              // the circular ring so the mark doesn't kiss the edge.
              className="h-[70%] w-[70%] object-contain"
              unoptimized
            />
          </span>
        ) : (
          <div className="h-6 w-6 rounded-full bg-gray-100" />
        )}
        <span
          className={
            // `bordered` keeps the brand pill aesthetic. `ghost` drops
            // the cartoony font / uppercase from the ui/select default
            // so the chain name reads as a clean inline label inside
            // dense containers (e.g. the wallet popover).
            variant === "ghost"
              ? "text-sm font-bold normal-case tracking-normal"
              : "font-clash text-sm"
          }
        >
          {chain.name}
        </span>
      </div>
    );
  };

  // Container width: ghost = fill parent (typical popover row), bordered
  // = legacy fixed 230px lock-up.
  const containerClass =
    variant === "ghost"
      ? "w-full"
      : "flex-1 flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2 m-auto gap-4 justify-around";
  const innerWrapperClass =
    variant === "ghost"
      ? "w-full"
      : "min-w-[230px] w-full sm:w-[230px] max-w-[230px] m-auto";

  const triggerClass =
    variant === "ghost"
      ? // No border, no uppercase, no shadow — looks like a plain row.
        // Hover reveals the brand-tinted background so it still reads
        // as interactive.
        "w-full flex items-center bg-transparent border-0 shadow-none normal-case font-bold text-purpleDanis dark:text-violetDanis hover:bg-purpleDanis/5 dark:hover:bg-violetDanis/10 focus:ring-0 focus:outline-none rounded-xl px-3"
      : "w-full m-auto flex items-center bg-white border-2 border-purpleDanis/60 hover:border-purpleDanis focus:border-purpleDanis focus:ring-2 focus:ring-purpleDanis/30 text-purpleDanis rounded-xl dark:bg-zinc-900 dark:border-violetDanis/60 dark:hover:border-violetDanis dark:text-violetDanis transition-colors";

  return (
    <div className={containerClass}>
      {variant === "bordered" && (
        <span className="text-xs text-gray-500 uppercase sm:hidden">{label}</span>
      )}
      <div className={innerWrapperClass}>
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className={triggerClass}>
            <SelectValue placeholder={label} className="m-auto">
              {value ? renderChainOption(value) : label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-2 border-purpleDanis/40 rounded-xl dark:border-violetDanis/40">
            {chains.map((chain) => (
              <SelectItem
                key={chain.chainId}
                value={chain.chainId.toString()}
                className="m-auto bg-white dark:bg-zinc-900"
              >
                {renderChainOption(chain.chainId.toString())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
