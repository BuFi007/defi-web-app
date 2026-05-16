import { Metadata, ResolvingMetadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

type Props = {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ amount?: string; token?: string; chain?: string }>;
};

export async function generateMetadata(
  { params, searchParams }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const [{ id, locale }, { amount, token, chain }, headersList] =
    await Promise.all([params, searchParams, headers()]);
  const origin = headersList.get("origin") || "";
  const baseUrl = origin.startsWith("https")
    ? process.env.NEXT_PUBLIC_MAINNET_URL
    : process.env.NEXT_PUBLIC_TESTNET_URL;

  const t = await getTranslations("OpenGraphPayment");

  try {
    const ogImageUrl = `${baseUrl}/api/${encodeURIComponent(
      id
    )}?amount=${encodeURIComponent(amount || "0")}&token=${encodeURIComponent(
      token || "ETH"
    )}&chain=${encodeURIComponent(chain || "base")}`;

    const title = `${t("paymentTitle")} ${amount || "0"} ${token || "ETH"}`;
    const description = `${t("paymentDescription")} ${amount || "0"} ${
      token || "ETH"
    } ${t(
      "paymentDescription2"
    )}${id} ${t("paymentDescription3")}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url: `${baseUrl}/${locale}/${id}`,
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
  } catch (error) {
    console.error("Error generating metadata:", error);
    const fallbackTitle = t("paymentFallbackTitle");
    const fallbackDescription = t("paymentFallbackDescription");

    const fallbackImage = `${baseUrl}/images/iso-logo.png`;

    return {
      title: fallbackTitle,
      description: fallbackDescription,
      openGraph: {
        title: fallbackTitle,
        description: fallbackDescription,
        images: [{ url: fallbackImage }],
        url: `${baseUrl}/${locale}/${id}`,
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
}
