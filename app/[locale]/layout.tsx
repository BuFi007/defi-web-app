import "@/css/global.scss";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { generateBuMetadata } from "@/lib/seo/landing-layout";
import { Toaster } from "@/components/ui/toaster";
import LayoutMusic from "@/components/layout-music";
import { ThemeProvider } from "@/components/theme-provider";
import { IBM_Plex_Serif, Inconsolata } from "next/font/google";
import GridPattern from "@/components/magicui/grid-pattern";
import { cn } from "@/utils";
import Header from "@/components/header";
import Container from "@/components/container";
import Providers from "@/context/DynamicProviders";


const locales = ["en", "es", "pt"] as const;
const ibmPlexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-ibm-plex-serif",
});

const inconsolata = Inconsolata({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-inconsolata",
});

type Locale = (typeof locales)[number];

interface RootLayoutProps {
  children: React.ReactNode;
  params: {
    locale: string;
  };
}

export async function generateMetadata({
  params: { locale },
}: RootLayoutProps): Promise<Metadata> {
  return generateBuMetadata(locale);
}

export default function RootLayout({
  children,
  params: { locale },
}: RootLayoutProps) {
  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable} ${ibmPlexSerif.variable} ${inconsolata.variable} h-full scroll-smooth antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>
            <main className="rounded-md bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300 bg-no-repeat font-nubase dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800">
              <GridPattern
                width={20}
                height={20}
                x={-1}
                y={-1}
                className={cn(
                  "[mask-image:linear-gradient(to_bottom_right,white,transparent,transparent)]"
                )}
              />
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
              <LayoutMusic />
            </main>
            <Toaster />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}