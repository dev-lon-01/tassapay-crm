import * as React from "react";
import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";

interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
}

const DOMAIN = "https://tassapay.co.uk";

// ── Styles ───────────────────────────────────────────────────────────────────

const main: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const headerSection: React.CSSProperties = {
  backgroundColor: "#10b981",
  padding: "20px 40px",
  textAlign: "center",
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

const hr: React.CSSProperties = {
  borderColor: "#e2e8f0",
  margin: "24px 0",
};

const appBadge: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#0f172a",
  color: "#ffffff",
  borderRadius: "8px",
  padding: "9px 14px",
  fontSize: "11px",
  fontWeight: "700",
  textDecoration: "none",
  letterSpacing: "0.2px",
};

const whatsappBadge: React.CSSProperties = {
  ...appBadge,
  backgroundColor: "#25D366",
};

const legalText: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "11px",
  margin: "16px 0 4px",
  lineHeight: "1.6",
  textAlign: "center",
};

const copyrightText: React.CSSProperties = {
  color: "#cbd5e1",
  fontSize: "11px",
  margin: "4px 0 0",
  textAlign: "center",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function EmailLayout({ preview, children }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>

        {/* ── Header with clickable logo ── */}
        <Section style={headerSection}>
          <Link href={DOMAIN}>
            <Img
              src={`${DOMAIN}/TassaPay-logo-1.png`}
              alt="TassaPay"
              width={160}
              style={{ display: "block", margin: "0 auto" }}
            />
          </Link>
        </Section>

        {/* ── Main content ── */}
        <Container style={container}>{children}</Container>

        {/* ── Footer ── */}
        <Section style={footerSection}>
          <Hr style={hr} />

          {/* App / WhatsApp links */}
          <Row style={{ marginBottom: "8px" }}>
            <Column align="center">
              <Link
                href="https://apps.apple.com/us/app/tassapay/id6478577638"
                style={appBadge}
              >
                🍎 App Store
              </Link>
            </Column>
            <Column align="center">
              <Link
                href="https://play.google.com/store/apps/details?id=com.org.tassapay"
                style={appBadge}
              >
                ▶ Google Play
              </Link>
            </Column>
            <Column align="center">
              <Link
                href="https://api.whatsapp.com/send?phone=%20+447836%20695516&text=Hello%20There,%20I%20would%20like%20to%20enquire%20about%20money%20transfer."
                style={whatsappBadge}
              >
                💬 WhatsApp Us
              </Link>
            </Column>
          </Row>

          {/* Legal disclaimer */}
          <Text style={legalText}>
            Efuluus Limited, trading as TassaPay, is a company registered in
            England and Wales with registration number 12167877. Efuluus Limited
            is authorised and regulated by the Financial Conduct Authority with
            reg. No 916867. Registered office address: 16a, 2 Somerset Road,
            London, England, N17 9EJ
          </Text>

          <Text style={copyrightText}>© 2026 TassaPay. All rights reserved.</Text>
        </Section>

      </Body>
    </Html>
  );
}
