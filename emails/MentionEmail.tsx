import * as React from "react";
import { Heading, Text, Section, Button } from "@react-email/components";
import { EmailLayout } from "./EmailLayout";

export interface MentionEmailProps {
  recipientFirstName: string;
  actorName: string;
  surroundingHtml: string;        // pre-rendered, HTML-safe
  taskTitle: string;
  customerName: string;
  transferReference: string | null;
  priority: string;
  taskUrl: string;
  source: "comment" | "resolution" | "task_description";
}

const headingStyle: React.CSSProperties = {
  color: "#0f172a",
  fontSize: "20px",
  fontWeight: 700,
  margin: "0 0 16px",
  lineHeight: "1.3",
};

const lineStyle: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "1.5",
  color: "#334155",
  margin: "0 0 12px",
};

const quoteStyle: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "1.5",
  color: "#0f172a",
  margin: "0 0 16px",
  padding: "12px 16px",
  borderLeft: "3px solid #6366f1",
  backgroundColor: "#eef2ff",
  borderRadius: "6px",
};

const detailLabel: React.CSSProperties = {
  fontSize: "12px",
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "16px 0 4px",
};

const detailValue: React.CSSProperties = {
  fontSize: "14px",
  color: "#0f172a",
  margin: "0 0 8px",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#4f46e5",
  color: "#ffffff",
  padding: "10px 20px",
  borderRadius: "8px",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-block",
  marginTop: "16px",
};

const sourceLabel: Record<MentionEmailProps["source"], string> = {
  comment: "in a comment",
  resolution: "in the close-out resolution",
  task_description: "in the task description",
};

export function MentionEmail({
  recipientFirstName,
  actorName,
  surroundingHtml,
  taskTitle,
  customerName,
  transferReference,
  priority,
  taskUrl,
  source,
}: MentionEmailProps) {
  return (
    <EmailLayout preview={`You were mentioned on task: ${taskTitle}`}>
      <Heading style={headingStyle}>You were mentioned</Heading>
      <Text style={lineStyle}>Hi {recipientFirstName},</Text>
      <Text style={lineStyle}>
        {actorName} mentioned you {sourceLabel[source]} on a task.
      </Text>

      <Section>
        <div
          style={quoteStyle}
          dangerouslySetInnerHTML={{ __html: surroundingHtml }}
        />
      </Section>

      <Section>
        <Text style={detailLabel}>Task</Text>
        <Text style={detailValue}>{taskTitle}</Text>

        <Text style={detailLabel}>Customer</Text>
        <Text style={detailValue}>{customerName}</Text>

        {transferReference && (
          <>
            <Text style={detailLabel}>Transfer</Text>
            <Text style={detailValue}>{transferReference}</Text>
          </>
        )}

        <Text style={detailLabel}>Priority</Text>
        <Text style={detailValue}>{priority}</Text>
      </Section>

      <Button href={taskUrl} style={buttonStyle}>View task</Button>
    </EmailLayout>
  );
}
