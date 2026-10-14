export default function Error({
  message = "Something went wrong. Please try again later."
}: {
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="mb-3 text-lg font-medium text-red-400">Error</p>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}