import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="hidden md:block w-64 border-r border-white/10">
      <nav className="mt-8 space-y-2">
        <Link href="/" className="flex items-center px-4 py-3 text-sm font-medium text-gray-300 hover:bg-[#101827/50] hover:text-white rounded-lg">
          Home
        </Link>
        <Link href="/anime" className="flex items-center px-4 py-3 text-sm font-medium text-gray-300 hover:bg-[#101827/50] hover:text-white rounded-lg">
          Anime
        </Link>
        {/* We can add more links as needed, but for Milestone 1 we only have Home and Anime */}
        <Link href="#" className="flex items-center px-4 py-3 text-sm font-medium text-gray-300 hover:bg-[#101827/50] hover:text-white rounded-lg">
          Library
        </Link>
        <Link href="#" className="flex items-center px-4 py-3 text-sm font-medium text-gray-300 hover:bg-[#101827/50] hover:text-white rounded-lg">
          Discover
        </Link>
      </nav>
    </aside>
  );
}