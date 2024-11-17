import { Metadata, Viewport } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { NEXT_PUBLIC_URL } from '@/constants';

const locales = ['en', 'es', 'pt'] as const;
type Locale = (typeof locales)[number];

interface LocalizedMetadata {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
}

const localizedMetadata: Record<Locale, LocalizedMetadata> = {
  en: {
    title: 'Bu | Spooky Crypto-Finance Made Easy',
    description:
      'Where spooky crypto-finance becomes easy! Bu is a friendly ghost guiding you through the world of savings, payments, remittances, loans and DeFi, tailored for emerging markets.',
    ogTitle: 'Bu - Spooky Crypto-Finance Made Easy',
    ogDescription:
      'Where spooky crypto-finance becomes easy! Bu is a friendly ghost guiding you through the world of savings, payments, remittances, loans and DeFi, tailored for emerging markets.',
  },
  es: {
    title: 'Bu | Finanzas Cripto Espeluznantes Fáciles',
    description:
      '¡Donde las finanzas cripto espeluznantes se vuelven fáciles! Bu es un fantasma amigable que te guía por el mundo de los ahorros, pagos, remesas, préstamos y DeFi, adaptado para mercados emergentes.',
    ogTitle: 'Bu - Finanzas Cripto Espeluznantes Fáciles',
    ogDescription:
      '¡Donde las finanzas cripto espeluznantes se vuelven fáciles! Bu es un fantasma amigable que te guía por el mundo de los ahorros, pagos, remesas, préstamos y DeFi, adaptado para mercados emergentes.',
  },
  pt: {
    title: 'Bu | Finanças Cripto Assustadoras Feitas Fáceis',
    description:
      'Onde as finanças cripto assustadoras se tornam fáceis! Bu é um fantasma amigável que te guia pelo mundo de poupanças, pagamentos, remessas, empréstimos e DeFi, adaptado para mercados emergentes.',
    ogTitle: 'Bu - Finanças Cripto Assustadoras Feitas Fáceis',
    ogDescription:
      'Onde as finanças cripto assustadoras se tornam fáceis! Bu é um fantasma amigável que te guia pelo mundo de poupanças, pagamentos, remessas, empréstimos e DeFi, adaptado para mercados emergentes.',
  },
};

// Cached metadata generation for performance
const getMetadata = cache((locale: string): Metadata => {
  if (!locales.includes(locale as Locale)) notFound();

  const safeLocale = locale as Locale;
  const meta = localizedMetadata[safeLocale];

  return {
    title: {
      default: meta.title,
      template: `%s | Bu`,
    },
    description: meta.description,
    metadataBase: new URL(NEXT_PUBLIC_URL),
    icons: [
      {
        rel: 'icon',
        url: '/favicon.ico',
      },
      {
        rel: 'apple-touch-icon',
        url: '/apple-touch-icon.png',
      },
    ],
    manifest: '/site.webmanifest',
    referrer: 'origin-when-cross-origin',
    keywords: [
      'crypto',
      'finance',
      'remittances',
      'DeFi',
      'emerging markets',
      'stablecoins',
      'payments',
      'savings',
      'loans',
      'ERC20 tokens',
      'blockchain',
      'smart contracts',
      'cryptocurrency',
    ],
    viewport: 'width=device-width, initial-scale=1',
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: NEXT_PUBLIC_URL,
      languages: Object.fromEntries(locales.map((l) => [l, `${NEXT_PUBLIC_URL}/${l}`])),
    },
    openGraph: {
      type: 'website',
      locale: safeLocale,
      alternateLocale: locales.filter((l) => l !== safeLocale),
      url: NEXT_PUBLIC_URL,
      siteName: 'Bu',
      title: meta.ogTitle,
      description: meta.ogDescription,
      images: [
        {
          url: `${NEXT_PUBLIC_URL}/og-image.jpg`,
          width: 1200,
          height: 630,
          alt: 'Bu - Spooky Crypto-Finance',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
      creator: '@Bu_finance',
      site: '@Bu_finance',
      images: `${NEXT_PUBLIC_URL}/og-image.jpg`,
    },
  };
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export function generateBuMetadata(locale: string): Metadata {
  return getMetadata(locale);
}
