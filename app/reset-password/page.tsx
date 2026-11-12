import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "@/components/update-password-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset Password | Nayozu",
  description: "Set a new password for your Nayozu account.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; error_description?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const hasCallbackError = Boolean(params?.error || params?.error_description);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-[calc(100vh-10rem)] w-full items-center justify-center py-8 px-4">
      <div className="w-full max-w-md">
        <UpdatePasswordForm
          hasSession={Boolean(user) && !hasCallbackError}
          initialError={params?.error_description || null}
        />
      </div>
    </div>
  );
}
