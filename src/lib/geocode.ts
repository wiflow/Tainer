import "server-only";

/**
 * Address → coordinates via OpenStreetMap Nominatim. No API key; the usage
 * policy requires an identifying User-Agent and tolerates only light,
 * interactive traffic — which is exactly what site-location edits are.
 */

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  /** Nominatim's normalized display name, e.g. "Copenhagen, Denmark". */
  displayName: string;
  /** ISO-3166-1 alpha-2, uppercase, when the result carries one. */
  countryCode: string | null;
};

export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  const normalized = query.trim();
  if (!normalized) throw new Error("An address is required.");

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", normalized);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: {
      "user-agent": "TainerV2-panel (https://tainer.sh)",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Geocoding failed (HTTP ${response.status}).`);
  }

  const results = (await response.json()) as {
    lat?: string;
    lon?: string;
    display_name?: string;
    address?: { country_code?: string };
  }[];

  const hit = results[0];
  const latitude = hit ? Number.parseFloat(hit.lat ?? "") : NaN;
  const longitude = hit ? Number.parseFloat(hit.lon ?? "") : NaN;

  if (!hit || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`No location found for "${normalized}" — try a city and country.`);
  }

  return {
    countryCode: hit.address?.country_code ? hit.address.country_code.toUpperCase() : null,
    displayName: hit.display_name ?? normalized,
    latitude,
    longitude,
  };
}
