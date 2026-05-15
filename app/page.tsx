import { redirect } from "next/navigation";
import { Metadata } from "next";
import { NEXT_PUBLIC_URL } from "@/constants";

export const generateMetadata = (): Metadata => {
  return {
    metadataBase: new URL(NEXT_PUBLIC_URL),
    title: "Bufi | Web3 Financial Solutions",
    description:
      "Bufi provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
    openGraph: {
      title: "Bufi | Web3 Financial Solutions",
      description:
        "Bufi provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
      images: [
        {
          url: "/images/iso-logo.png",
          width: 800,
          height: 600,
          alt: "Bufi Logo",
        },
      ],
      type: "website",
      siteName: "Bufi",
    },
    twitter: {
      card: "summary_large_image",
      title: "Bufi | Web3 Financial Solutions",
      description:
        "Bufi provides innovative Web3 financial solutions for decentralized finance. Explore our platform for secure and efficient DeFi services.",
      images: ["/images/iso-logo.png"],
      creator: "@bufi",
    },
    keywords: [
      "DeFi",
      "Web3",
      "Blockchain",
      "Cryptocurrency",
      "Decentralized Finance",
      "Bufi",
      "Financial Solutions",
      "Digital Assets",
      "Smart Contracts",
      "Crypto Investments",
    ],
  };
};
export default function RootPage() {
  redirect("/en");
}
