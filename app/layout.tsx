import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/src/context/AuthContext";
import { QueueProvider } from "@/src/context/QueueContext";
import { TwilioVoiceProvider } from "@/src/context/TwilioVoiceContext";
import { DropdownsProvider } from "@/src/context/DropdownsContext";
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
          <QueueProvider>
            <TwilioVoiceProvider>
              <DropdownsProvider>
                <AppShell>{children}</AppShell>
              </DropdownsProvider>
            </TwilioVoiceProvider>
          </QueueProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
