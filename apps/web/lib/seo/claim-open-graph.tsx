import { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { IGetLinkDetailsResponse } from "@/lib/types";
import { getLinkDetails } from "@squirrel-labs/peanut-sdk";
import { getScopedI18n } from "@/locales/server";
import { NEXT_PUBLIC_URL } from "@/constants";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    v?: string;
    l?: string;
    chain?: string;
  }>;
};

/**
 * Per-link cache. Same `linkCode` resolves to the same details indefinitely
 * after creation; bust with `revalidateTag(\`peanut-link-${linkCode}\`)` if
 * the link is ever claimed/voided server-side.
 */
async function getCachedLinkDetails(
  linkCode: string,
): Promise<IGetLinkDetailsResponse> {
  "use cache";
  cacheLife("days");
  cacheTag(`peanut-link-${linkCode}`);

  const details = await getLinkDetails({ link: linkCode });
  return details as unknown as IGetLinkDetailsResponse;
}

type ClaimMetadataArgs = {
  linkCode: string;
  chain: string;
  locale: string;
};

async function buildClaimMetadata(
  args: ClaimMetadataArgs,
): Promise<Metadata> {
  "use cache";
  cacheLife("days");
  cacheTag(`peanut-link-${args.linkCode}`);

  const t = await getScopedI18n("OpenGraphClaim");
  const details = await getCachedLinkDetails(args.linkCode);

  const amount = details.tokenAmount?.toString() ?? "0";
  const token = details.tokenSymbol?.toString() ?? "ETH";

  const ogImageUrl = `${NEXT_PUBLIC_URL}/api/og/claim?amount=${encodeURIComponent(
    amount,
  )}&token=${encodeURIComponent(token)}&chain=${encodeURIComponent(args.chain)}`;

  const title = `${t("claimTitle")} ${amount} ${token} ${t("claimTitle2")}`;
  const description = `${t("description")} ${amount} ${token}. ${t("description2")}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl }],
      url: `${NEXT_PUBLIC_URL}/${args.locale}/claim`,
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
}

async function buildClaimFallback(locale: string): Promise<Metadata> {
  "use cache";
  cacheLife("weeks");

  const t = await getScopedI18n("OpenGraphClaim");
  const fallbackTitle = t("fallbackTitle");
  const fallbackDescription = t("fallbackDescription");
  const fallbackImage = `${NEXT_PUBLIC_URL}/images/iso-logo.png`;

  return {
    title: fallbackTitle,
    description: fallbackDescription,
    openGraph: {
      title: fallbackTitle,
      description: fallbackDescription,
      images: [{ url: fallbackImage }],
      url: `${NEXT_PUBLIC_URL}/${locale}/claim`,
      siteName: "Bu.fi",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: fallbackTitle,
      description: fallbackDescription,
      images: [fallbackImage],
    },
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const [{ locale }, { l, chain }] = await Promise.all([params, searchParams]);

  if (!l) {
    return buildClaimFallback(locale);
  }

  try {
    return await buildClaimMetadata({
      linkCode: l,
      chain: chain ?? "1",
      locale,
    });
  } catch (error) {
    console.error("Error generating claim metadata:", error);
    return buildClaimFallback(locale);
  }
}
