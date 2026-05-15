import * as React from "react";
import { Heading, Text, Section, Button } from "@react-email/components";
import { EmailLayout } from "./EmailLayout";

export interface TaskAssignedEmailProps {
  recipientFirstName: string;
  actorName: string;
  taskTitle: string;
  taskDescription: string | null;
  category: string;
  priority: string;
  customerName: string;
  transferReference: string | null;
  taskUrl: string;
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

export function TaskAssignedEmail({
  recipientFirstName,
  actorName,
  taskTitle,
  taskDescription,
  category,
  priority,
  customerName,
  transferReference,
  taskUrl,
}: TaskAssignedEmailProps) {
  const preview = `Task assigned: ${taskTitle}`;
  return (
    <EmailLayout preview={preview}>
      <Heading style={headingStyle}>You have a new task</Heading>
      <Text style={lineStyle}>Hi {recipientFirstName},</Text>
      <Text style={lineStyle}>{actorName} assigned a task to you.</Text>

      <Section>
        <Text style={detailLabel}>Title</Text>
        <Text style={detailValue}>{taskTitle}</Text>

        <Text style={detailLabel}>Customer</Text>
        <Text style={detailValue}>{customerName}</Text>

        {transferReference && (
          <>
            <Text style={detailLabel}>Transfer</Text>
            <Text style={detailValue}>{transferReference}</Text>
          </>
        )}

        <Text style={detailLabel}>Category / Priority</Text>
        <Text style={detailValue}>{category} — {priority}</Text>

        {taskDescription && (
          <>
            <Text style={detailLabel}>Description</Text>
            <Text style={detailValue}>{taskDescription}</Text>
          </>
        )}
      </Section>

      <Button href={taskUrl} style={buttonStyle}>View task</Button>
    </EmailLayout>
  );
}
