export default function SettingsLoading() {
  return (
    <div className="w-full space-y-6 pb-10 animate-pulse">
      <div className="h-36 w-full rounded-3xl border border-[#1e2438] bg-[#101422] p-6" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-2xl border border-[#1c2236] bg-[#101422]"
            />
          ))}
        </div>
        <div className="space-y-6">
          <div className="h-96 rounded-3xl border border-[#1e2438] bg-[#101422]" />
          <div className="h-44 rounded-3xl border border-[#1e2438] bg-[#101422]" />
        </div>
      </div>
    </div>
  );
}
