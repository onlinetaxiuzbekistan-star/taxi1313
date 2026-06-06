import { useState, useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import type { GPSStatus } from "../types";

export function useDriverGPS(token: string | null, userId: number | undefined, isActive: boolean) {
  const watchRef = useRef<number | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastSendRef = useRef<number>(0);
  const lastLatRef = useRef<number>(0);
  const lastLngRef = useRef<number>(0);
  const [gpsStatus, setGpsStatus] = useState<GPSStatus>("waiting");

  useEffect(() => {
    if (!isActive || !token || !userId) { setGpsStatus("waiting"); return; }
    if (!window.isSecureContext || !navigator.geolocation) { setGpsStatus("unavailable"); return; }

    setGpsStatus("waiting");

    const sendToServer = (lat: number, lng: number, accuracy?: number, heading?: number | null, speed?: number | null) => {
      posRef.current = { lat, lng };
      const now = Date.now();
      const minInterval = document.visibilityState === "visible" ? 5000 : 30000;
      const moved = Math.abs(lat - lastLatRef.current) > 0.0001 || Math.abs(lng - lastLngRef.current) > 0.0001;
      if (now - lastSendRef.current < minInterval && !moved) return;
      lastSendRef.current = now;
      lastLatRef.current = lat;
      lastLngRef.current = lng;

      window.dispatchEvent(new CustomEvent("buxtaxi:send-ws", {
        detail: {
          type: "driver_location",
          lat, lng,
          accuracy: accuracy || undefined,
          heading: heading ?? undefined,
          speed: speed ?? undefined,
          ts: now,
        }
      }));
    };

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsStatus("active");
        sendToServer(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.heading, pos.coords.speed);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGpsStatus("denied");
        else if (err.code === err.POSITION_UNAVAILABLE) setGpsStatus("unavailable");
        else setGpsStatus("error");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [isActive, token, userId]);

  const updateMarker = useCallback((map: L.Map) => {
    if (!posRef.current) return;
    const { lat, lng } = posRef.current;
    const icon = L.divIcon({
      html: `<div style="width:18px;height:18px;border-radius:50%;background:#3f3f46;border:3px solid white;box-shadow:0 0 0 2px rgba(63,63,70,0.3),0 2px 6px rgba(0,0,0,.4)"></div>`,
      className: "", iconSize: [18, 18], iconAnchor: [9, 9],
    });
    if (driverMarkerRef.current) {
      driverMarkerRef.current.setLatLng([lat, lng]);
    } else {
      driverMarkerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
    }
  }, []);

  return { posRef, updateMarker, driverMarkerRef, gpsStatus };
}
