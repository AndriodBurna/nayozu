export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-white/20 border-t-transparent rounded-full animate-spin"></div>
      <p className="mt-3 text-sm text-gray-400">Loading...</p>
    </div>
  );
}