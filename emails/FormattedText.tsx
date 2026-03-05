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

// Matches any opening HTML tag (e.g. <a href="...">, <strong>)
const HTML_TAG_RE = /<[a-z][\s\S]*?>/i;

function containsHtml(str: string): boolean {
  return HTML_TAG_RE.test(str);
}

/**
 * Renders multi-line text safely in HTML email clients.
 *
 * Strategy:
 *  - Split by one or more blank lines (\n\n) to identify paragraphs.
 *  - Each paragraph becomes a <Text> (rendered as <p>).
 *  - Paragraphs that contain HTML tags (e.g. <a>) are passed via
 *    dangerouslySetInnerHTML so links render correctly in all clients.
 *  - Plain-text paragraphs use React children with <br/> for single
 *    line-breaks (e.g. sign-off "Regards,\nTassaPay").
 */
export function FormattedText({ text, style }: FormattedTextProps) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const mergedStyle = { ...defaultParagraphStyle, ...style };

  return (
    <>
      {paragraphs.map((para, i) => {
        if (containsHtml(para)) {
          // Preserve single line-breaks as <br> and render HTML tags as-is
          const html = para.split("\n").join("<br />");
          return (
            <Text
              key={i}
              style={mergedStyle}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
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
