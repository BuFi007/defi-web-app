import { Metadata, ResolvingMetadata } from "next";
import { headers } from "next/headers";
import {
  ExtendedPaymentInfo,
  IGetLinkDetailsResponse,
  Translations,
} from "@/lib/types";
import { getLinkDetails } from "@squirrel-labs/peanut-sdk";

export const fetchLinkDetails = async (
  link: string,
  setDetails: (details: IGetLinkDetailsResponse) => void,
  setPaymentInfo: (paymentInfo: ExtendedPaymentInfo) => void,
  translations: Translations["PeanutTab"]
) => {
  try {
    const details = (await getLinkDetails({
      link,
    })) as unknown as IGetLinkDetailsResponse;
    setDetails(details);
    const extendedPaymentInfo: ExtendedPaymentInfo = {
      chainId: details.chainId,
      tokenSymbol: details.tokenSymbol,
      tokenAmount: details.tokenAmount,
      senderAddress: details.sendAddress,
      claimed: details.claimed,
      depositDate: details.depositDate,
      depositIndex: details.depositIndex,
    };
    setPaymentInfo(extendedPaymentInfo);
  } catch (error: any) {
    console.error("Error fetching link details:", error.message);
  }
};
type Props = {
  params: { locale: string };
  searchParams: {
    v?: string;
    l?: string;
    chain?: string;
  };
};

// Create a simplified version of fetchLinkDetails for metadata
async function getClaimDetails(url: string): Promise<IGetLinkDetailsResponse> {
  return new Promise((resolve, reject) => {
    fetchLinkDetails(
      url,
      (details: IGetLinkDetailsResponse) => resolve(details),
      () => {}, // setPaymentInfo
      {} as any // translations
    );
  });
}

export async function generateMetadata(
  { params, searchParams }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const headersList = headers();
  const domain = headersList.get("host") || process.env.NEXT_PUBLIC_URL;
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const baseUrl = `${protocol}://${domain}`;

  // Get claim details
  try {
    const url = `${baseUrl}/claim?v=${searchParams.v}&l=${searchParams.l}&chain=${searchParams.chain}`;
    const details = await getClaimDetails(url);

    if (!details) throw new Error("No details found");

    const amount = details.tokenAmount?.toString() || "0";
    const token = details.tokenSymbol || "ETH";
    const chain = searchParams.chain || "1";

    // Generate OG image URL
    const ogImageUrl = `${baseUrl}/api/og/claim?amount=${amount}&token=${token}&chain=${chain}`;

    // Construct metadata
    const title = `Claim ${amount} ${token} on Bu.fi`;
    const description = `Someone sent you ${amount} ${token}. Click to claim your tokens!`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: [ogImageUrl],
        url: `${baseUrl}/${params.locale}/claim`,
        siteName: "Bu.fi",
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [ogImageUrl],
      },
    };
  } catch (error) {
    return {
      title: "Claim your tokens on Bu.fi",
      description: "Someone sent you tokens. Click to claim them!",
      openGraph: {
        title: "Claim your tokens on Bu.fi",
        description: "Someone sent you tokens. Click to claim them!",
        images: [`${baseUrl}/images/BooFi-icon.png`],
        url: `${baseUrl}/${params.locale}/claim`,
        siteName: "Bu.fi",
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: "Claim your tokens on Bu.fi",
        description: "Someone sent you tokens. Click to claim them!",
        images: [`${baseUrl}/images/BooFi-icon.png`],
      },
    };
  }
}
