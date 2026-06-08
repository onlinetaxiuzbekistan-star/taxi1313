import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  Map as MapView,
  Camera,
  Marker,
  GeoJSONSource,
  Layer,
  UserLocation,
} from "@maplibre/maplibre-react-native";

import { Text } from "react-native";
import { useT } from "@/lib/i18n";
import type { Ride } from "../types";

// Keyless OSM raster style (no API key / billing) — closest to the web Leaflet/OSM look.
const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

type LngLat = [number, number];

function zoomFor(a: LngLat, b: LngLat): number {
  const maxDiff = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), 0.02);
  return Math.max(5, Math.min(13, Math.log2(360 / maxDiff) - 1));
}

// MapLibre port of web orders/components/FullScreenMap.tsx: A/B markers, the
// driving route (OSRM, with straight-line fallback) and the live driver dot.
export function RideMap({ ride, height = 200 }: { ride: Ride; height?: number }) {
  const { t } = useT();
  const hasRoute = ride.fromLat != null && ride.fromLng != null && ride.toLat != null && ride.toLng != null;
  const from: LngLat | null = hasRoute ? [ride.fromLng!, ride.fromLat!] : null;
  const to: LngLat | null = hasRoute ? [ride.toLng!, ride.toLat!] : null;
  const [routeCoords, setRouteCoords] = useState<LngLat[] | null>(null);

  useEffect(() => {
    if (!from || !to) return;
    let aborted = false;
    setRouteCoords(null);
    fetch(
      `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (aborted) return;
        const coords = d?.routes?.[0]?.geometry?.coordinates as LngLat[] | undefined;
        setRouteCoords(coords && coords.length >= 2 ? coords : [from, to]);
      })
      .catch(() => {
        if (!aborted) setRouteCoords([from, to]);
      });
    return () => {
      aborted = true;
    };
  }, [ride.fromLat, ride.fromLng, ride.toLat, ride.toLng]);

  if (!hasRoute || !from || !to) {
    return (
      <View
        style={{ height, borderRadius: 16 }}
        className="bg-card border border-border items-center justify-center overflow-hidden"
      >
        <Text className="font-sans text-muted-foreground text-sm">{t("map_unavailable")}</Text>
      </View>
    );
  }

  const center: LngLat = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];

  const routeGeoJSON = {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: routeCoords ?? [from, to] },
  };

  return (
    <View style={{ height, borderRadius: 16, overflow: "hidden" }} className="border border-border">
      <MapView mapStyle={OSM_STYLE as any} style={{ flex: 1 }} logo={false} attribution={false} compass={false}>
        <Camera center={center} zoom={zoomFor(from, to)} />

        <GeoJSONSource id="rideRoute" data={routeGeoJSON as any}>
          <Layer
            id="rideRouteLine"
            type="line"
            paint={{ "line-color": "#16a34a", "line-width": 5, "line-opacity": 0.9 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </GeoJSONSource>

        {/* A — origin */}
        <Marker lngLat={from}>
          <View className="w-7 h-7 rounded-full bg-emerald-500 border-2 border-white items-center justify-center">
            <Text className="text-white font-sans-bold text-[12px]">A</Text>
          </View>
        </Marker>
        {/* B — destination */}
        <Marker lngLat={to}>
          <View className="w-7 h-7 rounded-full bg-red-500 border-2 border-white items-center justify-center">
            <Text className="text-white font-sans-bold text-[12px]">B</Text>
          </View>
        </Marker>

        {/* live driver position */}
        <UserLocation />
      </MapView>
    </View>
  );
}
