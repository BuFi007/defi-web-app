import { HomeContent } from "@/components/home";
import { Translations } from "@/lib/types";
import { DynamicWidget } from "@dynamic-labs/sdk-react-core";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { MoneyMarketSkeleton } from "@/components/skeleton-card";

export default function Home() {
  const t = useTranslations("Home");

  const translations: Translations["Home"] = {
    welcome: t("welcome"),
    to: t("to"),
    slogan: {
      part1: t("slogan.part1"),
      part2: t("slogan.part2"),
      part3: t("slogan.part3"),
      part4: t("slogan.part4"),
    },
    logoAlt: t("logoAlt"),
    neoMatrixAlt: t("neoMatrixAlt"),
    pillGifAlt: t("pillGifAlt"),
    boofiMatrixAlt: t("boofiMatrixAlt"),
    matrixMemeAlt: t("matrixMemeAlt"),
  };

  return (
    <>
      <Suspense fallback={<MoneyMarketSkeleton />}>
        <HomeContent translations={translations} />
      </Suspense>
    </>
  );
}