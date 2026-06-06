export function formatRoutePoint(districtName: string | null | undefined, cityName: string): string {
  if (districtName && districtName !== cityName) return `${districtName}, ${cityName}`;
  return cityName;
}

export function buildYandexNavUrl(
  lat: number, lng: number,
  driverLat?: number | null, driverLng?: number | null
): string {
  const base = `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lng}`;
  if (driverLat && driverLng) return `${base}&lat_from=${driverLat}&lon_from=${driverLng}`;
  return base;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
