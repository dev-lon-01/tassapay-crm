/**
 * Region-based row-level security helpers.
 *
 * Regions are stored on `users.allowed_regions` as a JSON array of region
 * codes (e.g. ["UK", "EU"]). Each code maps to one or more country names that
 * match the `customers.country` column.
 */

export const REGION_MAP: Record<string, string[]> = {
  UK: ["United Kingdom"],
  EU: [
    "Ireland",
    "France",
    "Germany",
    "Spain",
    "Italy",
    "Netherlands",
    "Belgium",
    "Sweden",
    "Norway",
    "Denmark",
    "Portugal",
  ],
};

/**
 * Expands an array of region codes into a flat list of country names.
 */
export function getAllowedCountries(regions: string[]): string[] {
  return regions.flatMap((r) => REGION_MAP[r] ?? []);
}

/**
 * Builds an inline SQL fragment (no leading AND) for fencing customer rows.
 * Returns null if the caller is Admin (no fence required).
 * Returns { sql: "1=0", params: [] } if no countries map to the given regions
 * (deny-all for mis-configured accounts).
 */
export function buildCountryFence(
  regions: string[],
  isAdmin: boolean,
): { sql: string; params: string[] } | null {
  if (isAdmin) return null;
  const countries = getAllowedCountries(regions);
  if (countries.length === 0) return { sql: "1=0", params: [] };
  const placeholders = countries.map(() => "?").join(",");
  return { sql: `country IN (${placeholders})`, params: countries };
}

/**
 * Builds an inline SQL fragment for fencing transfer rows via a
 * customer_id subquery. Returns null if the caller is Admin.
 */
export function buildTransferFence(
  regions: string[],
  isAdmin: boolean,
): { sql: string; params: string[] } | null {
  if (isAdmin) return null;
  const countries = getAllowedCountries(regions);
  if (countries.length === 0) return { sql: "1=0", params: [] };
  const placeholders = countries.map(() => "?").join(",");
  return {
    sql: `customer_id IN (SELECT customer_id FROM customers WHERE country IN (${placeholders}))`,
    params: countries,
  };
}
