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
      <body className={`${geistSans.className} antialiased bg-background text-foreground min-h-screen flex flex-col`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {/* Header */}
          <Suspense fallback={<div className="h-16">Loading...</div>}>
            <Header />
          </Suspense>

          {/* Main content area with sidebar and main content */}
          <Suspense fallback={<div className="h-[60vh] flex items-center justify-center">Loading...</div>}>
            <div className="flex flex-1">
              {/* Sidebar (desktop only) */}
              <Sidebar />

              {/* Main content */}
              <main className="flex-1 w-full overflow-y-auto p-6 md:p-12 pb-12">
                {children}
              </main>
            </div>
          </Suspense>

          {/* Bottom navigation (mobile only) */}
          <BottomNav />
        </ThemeProvider>
      </body>
    </html>
  );
}