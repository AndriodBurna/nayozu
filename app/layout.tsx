import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Suspense } from "react";
import "./globals.css";
import Header from "@/components/header";
import Sidebar from "@/components/sidebar";
import BottomNav from "@/components/bottom-nav";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Nayozu",
  description: "Your anime universe",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.className} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {/* Header (kept in Suspense in case it uses useSearchParams) */}
          <Suspense fallback={<div className="h-16 border-b" />}>
            <Header />
          </Suspense>

          <div className="flex flex-1 min-w-0">
            {/* Sidebar (desktop only) */}
            <Suspense fallback={null}>
              <Sidebar />
            </Suspense>

            {/* The ONLY <main> on the page. Pages must not render their own. */}
            <main className="flex-1 min-w-0 px-4 py-6 md:px-8 md:py-8 pb-24 md:pb-12">
              <div className="mx-auto w-full max-w-6xl">{children}</div>
            </main>
          </div>

          {/* Bottom navigation (mobile only) */}
          <BottomNav />
        </ThemeProvider>
      </body>
    </html>
  );
}