import type { CountryCode, LookupRequest, LookupResult, SupportedMethod } from "./types";
import { ETHIOPIA_METHODS, ETHIOPIA_METHODS_BY_CODE } from "./banks/ethiopia";
import { tayoEthiopiaLookup } from "./tayoEthiopia";

export type { CountryCode, MethodType, SupportedMethod, LookupRequest, LookupResult } from "./types";

const SUPPORTED_COUNTRIES: CountryCode[] = ["ET"];

export function isSupportedCountry(code: string): code is CountryCode {
  return (SUPPORTED_COUNTRIES as string[]).includes(code);
}

export function getSupportedMethods(country: CountryCode): SupportedMethod[] {
  if (country === "ET") return ETHIOPIA_METHODS;
  throw new Error(`Unsupported country: ${country}`);
}

export function findMethod(country: CountryCode, code: string): SupportedMethod | null {
  if (country === "ET") return ETHIOPIA_METHODS_BY_CODE[code] ?? null;
  return null;
}

export async function lookupAccount(req: LookupRequest): Promise<LookupResult> {
  if (req.country === "ET") return tayoEthiopiaLookup(req);
  throw new Error(`Unsupported country: ${req.country}`);
}
