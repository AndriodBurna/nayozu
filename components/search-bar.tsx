"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

interface SearchBarProps {
  onSubmit?: (query: string) => void;
  placeholder?: string;
}

export default function SearchBar({
  onSubmit,
  placeholder = "Search anime, manga, or users...",
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit) {
      onSubmit(query);
    } else if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-xl">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
      <input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-10 w-full rounded-xl border border-[#1f263c] bg-[#101422] pl-10 pr-4 text-sm text-white placeholder-zinc-500 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </form>
  );
}
