import { HomeContent } from "@/components/home";
import { Suspense } from "react";
import { MoneyMarketSkeleton } from "@/components/skeleton-card";
import { Metadata } from "next";

export const generateMetadata = (): Metadata => {
  return {
    title: "Boofi DeFi | Web3 Financial Solutions",
    description:
      "Boofi DeFi provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
    openGraph: {
      title: "Boofi DeFi | Web3 Financial Solutions",
      description:
        "Boofi DeFi provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
      images: [
        {
          url: "/images/iso-logo.png",
          width: 800,
          height: 600,
          alt: "Boofi DeFi Logo",
        },
      ],
      type: "website",
      siteName: "Boofi DeFi",
    },
    twitter: {
      card: "summary_large_image",
      title: "Boofi DeFi | Web3 Financial Solutions",
      description:
        "Boofi DeFi provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
      images: ["/images/iso-logo.png"],
      creator: "@BoofiDeFi",
    },
    keywords: [
      "DeFi",
      "Web3",
      "Blockchain",
      "Cryptocurrency",
      "Decentralized Finance",
      "Boofi",
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
