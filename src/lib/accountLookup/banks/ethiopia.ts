import type { SupportedMethod } from "../types";

/**
 * The 40 Ethiopia methods supported by Tayo's account-lookup endpoint.
 * `code` MUST be sent verbatim (case-sensitive) as the `bankName` field.
 * `type` distinguishes wallets from banks for the UI; both call the same
 * upstream endpoint.
 */
export const ETHIOPIA_METHODS: SupportedMethod[] = [
  { type: "bank",   code: "Rays Microfinance",        label: "Rays Microfinance" },
  { type: "bank",   code: "Awash Bank",               label: "Awash Bank" },
  { type: "bank",   code: "CBE",                      label: "CBE" },
  { type: "bank",   code: "Abbysinia Bank",           label: "Abbysinia Bank" },
  { type: "bank",   code: "Dashen Bank",              label: "Dashen Bank" },
  { type: "bank",   code: "NIB Bank",                 label: "NIB Bank" },
  { type: "bank",   code: "COOP",                     label: "COOP" },
  { type: "bank",   code: "Oromia Bank",              label: "Oromia Bank" },
  { type: "bank",   code: "Wegagen Bank",             label: "Wegagen Bank" },
  { type: "bank",   code: "Lion Bank",                label: "Lion Bank" },
  { type: "bank",   code: "Zemen Bank",               label: "Zemen Bank" },
  { type: "bank",   code: "Bunna Bank",               label: "Bunna Bank" },
  { type: "bank",   code: "Berhan Bank",              label: "Berhan Bank" },
  { type: "bank",   code: "Debub Global Bank",        label: "Debub Global Bank" },
  { type: "bank",   code: "Abay Bank",                label: "Abay Bank" },
  { type: "bank",   code: "Enat Bank",                label: "Enat Bank" },
  { type: "bank",   code: "Shebelle Bank or HCash",   label: "Shebelle Bank or HCash" },
  { type: "bank",   code: "Hibret Bank",              label: "Hibret Bank" },
  { type: "bank",   code: "Addis Credit and Saving",  label: "Addis Credit and Saving" },
  { type: "bank",   code: "Hijra Bank",               label: "Hijra Bank" },
  { type: "bank",   code: "Zamzam Bank",              label: "Zamzam Bank" },
  { type: "bank",   code: "Ahadu Bank",               label: "Ahadu Bank" },
  { type: "bank",   code: "Gadda Bank",               label: "Gadda Bank" },
  { type: "wallet", code: "CBE Birr",                 label: "CBE Birr" },
  { type: "bank",   code: "Tsedey Bank",              label: "Tsedey Bank" },
  { type: "bank",   code: "Sidama Bank",              label: "Sidama Bank" },
  { type: "bank",   code: "KAAFI Micro Finance",      label: "KAAFI Micro Finance" },
  { type: "bank",   code: "One Micro Finance",        label: "One Micro Finance" },
  { type: "bank",   code: "Amhara Bank",              label: "Amhara Bank" },
  { type: "bank",   code: "Addis International Bank", label: "Addis International Bank" },
  { type: "wallet", code: "Kacha DFS",                label: "Kacha DFS" },
  { type: "bank",   code: "Tsehay Bank",              label: "Tsehay Bank" },
  { type: "bank",   code: "GOH Betoch",               label: "GOH Betoch" },
  { type: "bank",   code: "Sinqee Bank",              label: "Sinqee Bank" },
  { type: "bank",   code: "VisionFund MFI",           label: "VisionFund MFI" },
  { type: "bank",   code: "Sahal MFI",                label: "Sahal MFI" },
  { type: "wallet", code: "Yaya Wallet",              label: "Yaya Wallet" },
  { type: "bank",   code: "Rammis Bank",              label: "Rammis Bank" },
  { type: "bank",   code: "Dire MFI",                 label: "Dire MFI" },
  { type: "wallet", code: "Halal Pay",                label: "Halal Pay" },
];

/** Fast O(1) lookup by code for validation. */
export const ETHIOPIA_METHODS_BY_CODE: Record<string, SupportedMethod> =
  Object.fromEntries(ETHIOPIA_METHODS.map((m) => [m.code, m]));
