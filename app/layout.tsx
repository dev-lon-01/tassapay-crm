import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/src/context/AuthContext";
import { SessionProviders } from "@/src/components/SessionProviders";
import { AppShell } from "@/src/components/AppShell";

export const metadata: Metadata = {
  title: "TassaPay CRM",
  description: "Mobile-first fintech CRM prototype",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>
          <SessionProviders>
            <AppShell>{children}</AppShell>
          </SessionProviders>
        </AuthProvider>
      </body>
    </html>
  );
}

