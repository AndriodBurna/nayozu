"use client";

import { useState } from "react";
import { Search } from "lucide-react";

interface SearchBarProps {
  onSubmit?: (query: string) => void;
  placeholder?: string;
}

export default function SearchBar({
  onSubmit,
  placeholder = "Search anime, manga, manhwa, or users...",
}: SearchBarProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit) onSubmit(query);
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-xl">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
      <input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-10 w-full rounded-xl border border-[#1f263c] bg-[#101422] pl-10 pr-4 text-sm text-white placeholder-zinc-500 transition-colors focus:border-[#6d44f6] focus:outline-none focus:ring-1 focus:ring-[#6d44f6]"
      />
    </form>
  );
}