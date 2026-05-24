import { NATIVE_TOKEN_ADDRESS } from "@/constants/Tokens";
import { Chain, Token } from "@/lib/types";
import { cn } from "@/utils";
import { pressable } from "@/utils/theme";
import Image from "next/image";
import { useState } from "react";
import { TokenIcon } from "@/components/trade-island/token-icon";
/**
 * Small button that display a given token symbol and image.
 *
 * WARNING: This component is under development and
 *          may change in the next few weeks.
 */
interface TokenChipProps {
  token: Token;
  onClick?: (token: Token) => void;
  className?: string;
  amount?: string;
  chain?: Chain;
  disabled?: boolean;
}

const tokenFallbackClass =
  "grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[#cbbcff] bg-[#efe9ff] text-[10px] font-bold text-[#5d49cb]";

const getTokenImage = (token: Token, chain?: Chain) => {
  if (token?.address === NATIVE_TOKEN_ADDRESS) {
    return chain?.nativeCurrency?.iconUrls?.[0] || token.image;
  }

  return token?.image;
};

export function TokenChip({
  token,
  onClick,
  className,
  amount,
  chain,
  disabled,
}: TokenChipProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = getTokenImage(token, chain);
  const symbol =
    token?.address === NATIVE_TOKEN_ADDRESS && chain
      ? chain.nativeCurrency.symbol
      : token?.symbol;
  // Route non-native symbols through TokenIcon so cirBTC renders the
  // Webflow Lottie + STABLE_TOKEN_LIST hits get the canonical bundled
  // SVG. Falls back to the deployment-provided `image` only when the
  // address is the native gas token (where TokenIcon has no symbol
  // basis to resolve from) or when TokenIcon's resolver misses.
  const useSharedIcon =
    Boolean(symbol) && token?.address !== NATIVE_TOKEN_ADDRESS;
  const showImage = Boolean(image) && !imageFailed && !useSharedIcon;
  const isInteractive = Boolean(onClick) && !disabled;
  const chipClassName = cn(
    isInteractive ? pressable.secondary : "bg-ock-secondary",
    pressable.shadow,
    "flex w-fit shrink-0 items-center gap-1 rounded-lg py-1 pr-3 pl-1",
    disabled && "pointer-events-none",
    className
  );
  const content = (
    <>
      {useSharedIcon ? (
        <TokenIcon sym={symbol} size={24} />
      ) : showImage ? (
        <Image
          src={image}
          alt={symbol}
          width={24}
          height={24}
          className="h-6 w-6 rounded-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true" className={tokenFallbackClass}>
          {symbol?.slice(0, 2).toUpperCase()}
        </span>
      )}
      {amount && <span>{amount}</span>}
      <span>{symbol}</span>
    </>
  );

  if (!isInteractive) {
    return (
      <span data-testid="ockTokenChip_Button" className={chipClassName}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="ockTokenChip_Button"
      className={chipClassName}
      onClick={() => onClick?.(token)}
    >
      {content}
    </button>
  );
}
