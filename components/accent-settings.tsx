"use client";

import { useState, useEffect } from "react";
import { Settings, Check, Sparkles } from "lucide-react";
import Link from "next/link";

const ACCENT_COLORS = [
  { id: "emerald", label: "Emerald", hex: "#10b981" },
  { id: "blue", label: "Blue", hex: "#3b82f6" },
  { id: "purple", label: "Purple", hex: "#8b5cf6" },
  { id: "pink", label: "Pink", hex: "#ec4899" },
  { id: "amber", label: "Amber", hex: "#f59e0b" },
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "white", label: "White", hex: "#f8fafc" },
];

export default function AccentSettings() {
  const [open, setOpen] = useState(false);
  const [currentAccent, setCurrentAccent] = useState("purple");

  useEffect(() => {
    const saved = localStorage.getItem("nayozu-accent") || "purple";
    setCurrentAccent(saved);
    document.documentElement.setAttribute("data-accent", saved);
  }, []);

  const selectAccent = (id: string) => {
    setCurrentAccent(id);
    localStorage.setItem("nayozu-accent", id);
    document.documentElement.setAttribute("data-accent", id);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-[#151a2a] hover:text-white transition-colors"
        aria-label="Settings"
      >
        <Settings className="h-5 w-5" />
      </button>

      {open && (
        <>
          {/* Backdrop to close popup */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          <div className="absolute right-0 top-11 z-50 w-64 rounded-2xl border border-[#232a42] bg-[#121626] p-4 shadow-2xl shadow-black/80 backdrop-blur-xl">
            <p className="text-xs font-semibold text-zinc-400 mb-3">
              Accent colour
            </p>

            {/* Color Swatches */}
            <div className="flex items-center justify-between gap-1 mb-4">
              {ACCENT_COLORS.map((c) => {
                const isSelected = currentAccent === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectAccent(c.id)}
                    className="relative flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110"
                    style={{ backgroundColor: c.hex }}
                    title={c.label}
                  >
                    {isSelected && (
                      <Check
                        className={`h-4 w-4 stroke-[3] ${
                          c.id === "white" ? "text-zinc-900" : "text-white"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Menu Options */}
            <div className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/5 py-2 text-xs font-medium text-white hover:bg-white/10 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                What&apos;s new
              </button>

              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center rounded-xl border border-white/5 bg-white/5 py-2 text-xs font-medium text-white hover:bg-white/10 transition-colors"
              >
                All settings
              </Link>
            </div>

            <div className="mt-3 text-center">
              <button
                type="button"
                className="text-[11px] text-zinc-400 hover:text-white"
              >
                Take the app tour
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}