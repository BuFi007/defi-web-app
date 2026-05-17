import { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@bufi/location/supported-locales";
import { NEXT_PUBLIC_URL } from "@/constants";

interface LocalizedMetadata {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
}

const localizedMetadata: Record<SupportedLocale, LocalizedMetadata> = {
  en: {
    title: "BUFI | Spooky Crypto-Finance Made Easy",
    description:
      "Where spooky crypto-finance becomes easy! BUFI is a friendly ghost guiding you through the world of savings, payments, remittances, loans and DeFi, tailored for emerging markets.",
    ogTitle: "BUFI - Spooky Crypto-Finance Made Easy",
    ogDescription:
      "Where spooky crypto-finance becomes easy! BUFI is a friendly ghost guiding you through the world of savings, payments, remittances, loans and DeFi, tailored for emerging markets.",
  },
  es: {
    title: "BUFI | Finanzas Cripto Espeluznantes Fáciles",
    description:
      "¡Donde las finanzas cripto espeluznantes se vuelven fáciles! BUFI es un fantasma amigable que te guía por el mundo de los ahorros, pagos, remesas, préstamos y DeFi, adaptado para mercados emergentes.",
    ogTitle: "BUFI - Finanzas Cripto Espeluznantes Fáciles",
    ogDescription:
      "¡Donde las finanzas cripto espeluznantes se vuelven fáciles! BUFI es un fantasma amigable que te guía por el mundo de los ahorros, pagos, remesas, préstamos y DeFi, adaptado para mercados emergentes.",
  },
  pt: {
    title: "BUFI | Finanças Cripto Assustadoras Feitas Fáceis",
    description:
      "Onde as finanças cripto assustadoras se tornam fáceis! BUFI é um fantasma amigável que te guia pelo mundo de poupanças, pagamentos, remessas, empréstimos e DeFi, adaptado para mercados emergentes.",
    ogTitle: "BUFI - Finanças Cripto Assustadoras Feitas Fáceis",
    ogDescription:
      "Onde as finanças cripto assustadoras se tornam fáceis! BUFI é um fantasma amigável que te guia pelo mundo de poupanças, pagamentos, remessas, empréstimos e DeFi, adaptado para mercados emergentes.",
  },
  ja: {
    title: "BUFI | おばけクリプト金融をかんたんに",
    description:
      "おばけクリプト金融をかんたんに！BUFI は新興市場向けに最適化された、貯蓄・支払い・送金・ローン・DeFi の世界をやさしくガイドするフレンドリーなおばけです。",
    ogTitle: "BUFI - おばけクリプト金融をかんたんに",
    ogDescription:
      "おばけクリプト金融をかんたんに！BUFI は新興市場向けに最適化された、貯蓄・支払い・送金・ローン・DeFi の世界をやさしくガイドするフレンドリーなおばけです。",
  },
  ko: {
    title: "BUFI | 오싹한 크립토 금융을 손쉽게",
    description:
      "오싹한 크립토 금융을 손쉽게! BUFI 는 신흥 시장에 맞춘 저축, 결제, 송금, 대출, DeFi 의 세계를 친절하게 안내하는 다정한 유령입니다.",
    ogTitle: "BUFI - 오싹한 크립토 금융을 손쉽게",
    ogDescription:
      "오싹한 크립토 금융을 손쉽게! BUFI 는 신흥 시장에 맞춘 저축, 결제, 송금, 대출, DeFi 의 세계를 친절하게 안내하는 다정한 유령입니다.",
  },
};

// Cached content (everything serializable). `metadataBase` is constructed
// outside the cache because URL objects are not plain serializable values
// — the cache layer rejects them. It's merged back in by `generateBuMetadata`.
type CachedMetadata = Omit<Metadata, "metadataBase">;

async function getMetadata(locale: string): Promise<CachedMetadata> {
  "use cache";
  cacheLife("weeks");

  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) notFound();

  const safeLocale = locale as SupportedLocale;
  const meta = localizedMetadata[safeLocale];

  return {
    title: {
      default: meta.title,
      template: `%s | BUFI`,
    },
    description: meta.description,
    manifest: "/site.webmanifest",
    referrer: "origin-when-cross-origin",
    keywords: [
      "BUFI",
      "crypto",
      "finance",
      "remittances",
      "DeFi",
      "emerging markets",
      "stablecoins",
      "payments",
      "savings",
      "loans",
      "ERC20 tokens",
      "blockchain",
      "smart contracts",
      "cryptocurrency",
    ],
    robots: { index: true, follow: true },
    alternates: {
      canonical: NEXT_PUBLIC_URL,
      languages: Object.fromEntries(
        SUPPORTED_LOCALES.map((l) => [l, `${NEXT_PUBLIC_URL}/${l}`]),
      ),
    },
    openGraph: {
      type: "website",
      locale: safeLocale,
      alternateLocale: SUPPORTED_LOCALES.filter((l) => l !== safeLocale),
      url: NEXT_PUBLIC_URL,
      siteName: "BUFI",
      title: meta.ogTitle,
      description: meta.ogDescription,
      images: [
        {
          url: `${NEXT_PUBLIC_URL}/og-image.jpg`,
          width: 1200,
          height: 630,
          alt: "BUFI - Spooky Crypto-Finance",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      creator: "@BUFI_finance",
      site: "@BUFI_finance",
      images: `${NEXT_PUBLIC_URL}/og-image.jpg`,
    },
  };
}

export async function generateBuMetadata(locale: string): Promise<Metadata> {
  const cached = await getMetadata(locale ?? DEFAULT_LOCALE);
  return { ...cached, metadataBase: new URL(NEXT_PUBLIC_URL) };
}
