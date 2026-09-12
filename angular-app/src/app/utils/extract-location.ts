export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Best-effort search for a GIS coordinate pair on a record — covers the field-name
 * spellings people actually use (latitude/longitude, lat/lng, lat/lon, or a nested
 * `location`/`coordinates`/`gis` object using any of those). Adjust the candidate
 * lists below once you see your MCP server's real field names for feeders/poles/etc.
 */
export function extractLocation(record: unknown): LatLng | null {
  if (!record || typeof record !== 'object') return null;
  const obj = record as Record<string, unknown>;

  const direct = readLatLng(obj);
  if (direct) return direct;

  for (const key of ['location', 'coordinates', 'gis', 'gisLocation', 'position']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object') {
      const found = readLatLng(nested as Record<string, unknown>);
      if (found) return found;
    }
  }
  return null;
}

function readLatLng(obj: Record<string, unknown>): LatLng | null {
  const lat = firstNumber(obj, ['latitude', 'lat']);
  const lng = firstNumber(obj, ['longitude', 'lng', 'lon']);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

function firstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}
