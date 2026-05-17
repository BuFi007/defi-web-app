import { Metadata } from "next";
import { cacheLife } from "next/cache";
import { getScopedI18n } from "@/locales/server";
import { NEXT_PUBLIC_URL } from "@/constants";

type Props = {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ amount?: string; token?: string; chain?: string }>;
};

type PayMetadataArgs = {
  id: string;
  amount: string;
  token: string;
  chain: string;
  locale: string;
};

async function buildPayMetadata(args: PayMetadataArgs): Promise<Metadata> {
  "use cache";
  cacheLife("weeks");

  const t = await getScopedI18n("OpenGraphPayment");
  const { id, amount, token, chain, locale } = args;

  const ogImageUrl = `${NEXT_PUBLIC_URL}/api/${encodeURIComponent(id)}?amount=${encodeURIComponent(
    amount,
  )}&token=${encodeURIComponent(token)}&chain=${encodeURIComponent(chain)}`;

  const title = `${t("paymentTitle")} ${amount} ${token}`;
  const description = `${t("paymentDescription")} ${amount} ${token} ${t(
    "paymentDescription2",
  )}${id} ${t("paymentDescription3")}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${NEXT_PUBLIC_URL}/${locale}/${id}`,
      images: [ogImageUrl],
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

async function buildPayFallback(args: PayMetadataArgs): Promise<Metadata> {
  "use cache";
  cacheLife("weeks");

  const t = await getScopedI18n("OpenGraphPayment");
  const { id, locale } = args;
  const fallbackTitle = t("paymentFallbackTitle");
  const fallbackDescription = t("paymentFallbackDescription");
  const fallbackImage = `${NEXT_PUBLIC_URL}/images/iso-logo.png`;

  return {
    title: fallbackTitle,
    description: fallbackDescription,
    openGraph: {
      title: fallbackTitle,
      description: fallbackDescription,
      images: [{ url: fallbackImage }],
      url: `${NEXT_PUBLIC_URL}/${locale}/${id}`,
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
  const [{ id, locale }, sp] = await Promise.all([params, searchParams]);
  const args: PayMetadataArgs = {
    id,
    amount: sp.amount ?? "0",
    token: sp.token ?? "ETH",
    chain: sp.chain ?? "base",
    locale,
  };

  try {
    return await buildPayMetadata(args);
  } catch (error) {
    console.error("Error generating pay metadata:", error);
    return buildPayFallback(args);
  }
}
