import "@/css/global.scss";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
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
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable} scroll-smooth antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300 bg-no-repeat font-poppins dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800 min-h-screen">
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
                  <main className="rounded-md">
                    <GridPattern
                      width={20}
                      height={20}
                      x={-1}
                      y={-1}
                      className={cn(
                        "[mask-image:linear-gradient(to_bottom_right,white,transparent,transparent)]"
                      )}
                    />
                    <Suspense fallback={<Loading />}>
                      <Header />
                      <div className="custom-scrollbar">
                        <div className="mx-auto px-4 relative flex flex-col justify-center overflow-hidden">
                          <Container>
                            <div className="relative">
                              <div className="w-full flex flex-col items-center">
                                {children}
                              </div>
                            </div>
                          </Container>
                        </div>
                      </div>
                    </Suspense>
                    <br />
                    <LayoutMusic />
                  </main>
                </BlockchainProvider>
                <Toaster />
              </Providers>
            </TranslationProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
