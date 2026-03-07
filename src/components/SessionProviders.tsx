"use client";

import { QueueProvider } from "@/src/context/QueueContext";
import { TwilioVoiceProvider } from "@/src/context/TwilioVoiceContext";
import { DropdownsProvider } from "@/src/context/DropdownsContext";
import { LeadsQueueProvider } from "@/src/context/LeadsQueueContext";
import { useAuth } from "@/src/context/AuthContext";

function SessionScopedProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueueProvider>
      <TwilioVoiceProvider>
        <DropdownsProvider>
          <LeadsQueueProvider>{children}</LeadsQueueProvider>
        </DropdownsProvider>
      </TwilioVoiceProvider>
    </QueueProvider>
  );
}

export function SessionProviders({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <SessionScopedProviders key={user?.id ?? "anonymous-session"}>{children}</SessionScopedProviders>;
}

