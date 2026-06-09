// Offline GPS → city resolver. Maps a raw GPS fix to the nearest known
// Uzbekistan city/region center, so the driver's CURRENT location (not a stale
// profile field) drives the auto-detected origin on the create-ride screen.
//
// Fully offline: no backend call, no geocoding service. We keep a small table of
// regional/city centers keyed by normalized name and match it against whatever
// city names the API returns at runtime (matching by name, computing distance by
// coordinate). Names cover Russian + common Latin/Uzbek spellings.

type LatLng = { lat: number; lng: number };

// Normalize a city name for fuzzy matching: lowercase, strip diacritics-ish
// punctuation and common suffixes ("г.", "город", "обл", "вилоят", "shahri").
export function normalizeCityName(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[`'’.,()]/g, " ")
    .replace(/\b(г|город|обл|область|вилоят|viloyati|shahri|tumani|sh)\b/g, " ")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

// Center coordinates keyed by a set of normalized name variants.
const TABLE: { coord: LatLng; names: string[] }[] = [
  { coord: { lat: 41.2995, lng: 69.2401 }, names: ["ташкент", "tashkent", "toshkent"] },
  { coord: { lat: 40.3864, lng: 71.7864 }, names: ["фергана", "fergana", "farg ona", "fargona", "fargona"] },
  { coord: { lat: 40.7821, lng: 72.3442 }, names: ["андижан", "andijan", "andijon"] },
  { coord: { lat: 41.0011, lng: 71.6726 }, names: ["наманган", "namangan"] },
  { coord: { lat: 39.6542, lng: 66.9597 }, names: ["самарканд", "samarkand", "samarqand"] },
  { coord: { lat: 39.7747, lng: 64.4286 }, names: ["бухара", "bukhara", "buxoro"] },
  { coord: { lat: 40.0844, lng: 65.3792 }, names: ["навои", "navoi", "navoiy"] },
  { coord: { lat: 38.8606, lng: 65.7891 }, names: ["карши", "karshi", "qarshi", "кашкадарья", "qashqadaryo"] },
  { coord: { lat: 37.2242, lng: 67.2783 }, names: ["термез", "termez", "termiz", "сурхандарья", "surxondaryo"] },
  { coord: { lat: 40.491, lng: 68.781 }, names: ["гулистан", "gulistan", "guliston", "сырдарья", "sirdaryo"] },
  { coord: { lat: 40.1158, lng: 67.8422 }, names: ["джизак", "jizzakh", "jizzax"] },
  { coord: { lat: 42.46, lng: 59.6166 }, names: ["нукус", "nukus", "каракалпакстан", "qoraqalpogiston"] },
  { coord: { lat: 41.55, lng: 60.6333 }, names: ["ургенч", "urgench", "urganch", "хорезм", "xorazm"] },
  { coord: { lat: 41.3783, lng: 60.3639 }, names: ["хива", "khiva", "xiva"] },
  { coord: { lat: 40.5286, lng: 70.9425 }, names: ["коканд", "kokand", "qoqon", "qo qon"] },
  { coord: { lat: 40.4711, lng: 71.7243 }, names: ["маргилан", "margilan", "margilon", "margʻilon"] },
  { coord: { lat: 41.0167, lng: 70.1436 }, names: ["ангрен", "angren"] },
  { coord: { lat: 41.4689, lng: 69.5822 }, names: ["чирчик", "chirchik", "chirchiq"] },
  { coord: { lat: 40.8447, lng: 69.5983 }, names: ["алмалык", "almalyk", "olmaliq"] },
  { coord: { lat: 40.2206, lng: 69.2697 }, names: ["бекабад", "bekabad", "bekobod"] },
];

const COORD_BY_NAME = new Map<string, LatLng>();
for (const row of TABLE) for (const n of row.names) COORD_BY_NAME.set(normalizeCityName(n), row.coord);

// Coordinate for a city name, or null if we don't have one.
export function coordForCityName(name: string): LatLng | null {
  return COORD_BY_NAME.get(normalizeCityName(name)) ?? null;
}

// Equirectangular approximation — accurate enough for picking the nearest city.
function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(lat);
  return Math.sqrt(dLat * dLat + x * x) * R;
}

// Given a GPS fix and the runtime city list ({id, nameRu}), return the id of the
// nearest city we have coordinates for. Ignores cities farther than maxKm so a
// fix outside any known region doesn't snap to a far-away city.
export function nearestCityId(
  lat: number,
  lng: number,
  cities: { id: string; nameRu?: string | null }[],
  maxKm = 150,
): string | null {
  let best: { id: string; km: number } | null = null;
  for (const c of cities) {
    const coord = coordForCityName(c.nameRu || c.id);
    if (!coord) continue;
    const km = distanceKm({ lat, lng }, coord);
    if (!best || km < best.km) best = { id: c.id, km };
  }
  return best && best.km <= maxKm ? best.id : null;
}
