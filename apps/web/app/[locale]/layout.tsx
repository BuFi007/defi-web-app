import type { Metadata } from "next";
import { generateBuMetadata } from "@/lib/seo/landing-layout";
import { Toaster } from "@/components/ui/toaster";
import LayoutMusic from "@/components/layout-music";
import { ThemeProvider } from "@/components/theme-provider";
import SpiderwebPattern from "@/components/magicui/spiderweb-pattern";
import { cn } from "@/utils";
import Providers from "@/context/DynamicProviders";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { TranslationProvider } from "@/context/TranslationContext";
import Loading from "./loading";
import { RootLayoutProps } from "@/lib/types";
import { Suspense } from "react";
import { BlockchainProvider } from "@/context/BlockchainContext";
import { GhostModeProvider } from "@/context/GhostModeContext";
import Container from "@/components/container";
import Header from "@/components/header";

export async function generateMetadata({
  params,
}: RootLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  return generateBuMetadata(locale);
}

type BgVariant = "shader" | "radial";

const resolveVariant = (raw: string | undefined): BgVariant =>
  raw === "radial" ? "radial" : raw === "shader" ? "shader" : "shader";

const VARIANT_ONE: BgVariant = resolveVariant(
  process.env.ONE_NEXT_PUBLIC_BG_VARIANT ?? process.env.NEXT_PUBLIC_BG_VARIANT,
);
const VARIANT_TWO: BgVariant = resolveVariant(
  process.env.TWO_NEXT_PUBLIC_BG_VARIANT,
);

// Day-of-week A/B: even days (Sun, Tue, Thu, Sat) → ONE, odd days → TWO.
const pickVariantForDay = (): BgVariant =>
  new Date().getDay() % 2 === 0 ? VARIANT_ONE : VARIANT_TWO;

export default async function RootLayout({
  children,
  params,
}: RootLayoutProps) {
  const { locale } = await params;
  const messages = await getMessages();
  const bgVariant = pickVariantForDay();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <NextIntlClientProvider messages={messages} locale={locale}>
        <TranslationProvider>
          <GhostModeProvider>
            <Providers>
              <BlockchainProvider>
              <main
                className={cn(
                  "rounded-md h-screen flex flex-col overflow-hidden relative",
                  bgVariant === "radial"
                    ? "bg-radial-lightPurple dark:bg-radial-darkPurple"
                    : "bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300 dark:from-[#0b0a18] dark:via-[#16122d] dark:to-[#1d1838]"
                )}
              >
                {/* Light mode — soft linear-gradient fade (the "blur" effect) */}
                <SpiderwebPattern
                  width={96}
                  height={96}
                  x={-1}
                  y={-1}
                  className={cn(
                    "fixed inset-0 pointer-events-none opacity-45 dark:hidden",
                    "[mask-image:linear-gradient(to_bottom_right,white,transparent,transparent)]"
                  )}
                />
                {/* Dark mode — denser tile, full visibility */}
                <SpiderwebPattern
                  width={72}
                  height={72}
                  x={-1}
                  y={-1}
                  className={cn(
                    "fixed inset-0 pointer-events-none opacity-95 hidden dark:block"
                  )}
                />
                <Suspense fallback={<Loading />}>
                  <div className="shrink-0 relative z-30 bg-transparent">
                    <Header />
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">
                    <div className="container mx-auto py-4 relative flex flex-col overflow-hidden h-full">
                      <Container>
                        <div className="relative h-full w-full">
                          <div className="w-full h-full flex flex-col items-center justify-center">
                            {children}
                          </div>
                        </div>
                      </Container>
                    </div>
                  </div>
                </Suspense>
                <div className="shrink-0 relative z-30 bg-transparent">
                  <LayoutMusic />
                </div>
              </main>
              </BlockchainProvider>
              <Toaster />
            </Providers>
          </GhostModeProvider>
        </TranslationProvider>
      </NextIntlClientProvider>
    </ThemeProvider>
  );
}
