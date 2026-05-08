"use client";

import { AccountLookupPanel } from "@/src/components/AccountLookupPanel";

export default function AccountLookupToolPage() {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Account Lookup</h1>
        <p className="text-sm text-slate-500">
          Verify a beneficiary bank or wallet account. Every lookup is logged for audit.
        </p>
      </header>
      <div className="max-w-2xl">
        <AccountLookupPanel />
      </div>
    </div>
  );
}
