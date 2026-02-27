"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/src/context/AuthContext";

/**
 * Wraps protected pages. Redirects to /login if no token is present.
 * Shows nothing while the auth state is being rehydrated from localStorage.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, isLoading } = useAuth();
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !token) {
      router.replace("/login");
    }
  }, [isLoading, token, router]);

  // Don't render children while checking auth or redirecting
  if (isLoading || !token) return null;

  return <>{children}</>;
}
