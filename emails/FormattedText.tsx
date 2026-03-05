import * as React from "react";
import { Text } from "@react-email/components";

interface FormattedTextProps {
  text: string;
  style?: React.CSSProperties;
}

const defaultParagraphStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: "15px",
  lineHeight: "1.7",
  margin: "0 0 16px",
};

/**
 * Renders multi-line text safely in HTML email clients.
 *
 * Strategy:
 *  - Split by one or more blank lines (\n\n) to identify paragraphs.
 *  - Each paragraph becomes a <Text> (rendered as <p>).
 *  - Lines within a paragraph are joined with <br/> so that single
 *    line-breaks (like a sign-off "Regards,\nTassaPay") look correct.
 *
 * This ensures that both paragraph spacing and within-paragraph
 * line breaks survive rendering in Gmail, Outlook, Apple Mail, etc.
 */
export function FormattedText({ text, style }: FormattedTextProps) {
  // Split on one or more consecutive blank lines to get paragraphs
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const mergedStyle = { ...defaultParagraphStyle, ...style };

  return (
    <>
      {paragraphs.map((para, i) => {
        const lines = para.split("\n");
        return (
          <Text key={i} style={mergedStyle}>
            {lines.map((line, j) => (
              <React.Fragment key={j}>
                {line}
                {j < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </Text>
        );
      })}
    </>
  );
}
