import * as React from "react";
import { Heading } from "@react-email/components";
import { EmailLayout } from "./EmailLayout";
import { FormattedText } from "./FormattedText";

export interface GeneralEmailProps {
  subject: string;
  message: string;
}

const heading: React.CSSProperties = {
  color: "#0f172a",
  fontSize: "20px",
  fontWeight: "700",
  margin: "0 0 24px",
  lineHeight: "1.3",
};

export function GeneralEmail({ subject, message }: GeneralEmailProps) {
  return (
    <EmailLayout preview={subject}>
      <Heading style={heading}>{subject}</Heading>
      <FormattedText text={message} />
    </EmailLayout>
  );
}
