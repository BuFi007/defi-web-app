import type { Metadata } from "next";
import { generateBuMetadata } from "@/lib/seo/landing-layout";
import { Toaster } from "@/components/ui/toaster";
import LayoutMusic from "@/components/layout-music";
import { ThemeProvider } from "@/components/theme-provider";
import GridPattern from "@/components/magicui/grid-pattern";
import { cn } from "@/utils";
import Providers from "@/context/DynamicProviders";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { TranslationProvider } from "@/context/TranslationContext";
import Loading from "./loading";
import { RootLayoutProps } from "@/lib/types";
import { Suspense } from "react";
import { BlockchainProvider } from "@/context/BlockchainContext";
import Container from "@/components/container";
import Header from "@/components/header";

export async function generateMetadata({
  params,
}: RootLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  return generateBuMetadata(locale);
}

export default async function RootLayout({
  children,
  params,
}: RootLayoutProps) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <NextIntlClientProvider messages={messages} locale={locale}>
        <TranslationProvider>
          <Providers>
            <BlockchainProvider>
              <main className="rounded-md h-screen flex flex-col overflow-hidden relative bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300">
                <GridPattern
                  width={20}
                  height={20}
                  x={-1}
                  y={-1}
                  className={cn(
                    "[mask-image:linear-gradient(to_bottom_right,white,transparent,transparent)] fixed inset-0 pointer-events-none opacity-30"
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
        </TranslationProvider>
      </NextIntlClientProvider>
    </ThemeProvider>
  );
}
