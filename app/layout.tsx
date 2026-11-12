import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { User } from "@supabase/supabase-js";
import "./globals.css";
import Header from "@/components/header";
import Sidebar from "@/components/sidebar";
import RightPanel from "@/components/right-panel";
import BottomNav from "@/components/bottom-nav";
import {
  ShellProvider,
  type ShellUserRole,
} from "@/components/shell-context";
import { AUTH_ENABLED } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NAYOZU - Anime & Manga Community",
  description: "Discover, track and discuss your favorite anime and manga.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initialUser: User | null = null;
  let initialUserRole: ShellUserRole = null;

  if (AUTH_ENABLED) {
    const supabase = await createClient();
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data?.user) {
        initialUser = data.user;
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (roleRow?.role === "admin" || roleRow?.role === "moderator") {
          initialUserRole = roleRow.role;
        } else {
          initialUserRole = "user";
        }
      }
    } catch {
      initialUser = null;
      initialUserRole = null;
    }
  }

  return (
    <html lang="en" className="dark overflow-x-hidden" suppressHydrationWarning>
      <body
        className={`${geistSans.className} antialiased bg-[#0b0d14] text-[#F1F3F9] min-h-screen flex flex-col overflow-x-hidden`}
      >
        <ShellProvider
          initialUser={initialUser}
          initialUserRole={initialUserRole}
        >
          {/* Top Sticky Header */}
          <Header />

          {/* 3-Column Layout: Sidebar - Main Content - Right Panel */}
          <div className="flex w-full flex-1">
            {/* Left Sidebar */}
            <Sidebar />

            {/* Main Center Content */}
            <main className="min-w-0 flex-1 px-4 py-6 pb-20 md:px-8 md:pb-6">
              {children}
            </main>

            {/* Right Community / Friends / Watch Together Panel */}
            <RightPanel />
          </div>

          {/* Mobile Bottom Navigation */}
          <BottomNav />
        </ShellProvider>
      </body>
    </html>
  );
}
