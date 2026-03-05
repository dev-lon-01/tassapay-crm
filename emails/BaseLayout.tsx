import * as React from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface BaseLayoutProps {
  preview: string;
  children: React.ReactNode;
}

const main: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const header: React.CSSProperties = {
  backgroundColor: "#10b981",
  padding: "20px 40px",
};

const logoText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "24px",
  fontWeight: "700",
  margin: "0",
  letterSpacing: "-0.5px",
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  margin: "24px auto",
  maxWidth: "600px",
  padding: "40px",
  border: "1px solid #e2e8f0",
};

const footerSection: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "0 40px 40px",
};

const footerText: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "12px",
  margin: "4px 0",
  lineHeight: "1.5",
};

export function BaseLayout({ preview, children }: BaseLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        {/* Header */}
        <Section style={header}>
          <Text style={logoText}>TassaPay</Text>
        </Section>

        {/* Content */}
        <Container style={container}>{children}</Container>

        {/* Footer */}
        <Section style={footerSection}>
          <Text style={footerText}>
            TassaPay Ltd · Regulated by the Financial Conduct Authority (FCA)
          </Text>
          <Text style={footerText}>
            This email was sent to you by TassaPay Operations. Please do not
            reply directly to this address.
          </Text>
        </Section>
      </Body>
    </Html>
  );
}
