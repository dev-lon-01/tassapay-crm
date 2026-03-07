export interface ValidationIssue {
  field: string;
  message: string;
  index?: number;
}

export class RequestValidationError extends Error {
  status: number;
  issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[], status = 400) {
    super(message);
    this.name = "RequestValidationError";
    this.status = status;
    this.issues = issues;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ensureObject(value: unknown, field = "body"): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "Expected a JSON object" },
    ]);
  }
  return value;
}

export function requireString(
  value: unknown,
  field: string,
  options?: { maxLength?: number }
): string {
  if (typeof value !== "string") {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "Expected a string" },
    ]);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "This field is required" },
    ]);
  }

  if (options?.maxLength && trimmed.length > options.maxLength) {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: `Must be ${options.maxLength} characters or fewer` },
    ]);
  }

  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  options?: { maxLength?: number; emptyToNull?: boolean }
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "Expected a string" },
    ]);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return options?.emptyToNull ? null : "";
  }

  if (options?.maxLength && trimmed.length > options.maxLength) {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: `Must be ${options.maxLength} characters or fewer` },
    ]);
  }

  return trimmed;
}

export function optionalInteger(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "Expected an integer" },
    ]);
  }
  return parsed;
}

export function optionalNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "Expected a number" },
    ]);
  }
  return parsed;
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "Expected a boolean" },
    ]);
  }
  return value;
}

export function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "Expected an array of strings" },
    ]);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new RequestValidationError("Invalid request payload", [
        { field: `${field}[${index}]`, message: "Expected a string" },
      ]);
    }
    return entry.trim();
  }).filter(Boolean);
}

export function requireUuid(value: unknown, field: string): string {
  const stringValue = requireString(value, field, { maxLength: 64 });
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(stringValue)) {
    throw new RequestValidationError("Invalid request payload", [
      { field, message: "Expected a UUID" },
    ]);
  }
  return stringValue;
}

export function parseJsonText(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError("Invalid JSON body", [
      { field: "body", message: "Request body must be valid JSON" },
    ]);
  }
}

