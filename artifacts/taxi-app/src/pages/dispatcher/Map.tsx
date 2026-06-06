import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { useAuth } from "@/hooks/use-auth";
import { Wifi, WifiOff, Car } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const STATUS_COLORS: Record<string, string> = {
  online: "#10b981",
  busy: "#ef4444",
  offline: "#94a3b8",
};

const STATUS_LABELS: Record<string, string> = {
  online: "Свободен",
  busy: "В пути",
  offline: "Офлайн",
};

const UZ_CENTER: [number, number] = [40.5, 66.0];

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

interface Driver {
  id: number;
  name: string;
  phone?: string;
  status: string;
  lat?: number | null;
  lng?: number | null;
  carModel?: string;
  carNumber?: string;
  rating?: number;
  totalRides?: number;
}

function makeIcon(status: string, selected: boolean): L.DivIcon {
  const color = STATUS_COLORS[status] || STATUS_COLORS.offline;
  const size = selected ? 40 : 32;
  const border = selected ? "3px solid #1e293b" : "2px solid #fff";
  const shadow = selected ? "0 0 0 3px rgba(16,185,129,0.3)," : "";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:${border};
      box-shadow:${shadow} 0 2px 8px rgba(0,0,0,0.3);
      display:flex;align-items:center;justify-content:center;
      font-size:${selected ? 18 : 14}px;cursor:pointer;
      transition: all 0.3s ease;
    ">🚗</div>`,
  });
}

function smoothMove(marker: L.Marker, target: L.LatLngExpression, duration = 1000) {
  const start = marker.getLatLng();
  const end = L.latLng(target);
  const startTime = performance.now();

  function animate(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    const lat = start.lat + (end.lat - start.lat) * eased;
    const lng = start.lng + (end.lng - start.lng) * eased;
    marker.setLatLng([lat, lng]);

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }

  requestAnimationFrame(animate);
}

