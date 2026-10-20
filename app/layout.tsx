import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Header from "@/components/header";
import Sidebar from "@/components/sidebar";
import RightPanel from "@/components/right-panel";
import { ShellProvider } from "@/components/shell-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NAYOZU - Anime & Manga Community",
  description: "Discover, track and discuss your favorite anime and manga.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.className} antialiased bg-[#0b0d14] text-[#F1F3F9] min-h-screen flex flex-col`}
      >
        <ShellProvider>
          {/* Top Sticky Header */}
          <Header />

          {/* 3-Column Layout: Sidebar - Main Content - Right Panel */}
          <div className="flex w-full flex-1">
            {/* Left Sidebar */}
            <Sidebar />

            {/* Main Center Content */}
            <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
              {children}
            </main>

            {/* Right Community / Friends / Watch Together Panel */}
            <RightPanel />
          </div>
        </ShellProvider>
      </body>
    </html>
  );
}