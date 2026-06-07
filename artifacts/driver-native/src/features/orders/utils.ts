import { Linking } from "react-native";

// Ported from web orders/utils.ts + lib/utils.formatCurrency (RN-safe: no Intl
// dependency — manual thousands grouping for Hermes reliability).

export function formatCurrency(amount: number | undefined | null): string {
  const v = Math.round(Number(amount) || 0);
  const grouped = v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} сум`;
}

export function formatRoutePoint(districtName: string | null | undefined, cityName: string): string {
  if (districtName && districtName !== cityName) return `${districtName}, ${cityName}`;
  return cityName;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Navigation deep links. The full app-chooser (Yandex/Google/2GIS) lands in CP2;
// openNavigation uses the universal geo: intent which the OS resolves to the
// driver's default maps/navigation app, with a Google Maps web fallback.
export function navDeepLinks(toLat: number, toLng: number) {
  return {
    yandex: `yandexnavi://build_route_on_map?lat_to=${toLat}&lon_to=${toLng}`,
    google: `google.navigation:q=${toLat},${toLng}`,
    dgis: `dgis://2gis.ru/routeSearch/rsType/car/to/${toLng},${toLat}`,
    geo: `geo:${toLat},${toLng}?q=${toLat},${toLng}`,
    web: `https://www.google.com/maps/dir/?api=1&destination=${toLat},${toLng}`,
  };
}

export async function openNavigation(toLat?: number, toLng?: number): Promise<void> {
  if (toLat == null || toLng == null) return;
  const links = navDeepLinks(toLat, toLng);
  try {
    await Linking.openURL(links.geo);
  } catch {
    try {
      await Linking.openURL(links.web);
    } catch {
      // no maps app available
    }
  }
}
