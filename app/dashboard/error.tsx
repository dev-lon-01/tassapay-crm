"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  console.error("[app/dashboard/error]", error);

  return (
    <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Dashboard unavailable</h2>
      <p className="mt-2 text-sm text-slate-500">
        A dashboard panel failed to render. Retry this route without affecting the rest of the app.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
      >
        Retry dashboard
      </button>
    </div>
  );
}