export default function Map() {
  const { token } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<number, L.Marker>>({});
  const wsConnectedPlaceholder = true;
  const initialFitDone = useRef(false);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const loadDrivers = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/dispatcher/stats`, { headers });
      if (res.ok) {
        const data = await res.json();
        setDrivers(data.drivers || []);
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    loadDrivers();
    const iv = setInterval(loadDrivers, 15000);
    return () => clearInterval(iv);
  }, [loadDrivers]);

  useEffect(() => {
    if (!token) return;

    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (!data) return;

      if (data.type === "driver_location" && data.driverId && typeof data.lat === "number" && typeof data.lng === "number") {
        setDrivers(prev => prev.map(d =>
          d.id === data.driverId ? { ...d, lat: data.lat, lng: data.lng } : d
        ));

        const marker = markersRef.current[data.driverId];
        if (marker) {
          smoothMove(marker, [data.lat, data.lng], 800);
        }
      }

      if (data.type === "driver_status") {
        setDrivers(prev => prev.map(d =>
          d.id === data.driverId ? { ...d, status: data.status } : d
        ));
      }

      if (data.type === "ride_updated" || data.type === "new_ride") {
        loadDrivers();
      }
    };

    window.addEventListener("buxtaxi:ws", handler);
    return () => {
      window.removeEventListener("buxtaxi:ws", handler);
    };
  }, [token, loadDrivers]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: UZ_CENTER,
      zoom: 7,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const filteredDrivers = useMemo(() => {
    if (filterStatus === "all") return drivers.filter(d => d.status !== "offline");
    return drivers.filter(d => d.status === filterStatus);
  }, [drivers, filterStatus]);

  const driversWithGps = useMemo(
    () => filteredDrivers.filter(d => d.lat && d.lng),
    [filteredDrivers]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(driversWithGps.map(d => d.id));

    Object.entries(markersRef.current).forEach(([idStr, marker]) => {
      const id = Number(idStr);
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        delete markersRef.current[id];
      }
    });

    driversWithGps.forEach(driver => {
      const isSelected = selectedDriverId === driver.id;
      const pos: L.LatLngExpression = [driver.lat!, driver.lng!];
      const icon = makeIcon(driver.status, isSelected);

      const statusColor = STATUS_COLORS[driver.status] || "#94a3b8";
      const statusLabel = STATUS_LABELS[driver.status] || "—";
      const popupHtml = `
        <div style="min-width:200px;font-family:system-ui,sans-serif;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${esc(driver.name || "")}</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:6px;">
            ${esc(driver.carModel || "")} ${esc(driver.carNumber || "")}
          </div>
          <div style="display:flex;gap:8px;align-items:center;font-size:12px;">
            <span style="
              background:${statusColor}20;
              color:${statusColor};
              padding:2px 8px;border-radius:99px;font-weight:600;
            ">${esc(statusLabel)}</span>
            ${driver.rating ? `<span>⭐ ${driver.rating.toFixed(1)}</span>` : ""}
            ${driver.totalRides !== undefined ? `<span>${driver.totalRides} поездок</span>` : ""}
          </div>
        </div>
      `;

      if (markersRef.current[driver.id]) {
        const marker = markersRef.current[driver.id];
        marker.setIcon(icon);
        marker.setPopupContent(popupHtml);
      } else {
        const marker = L.marker(pos, { icon })
          .addTo(map)
          .bindPopup(popupHtml, { closeButton: true, maxWidth: 280 });
        marker.on("click", () => {
          setSelectedDriverId(driver.id);
        });
        markersRef.current[driver.id] = marker;
      }
    });

    if (driversWithGps.length > 0 && !initialFitDone.current) {
      const bounds = L.latLngBounds(driversWithGps.map(d => [d.lat!, d.lng!] as [number, number]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
        initialFitDone.current = true;
      }
    }
  }, [driversWithGps, selectedDriverId]);

  const onlineCount = drivers.filter(d => d.status === "online").length;
  const busyCount = drivers.filter(d => d.status === "busy").length;

  const panToDriver = useCallback((driver: Driver) => {
    if (mapRef.current && driver.lat && driver.lng) {
      mapRef.current.setView([driver.lat, driver.lng], 13, { animate: true });
      const marker = markersRef.current[driver.id];
      if (marker) marker.openPopup();
    }
    setSelectedDriverId(driver.id);
  }, []);

  const wsConnected = wsConnectedPlaceholder;

  return (
    <DispatcherLayout>
      <div className="h-[calc(100vh-56px)] flex flex-col md:flex-row">
        <div className="w-full md:w-80 bg-card border-r border-border flex flex-col h-full shrink-0 z-10 shadow-[4px_0_15px_-3px_rgba(0,0,0,0.05)]">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-foreground">Карта водителей</h2>
                <p className="text-muted-foreground text-sm mt-0.5">{filteredDrivers.length} на карте</p>
              </div>
              <div className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full ${wsConnected ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                {wsConnected ? "LIVE" : "..."}
              </div>
            </div>

            <div className="flex gap-2 text-xs mt-3">
              {([
                ["all", "Все", `${onlineCount + busyCount}`],
                ["online", "Свободен", `${onlineCount}`],
                ["busy", "В пути", `${busyCount}`],
              ] as const).map(([status, label, count]) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                    filterStatus === status
                      ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20"
                      : "text-foreground hover:bg-muted border border-transparent"
                  }`}
                >
                  {status !== "all" && (
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                  )}
                  {label}
                  <span className="text-[10px] opacity-60">{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredDrivers.map(driver => {
              const color = STATUS_COLORS[driver.status] || STATUS_COLORS.offline;
              const hasGps = driver.lat && driver.lng;
              const isSelected = selectedDriverId === driver.id;
              return (
                <div
                  key={driver.id}
                  onClick={() => panToDriver(driver)}
                  className={`border rounded-xl p-3 flex items-center gap-3 transition-colors cursor-pointer group ${
                    isSelected
                      ? "bg-emerald-500/10 border-emerald-500/20"
                      : "bg-muted border-border hover:bg-muted active:bg-accent transition-colors"
                  }`}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                    style={{ backgroundColor: color + "15", color }}
                  >
                    {driver.name?.charAt(0) || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-emerald-600 transition-colors">
                      {driver.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {driver.carModel || "—"} {driver.carNumber || ""}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: color + "15", color }}
                      >
                        {STATUS_LABELS[driver.status] || "—"}
                      </span>
                      {hasGps ? (
                        <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                          <Wifi className="w-3 h-3" /> GPS
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <WifiOff className="w-3 h-3" /> Нет GPS
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredDrivers.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                Нет водителей для отображения
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 relative">
          <div ref={mapContainerRef} className="w-full h-full" />
          <div className="absolute top-4 left-4 bg-foreground/90 backdrop-blur rounded-xl shadow-lg border border-border px-4 py-3 z-[1000]">
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1.5">
                <Car className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-foreground">{onlineCount}</span>
                <span className="text-muted-foreground">свободных</span>
              </div>
              <div className="w-px h-4 bg-muted/80" />
              <div className="flex items-center gap-1.5">
                <Car className="w-4 h-4 text-red-500" />
                <span className="font-semibold text-foreground">{busyCount}</span>
                <span className="text-muted-foreground">в пути</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DispatcherLayout>
  );
}
