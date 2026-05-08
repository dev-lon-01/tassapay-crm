/**
 * Shared types for the account-lookup module.
 * The CountryCode union grows as new providers are added.
 */

export type CountryCode = 'ET';
export type MethodType = 'bank' | 'wallet';

export interface SupportedMethod {
  /** 'bank' or 'wallet' — used to label the option in the UI. */
  type: MethodType;
  /** Exact string the upstream provider expects (e.g. Tayo's `bankName`). */
  code: string;
  /** Human-readable label shown to agents (often identical to `code`). */
  label: string;
}

export interface LookupRequest {
  country: CountryCode;
  methodType: MethodType;
  methodCode: string;
  accountNumber: string;
}

export interface LookupResult {
  status: 'success' | 'failed' | 'error';
  accountName: string | null;
  responseCode: string | null;
  responseDescription: string | null;
  /** Full upstream response body, persisted to account_lookups.raw_response. */
  raw: unknown;
}
