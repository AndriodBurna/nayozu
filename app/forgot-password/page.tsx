import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot Password | Nayozu",
  description: "Request a password reset link for your Nayozu account.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-[calc(100vh-10rem)] w-full items-center justify-center py-8 px-4">
      <div className="w-full max-w-md">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
