import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopyToClipboard } from "@/hooks/use-clipboard";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/utils";
import { useEnsName } from "@/hooks/use-ens-name";
import { base } from "viem/chains";
import { AddressProps, Token } from "@/lib/types";
import { useLocale } from "next-intl";
import { useAppTranslations } from "@/context/TranslationContext";
import ShareableQRCard from "@/components/qr-gen/share-qr-card";
import { useNetworkManager } from "@/hooks/use-dynamic-network";
import { useGetTokensOrChain } from "@/hooks/use-tokens-or-chain";

export const BaseNameDialogAlert = ({
  address,
}: AddressProps) => {
  const translations = useAppTranslations('EnsAlertDialog');
  const [copiedText, copy] = useCopyToClipboard();
  const [overlayVisible, setOverlayVisible] = useState(false);
  const chainId = useNetworkManager();
  const { ensName, ensNotFound } = useEnsName({
    address,
    chain: base,
  });
  const locale = useLocale();
  console.log({ ensName });
  const availableTokens = useGetTokensOrChain(chainId!, "tokens");

  const getBaseUrl = () => {
    if (typeof window !== "undefined") {
      return `${window.location.protocol}//${window.location.host}/${locale}`;
    }
    return `https://defi.boofi.xyz/${locale}`;
  };

  const link = `${getBaseUrl()}/${ensName}`;

  const copyLink = () => {
    if (ensName) {
      copy(link);
    }
  };

  const handleToggleOverlay = () => {
    setOverlayVisible(!overlayVisible);
  };

  const onClickLinkBaseNames = () => {
    const url = ensName
      ? `https://www.base.org/names/${ensName}`
      : `https://www.base.org/names/?address=${address}`;
    window.open(url, "_blank");
  };

  return (
    <div className="relative text-xs font-nupower font-bold transition-all justify-center">
      {!ensName ? (
        <Skeleton className="h-4 w-full m-4" />
      ) : (
        <div>
          {!ensNotFound && ensName ? (
            <>
              <div className="items-center gap-1 inline-block justify-center w-full">
                <div className="flex flex-col items-center justify-center m-auto w-8/12">
                  <h1 className="text-center">
                    {ensName === address ? (
                      <span className="font-clash">
                        Hi {truncateAddress(ensName)}!
                      </span>
                    ) : (
                      <span className="font-clash"> Hi {ensName}! </span>
                    )}
                  </h1>
                  <Button
                    variant="link"
                    size="noPadding"
                    onClick={handleToggleOverlay}
                    className="text-center cursor-pointer text-blue-500 text-sm md:text-xs hover:underline"
                  >
                    <span className="text-sm md:text-xs">
                      {" "}
                      {translations.actionButton}
                    </span>
                  </Button>
                </div>
              </div>
              {overlayVisible && (
              <ShareableQRCard
                link={link}
                title="BooFi Payment Link"
                image="/images/BooFi-icon.png"
                shareMessage="Check out my BooFi payment link!"
                onCopy={copyLink}
                handleToggleOverlay={handleToggleOverlay}
                action="pay"
                amount="0.00"
                ensName={ensName}
                userAddress={address}
                availableTokens={availableTokens as Token[]}
                currentNetwork={chainId! || ""}
              />
              )}
            </>
          ) : (
            <div className="items-center inline-block justify-center">
              <Button
                variant="link"
                size="noPadding"
                onClick={onClickLinkBaseNames}
                className="flex items-center gap-1 cursor-pointer text-blue-500 text-xs hover:underline"
              >
                <span>{translations.callToAction}</span>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
