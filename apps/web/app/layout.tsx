import { Viewport } from "next";
import { Suspense } from "react";
import "@/css/global.scss";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} scroll-smooth antialiased`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300 bg-no-repeat font-poppins dark:bg-gradient-to-r dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800 min-h-screen">
        {/* cacheComponents boundary: the [locale] layout awaits params,
            which is runtime data. Suspense here lets Next prerender the
            static shell (this body + bg gradient) while the locale-aware
            tree streams in. */}
        <Suspense fallback={null}>{children}</Suspense>
        {process.env.NODE_ENV === "development" && (
          <script
            async
            src="https://unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
          />
        )}
      </body>
    </html>
  );
}

export { viewport };
