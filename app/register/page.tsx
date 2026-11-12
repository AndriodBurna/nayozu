import { Suspense } from "react";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/sign-up-form";

export const metadata: Metadata = {
  title: "Create Account | Nayozu",
  description: "Create a free Nayozu account to track anime, manga, and join the community.",
};

export default function RegisterPage() {
  return (
    <div className="flex min-h-[calc(100vh-10rem)] w-full items-center justify-center py-8 px-4">
      <div className="w-full max-w-md">
        <Suspense>
          <SignUpForm />
        </Suspense>
      </div>
    </div>
  );
}
