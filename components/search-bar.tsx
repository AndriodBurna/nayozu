"use client";

import { useState } from "react";

interface SearchBarProps {
  onSubmit: (query: string) => void;
}

export default function SearchBar({ onSubmit }: SearchBarProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(query);
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-64">
      <input
        type="text"
        placeholder="Search anime..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg bg-[#101827/80] border border-white/20 px-4 py-2 text-sm text-[#F4F6FC] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5] focus:border-transparent"
      />
      <button
        type="submit"
        className="absolute right-0 top-0 bottom-0 w-10 bg-[#7047F5] text-white hover:bg-[#5D35DF] rounded-r-lg"
      >
        Search
      </button>
    </form>
  );
}