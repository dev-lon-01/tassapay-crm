import * as React from "react";
import { Heading, Hr, Section, Text } from "@react-email/components";
import { BaseLayout } from "./BaseLayout";

export interface BeneficiaryIssueEmailProps {
  customerName: string;
  transferId: string;
  amount: string;
}

const heading: React.CSSProperties = {
  color: "#0f172a",
  fontSize: "22px",
  fontWeight: "700",
  margin: "0 0 24px",
  lineHeight: "1.3",
};

const paragraph: React.CSSProperties = {
  color: "#334155",
  fontSize: "15px",
  lineHeight: "1.7",
  margin: "0 0 16px",
};

const alertBox: React.CSSProperties = {
  backgroundColor: "#fffbeb",
  borderLeft: "4px solid #f59e0b",
  borderRadius: "6px",
  padding: "16px 20px",
  margin: "24px 0",
};

const alertText: React.CSSProperties = {
  color: "#92400e",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
  fontWeight: "600",
};

const bulletItem: React.CSSProperties = {
  color: "#334155",
  fontSize: "15px",
  lineHeight: "1.7",
  margin: "0 0 6px",
  paddingLeft: "12px",
};

const signoff: React.CSSProperties = {
  color: "#334155",
  fontSize: "15px",
  lineHeight: "1.7",
  margin: "24px 0 0",
};

export function BeneficiaryIssueEmail({
  customerName,
  transferId,
  amount,
}: BeneficiaryIssueEmailProps) {
  return (
    <BaseLayout
      preview={`Action Required: Issue with your TassaPay transfer ${transferId}`}
    >
      <Heading style={heading}>
        Action Required: Update Your Beneficiary Details
      </Heading>

      <Text style={paragraph}>Dear {customerName},</Text>

      <Text style={paragraph}>
        We are reaching out regarding your recent transfer{" "}
        <strong>{transferId}</strong> for <strong>{amount}</strong>.
        Unfortunately, we have encountered an issue with the beneficiary details
        provided, and the receiving bank or mobile provider has temporarily
        halted the transaction.
      </Text>

      <Section style={alertBox}>
        <Text style={alertText}>
          ⚠️ Your transfer is on hold. No funds have been lost. Please contact
          us as soon as possible to resolve this.
        </Text>
      </Section>

      <Text style={paragraph}>
        To ensure your funds are delivered promptly, please reply to this email
        or call our support team with the correct:
      </Text>

      <Text style={bulletItem}>• Recipient full name</Text>
      <Text style={bulletItem}>• Account number or IBAN</Text>
      <Text style={bulletItem}>• Phone number (for mobile money transfers)</Text>

      <Hr style={{ borderColor: "#e2e8f0", margin: "28px 0" }} />

      <Text style={signoff}>
        Thank you for choosing TassaPay. We apologise for any inconvenience
        caused and will resolve this as quickly as possible.
      </Text>

      <Text style={{ ...signoff, marginTop: "16px" }}>
        Warm regards,
        <br />
        The TassaPay Team
      </Text>
    </BaseLayout>
  );
}
