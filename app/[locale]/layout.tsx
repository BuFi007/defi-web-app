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
import dynamic from "next/dynamic";
import { NextIntlClientProvider, useMessages } from "next-intl";
import { TranslationProvider } from "@/context/TranslationContext";
import Loading from "./loading";
import { RootLayoutProps } from "@/lib/types";
import { Suspense } from "react";
import { HeaderSkeleton } from "@/components/skeleton-card";

const Container = dynamic(() => import("@/components/container"), {
  ssr: false,
  loading: () => <Loading />,
});

const Header = dynamic(() => import("@/components/header"), {
  ssr: false,
  loading: () => <HeaderSkeleton />,
});

export async function generateMetadata({
  params: { locale },
}: RootLayoutProps): Promise<Metadata> {
  return generateBuMetadata(locale);
}

export default function RootLayout({
  children,
  params: { locale },
}: RootLayoutProps) {
  const messages = useMessages();

  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable} scroll-smooth antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300 bg-no-repeat font-nubase dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800 min-h-screen">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider messages={messages} locale={locale}>
            <TranslationProvider>
              <Providers>
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
                <Toaster />
              </Providers>
            </TranslationProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
