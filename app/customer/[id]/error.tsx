"use client";

export default function CustomerError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  console.error("[app/customer/[id]/error]", error);

  return (
    <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Customer view unavailable</h2>
      <p className="mt-2 text-sm text-slate-500">
        The customer profile hit a render error. Retry this route without resetting the rest of the shell.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
      >
        Retry customer page
      </button>
    </div>
  );
}

