export default function Empty({
  title = "No results found",
  description = "Try adjusting your search or filters."
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="mb-3 text-lg font-medium text-white">{title}</p>
      <p className="text-sm text-gray-400">{description}</p>
    </div>
  );
}