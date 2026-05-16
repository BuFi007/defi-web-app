import { useCallback, useState } from "react";
import peanut, {
  getRandomString,
  claimLinkGasless,
  claimLinkXChainGasless,
} from "@squirrel-labs/peanut-sdk";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useTransactionStore } from "@/store";
import { useToast } from "@/components/ui/use-toast";
import { useChainId } from "wagmi";
import { useEthersSigner } from "@/lib/wagmi";
import { NATIVE_TOKEN_ADDRESS } from "@/constants/Tokens";
import { Token } from "@/lib/types";
import { PEANUTAPIKEY } from "@/constants/Env";
import { playAudio, saveCreatedLinkToLocalStorage } from "@/utils";

const getPeanutApiKey = () => {
  if (!PEANUTAPIKEY) {
    throw new Error("NEXT_PUBLIC_DEEZ_NUTS_API_KEY is not set");
  }

  return PEANUTAPIKEY;
};

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

const isUserRejectedError = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeWalletError = error as { code?: unknown; message?: unknown };

  return (
    maybeWalletError.code === "ACTION_REJECTED" ||
    (typeof maybeWalletError.message === "string" &&
      maybeWalletError.message.includes("user rejected"))
  );
};

export const usePeanut = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { primaryWallet } = useDynamicContext();
  const { setLoading, setError } = useTransactionStore();
  const { toast } = useToast();
  const chainId = useChainId();
  const signer = useEthersSigner({ chainId });
  const generatePassword = async () => {
    try {
      return await getRandomString(16);
    } catch (error) {
      console.error("Error generating password:", error);
      throw new Error("Error generating the password.");
    }
  };

  const getTokenDetails = useCallback((tokenAddress: string) => {
    if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
      return { tokenType: 0, tokenDecimals: 18 };
    } else {
      return { tokenType: 1, tokenDecimals: 6 };
    }
  }, []);

  const generateLinkDetails = useCallback(
    ({
      tokenValue,
      tokenAddress,
    }: {
      tokenValue: string;
      tokenAddress: string;
    }) => {
      try {
        const tokenDetails = getTokenDetails(tokenAddress);
        const baseUrl = `${window.location.origin}/claim`;

        return {
          chainId: chainId.toString(),
          tokenAmount: parseFloat(
            Number(tokenValue).toFixed(tokenDetails.tokenDecimals)
          ),
          tokenType: tokenDetails.tokenType,
          tokenAddress: tokenAddress,
          tokenDecimals: tokenDetails.tokenDecimals,
          baseUrl: baseUrl,
          trackId: "ui",
        };
      } catch (error) {
        console.error("Error generating link details:", error);
        throw new Error("Error getting the linkDetails.");
      }
    },
    [getTokenDetails, chainId]
  );

  const createPayLink = async (
    amount: string,
    tokenAddress: Token | string,
    onInProgress?: () => void,
    onSuccess?: () => void,
    onFailed?: (error: Error) => void,
    onFinished?: () => void
  ) => {
    setIsLoading(true);
    setLoading(true);

    try {
      if (!primaryWallet?.address || !signer) {
        throw new Error("Wallet not connected or signer unavailable");
      }

      if (!tokenAddress) {
        tokenAddress = NATIVE_TOKEN_ADDRESS;
      }

      const actualTokenAddress =
        typeof tokenAddress === "string" ? tokenAddress : tokenAddress.address;

      const linkDetails = generateLinkDetails({
        tokenValue: amount,
        tokenAddress: actualTokenAddress,
      });

      const password = await generatePassword();

      const preparedTransactions = await peanut.prepareTxs({
        address: primaryWallet.address as `0x${string}`,
        linkDetails: linkDetails,
        passwords: [password],
      });

      if (actualTokenAddress !== NATIVE_TOKEN_ADDRESS) {
        try {
          // Execute approval transaction first
          for (const unsignedTx of preparedTransactions.unsignedTxs) {
            if (unsignedTx.data?.includes("approve")) {
              const txHash = await signer.sendTransaction({
                to: unsignedTx.to,
                data: unsignedTx.data,
                value: unsignedTx.value
                  ? BigInt(unsignedTx.value.toString())
                  : BigInt(0),
              });
              onInProgress?.();

              // Wait for approval transaction to be mined
              await txHash.wait();
            }
          }
        } catch (error: unknown) {
          if (isUserRejectedError(error)) {
            onFinished?.();
            return null;
          }
          throw error;
        }
      }

      const { link, txHash } = await peanut.createLink({
        structSigner: {
          signer: signer,
        },

        linkDetails: linkDetails,
        password: password,
      });

      const getLinksFromTxResponse = await peanut.getLinksFromTx({
        linkDetails,
        txHash: txHash,
        passwords: [password],
      });
      const links: string[] = getLinksFromTxResponse.links;

      toast({
        title: "Link created successfully",
        description: "Your payment link has been created.",
      });

      saveCreatedLinkToLocalStorage({
        address: primaryWallet.address as string,
        data: {
          link: links[0],
          depositDate: new Date().toISOString(),
          txHash: txHash,
          ...linkDetails,
        },
      });

      onSuccess?.();
      return { transactionHash: txHash, paymentLink: link };
    } catch (error: unknown) {
      console.error("Error creating pay link:", error);
      const normalizedError = toError(error);
      const errorMessage = normalizedError.message;

      if (isUserRejectedError(error)) {
        onFinished?.();
        return null;
      }

      setError(errorMessage);
      toast({
        title: "Error creating link",
        description: errorMessage,
        variant: "destructive",
      });
      onFailed?.(normalizedError);
      throw normalizedError;
    } finally {
      setIsLoading(false);
      setLoading(false);
      onFinished?.();
    }
  };

  const claimPayLink = async (
    link: string,
    onInProgress?: () => void,
    onSuccess?: () => void,
    onFailed?: (error: Error) => void,
    onFinished?: () => void,
    walletAddress?: string
  ) => {
    setIsLoading(true);
    setLoading(true);
    setError(null);

    try {
      let wallet;
      if (!primaryWallet?.address) {
        throw new Error("Wallet not connected");
      }

      if (walletAddress !== "" && walletAddress !== undefined) {
        wallet = walletAddress;
      } else {
        wallet = primaryWallet.address;
      }

      const claimedLinkResponse = await claimLinkGasless({
        link,
        APIKey: getPeanutApiKey(),
        recipientAddress: wallet as `0x${string}`,
        baseUrl: `https://api.peanut.to/claim-v2`,
      });

      saveCreatedLinkToLocalStorage({
        address: primaryWallet.address as string,
        data: {
          link: claimedLinkResponse.link,
          depositDate: new Date().toISOString(),
          txHash: claimedLinkResponse.txHash,
          ...claimedLinkResponse,
        },
      });
      toast({
        title: "Transaction sent",
        description: `Transaction hash: ${claimedLinkResponse.txHash}. Waiting for confirmation...`,
      });

      onInProgress?.();
      onSuccess?.();
      return claimedLinkResponse.txHash;
    } catch (error: unknown) {
      console.error("Error claiming paylink:", error);
      const normalizedError = toError(error);
      const errorMessage = normalizedError.message;
      setError(errorMessage);
      toast({
        title: "Error claiming link",
        description: errorMessage,
        variant: "destructive",
      });
      onFailed?.(normalizedError);
      throw normalizedError;
    } finally {
      setIsLoading(false);
      setLoading(false);
      onFinished?.();
    }
  };

  const claimPayLinkXChain = async (
    link: string,
    destinationChainId: string,
    destinationToken: string,
    onInProgress?: () => void,
    onSuccess?: () => void,
    onFailed?: (error: Error) => void,
    onFinished?: () => void,
    isMainnet?: boolean
  ) => {
    setIsLoading(true);
    setLoading(true);
    setError(null);

    try {
      if (!primaryWallet?.address) {
        throw new Error("Wallet not connected");
      }

      const claimedLinkResponse = await claimLinkXChainGasless({
        link,
        recipientAddress: primaryWallet.address as `0x${string}`,
        destinationChainId: Number(destinationChainId).toString(),
        destinationToken: destinationToken,
        APIKey: getPeanutApiKey(),
        isMainnet: isMainnet || false,
        slippage: 10,
      });

      saveCreatedLinkToLocalStorage({
        address: primaryWallet.address as string,
        data: {
          link: link,
          depositDate: new Date().toISOString(),
          ...claimedLinkResponse,
        },
      });
      toast({
        title: "Cross-chain transaction sent",
        description: `Transaction hash: ${claimedLinkResponse.txHash}. This may take a few minutes.`,
      });

      onInProgress?.();
      onSuccess?.();
      return claimedLinkResponse.txHash;
    } catch (error: unknown) {
      console.error("Error claiming cross-chain paylink:", error);
      const normalizedError = toError(error);
      const errorMessage = normalizedError.message;
      setError(errorMessage);
      toast({
        title: "Error claiming cross-chain link",
        description: errorMessage,
        variant: "destructive",
      });
      onFailed?.(normalizedError);
      throw normalizedError;
    } finally {
      setIsLoading(false);
      setLoading(false);
      onFinished?.();
    }
  };

  const copyToClipboard = (link: string) => {
    navigator.clipboard
      .writeText(link)
      .then(() => {
        toast({
          title: "Link copied",
          description: "The link has been copied to your clipboard.",
        });
        playAudio("/audio/click-coin.mp3");
      })
      .catch((err) => {
        console.error("Failed to copy:", err);
        toast({
          title: "Failed to copy",
          description: "An error occurred while copying the link.",
          variant: "destructive",
        });
      });
  };

  return {
    isLoading,
    address: primaryWallet?.address || null,
    chainId,
    createPayLink,
    claimPayLink,
    claimPayLinkXChain,
    copyToClipboard,
  };
};
