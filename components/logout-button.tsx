"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { signOutUserAction } from "@/lib/actions/authActions";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const logout = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const supabase = createClient();
      await Promise.allSettled([
        signOutUserAction(),
        supabase.auth.signOut(),
      ]);
      router.push("/");
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isLoading}
      onClick={logout}
      className="rounded-xl text-xs"
    >
      {isLoading ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <LogOut className="mr-1.5 h-3.5 w-3.5" />
      )}
      {isLoading ? "Signing out..." : "Sign out"}
    </Button>
  );
}
