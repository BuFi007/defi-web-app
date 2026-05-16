import { HomeContent } from "@/components/home";
import { Suspense } from "react";
import { MoneyMarketSkeleton } from "@/components/skeleton-card";
import { Metadata } from "next";
import { NEXT_PUBLIC_URL } from "@/constants";

export const generateMetadata = (): Metadata => {
  return {
    metadataBase: new URL(NEXT_PUBLIC_URL),
    title: "BUFI | Web3 Financial Solutions",
    description:
      "BUFI provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
    openGraph: {
      title: "BUFI | Web3 Financial Solutions",
      description:
        "BUFI provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
      images: [
        {
          url: "/images/iso-logo.png",
          width: 800,
          height: 600,
          alt: "BUFI Logo",
        },
      ],
      type: "website",
      siteName: "BUFI",
    },
    twitter: {
      card: "summary_large_image",
      title: "BUFI | Web3 Financial Solutions",
      description:
        "BUFI provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
      images: ["/images/iso-logo.png"],
      creator: "@BUFI_finance",
    },
    keywords: [
      "DeFi",
      "Web3",
      "Blockchain",
      "Cryptocurrency",
      "Decentralized Finance",
      "BUFI",
      "Financial Solutions",
      "Digital Assets",
      "Smart Contracts",
      "Crypto Investments",
    ],
  };
};
export default function Home() {
  return (
    <>
      <Suspense fallback={<MoneyMarketSkeleton />}>
        <HomeContent />
      </Suspense>
    </>
  );
}
