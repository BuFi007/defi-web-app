import type { Metadata } from "next";
import { generateBuMetadata } from "@/lib/seo/landing-layout";
import { Toaster } from "@/components/ui/toaster";
import LayoutMusic from "@/components/layout-music";
import { ThemeProvider } from "@/components/theme-provider";
import SpiderwebPattern from "@/components/magicui/spiderweb-pattern";
import { cn } from "@/utils";
import Providers from "@/context/ClientProviders";
import { I18nProviderClient } from "@/locales/client";
import { TranslationProvider } from "@/context/TranslationContext";
import Loading from "./loading";
import { RootLayoutProps } from "@/lib/types";
import { Suspense } from "react";
import { BlockchainProvider } from "@/context/BlockchainContext";
import { GhostModeProvider } from "@/context/GhostModeContext";
import Container from "@/components/container";
import Header from "@/components/header";
import { PerpsReplacementAgent } from "@/components/perps-replacement-agent";

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

async function LocalizedShell({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // `new Date()` must follow a runtime-data read under Next 16 Cache
  // Components — `await params` above satisfies that requirement.
  const bgVariant = pickVariantForDay();

  return (
    <I18nProviderClient locale={locale}>
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
                <div className="shrink-0 relative z-30 bg-transparent">
                  <Header />
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">
                  <div className="container mx-auto px-0 py-0 md:py-4 relative flex flex-col h-full">
                    <Container>
                      <div className="relative w-full flex-1 flex flex-col">
                        <div className="w-full flex-1 flex flex-col items-center justify-center">
                          {children}
                        </div>
                      </div>
                    </Container>
                  </div>
                </div>
                <div className="shrink-0 relative z-30 bg-transparent">
                  <LayoutMusic />
                </div>
              </main>
            </BlockchainProvider>
            <PerpsReplacementAgent />
            <Toaster />
          </Providers>
        </GhostModeProvider>
      </TranslationProvider>
    </I18nProviderClient>
  );
}

export default function RootLayout({ children, params }: RootLayoutProps) {
  return (
    <ThemeProvider defaultTheme="light">
      <Suspense fallback={<Loading />}>
        <LocalizedShell params={params}>{children}</LocalizedShell>
      </Suspense>
    </ThemeProvider>
  );
}
