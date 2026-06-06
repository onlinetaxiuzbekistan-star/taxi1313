import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Ride, PickupRouteData } from "../types";
import type { useDriverGPS } from "../hooks/useDriverGPS";
import { BASE_URL } from "../constants";

export function FullScreenMap({
  ride, className = "", driverGPS, pickupRoute, token,
}: {
  ride: Ride; className?: string;
  driverGPS?: ReturnType<typeof useDriverGPS>;
  pickupRoute?: PickupRouteData | null;
  token?: string | null;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null; }

    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([40.5, 68], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
    leafletRef.current = map;

    const allBounds: L.LatLngExpression[] = [];

    if (ride.fromLat && ride.fromLng && ride.toLat && ride.toLng) {
      const gIcon = L.divIcon({
        html: `<div style="width:32px;height:32px;border-radius:50%;background:#10b981;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:13px">A</div>`,
        className: "", iconSize: [32, 32], iconAnchor: [16, 16],
      });
      const rIcon = L.divIcon({
        html: `<div style="width:32px;height:32px;border-radius:50%;background:#ef4444;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:13px">B</div>`,
        className: "", iconSize: [32, 32], iconAnchor: [16, 16],
      });
      const from: L.LatLngExpression = [ride.fromLat, ride.fromLng];
      const to: L.LatLngExpression = [ride.toLat, ride.toLng];
      L.marker(from, { icon: gIcon }).addTo(map);
      L.marker(to, { icon: rIcon }).addTo(map);
      allBounds.push(from, to);
    }

    if (pickupRoute && pickupRoute.stops.length > 0) {
      const STOP_COLORS = ["#52525b", "#3f3f46", "#71717a", "#a1a1aa"];
      pickupRoute.stops.forEach((stop) => {
        const color = STOP_COLORS[(stop.order - 1) % STOP_COLORS.length];
        const icon = L.divIcon({
          html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:white;font-weight:900;font-size:14px">${stop.order}</div>`,
          className: "", iconSize: [30, 30], iconAnchor: [15, 15],
        });
        L.marker([stop.lat, stop.lng], { icon }).addTo(map)
          .bindPopup(`<b>${stop.order}. ${stop.name}</b><br/>${stop.pickupAddress || "Место " + stop.seatNumber}`);
        allBounds.push([stop.lat, stop.lng]);
      });

      if (pickupRoute.geometry?.coordinates && pickupRoute.geometry.coordinates.length >= 2) {
        const coords: L.LatLngExpression[] = pickupRoute.geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]] as L.LatLngExpression
        );
        L.polyline(coords, { color: "#52525b", weight: 5, opacity: 0.85, dashArray: "12 6" }).addTo(map);
        allBounds.push(...coords.slice(0, 20));
      }
    }

    if (allBounds.length >= 2) {
      const hasPickup = pickupRoute && pickupRoute.stops.length > 0;
      if (!hasPickup && ride.fromLat && ride.fromLng && ride.toLat && ride.toLng) {
        const ctrl = new AbortController();
        fetch(`https://router.project-osrm.org/route/v1/driving/${ride.fromLng},${ride.fromLat};${ride.toLng},${ride.toLat}?overview=full&geometries=geojson`, { signal: ctrl.signal })
          .then(r => r.json())
          .then(data => {
            if (ctrl.signal.aborted) return;
            if (data.code === "Ok" && data.routes?.[0]?.geometry?.coordinates) {
              const coords: L.LatLngExpression[] = data.routes[0].geometry.coordinates.map(
                (c: [number, number]) => [c[1], c[0]] as L.LatLngExpression
              );
              L.polyline(coords, { color: "#16a34a", weight: 5, opacity: 0.9 }).addTo(map);
              map.fitBounds(L.latLngBounds(coords), { padding: [60, 60] });
            } else {
              const from: L.LatLngExpression = [ride.fromLat!, ride.fromLng!];
              const to: L.LatLngExpression = [ride.toLat!, ride.toLng!];
              L.polyline([from, to], { color: "#16a34a", weight: 3, dashArray: "10 8", opacity: 0.7 }).addTo(map);
              map.fitBounds([from, to], { padding: [60, 60] });
            }
          })
          .catch(() => {
            if (ctrl.signal.aborted) return;
            const from: L.LatLngExpression = [ride.fromLat!, ride.fromLng!];
            const to: L.LatLngExpression = [ride.toLat!, ride.toLng!];
            L.polyline([from, to], { color: "#16a34a", weight: 3, dashArray: "10 8", opacity: 0.7 }).addTo(map);
            map.fitBounds([from, to], { padding: [60, 60] });
          });
        (map as any)._osrmCtrl = ctrl;
      } else {
        map.fitBounds(L.latLngBounds(allBounds), { padding: [60, 60] });
      }
    }

    if (driverGPS) driverGPS.updateMarker(map);

    return () => { (map as any)._osrmCtrl?.abort(); map.remove(); leafletRef.current = null; };
  }, [ride.fromLat, ride.fromLng, ride.toLat, ride.toLng, pickupRoute]);

  useEffect(() => {
    if (!driverGPS || !leafletRef.current) return;
    const intv = setInterval(() => {
      if (leafletRef.current) driverGPS.updateMarker(leafletRef.current);
    }, 3000);
    return () => clearInterval(intv);
  }, [driverGPS]);

  return <div ref={mapRef} className={`w-full ${className}`} />;
}

