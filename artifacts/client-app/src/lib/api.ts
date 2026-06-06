const BASE = import.meta.env.BASE_URL;

function apiUrl(path: string) {
  return `${BASE}api${path}`;
}

function getToken() {
  return localStorage.getItem("clientToken");
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

export async function apiFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...opts,
    headers: headers(opts?.headers as Record<string, string>),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface City {
  id: number;
  nameRu: string;
  nameUz?: string;
  slug?: string;
  lat?: number;
  lng?: number;
  isActive?: boolean;
}

export interface PriceEstimate {
  price: number;
  distance: number;
  duration: number;
  breakdown: {
    baseRate: number;
    perKmRate: number;
    intercityFee: number;
    passengerFee: number;
    classFee: number;
  };
}

export interface Ride {
  id: number;
  riderId?: number;
  driverId?: number;
  fromCity: string;
  toCity: string;
  fromAddress?: string;
  toAddress?: string;
  scheduledAt?: string;
  passengers: number;
  carClass: string;
  status: string;
  price: number;
  distance?: number;
  duration?: number;
  riderName?: string;
  riderPhone?: string;
  driverName?: string;
  driverPhone?: string;
  driverCar?: string;
  driverCarNumber?: string;
  driverRating?: number;
  createdAt: string;
  updatedAt?: string;
}

export async function getCities(): Promise<City[]> {
  const data = await apiFetch<{ cities: City[] }>("/cities");
  return data.cities;
}

export async function estimatePrice(body: {
  fromCity: string;
  toCity: string;
  passengers: number;
  carClass: string;
}): Promise<PriceEstimate> {
  return apiFetch<PriceEstimate>("/rides/price-estimate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createRide(body: {
  fromCity: string;
  toCity: string;
  scheduledAt: string;
  passengers: number;
  carClass: string;
  riderName?: string;
  riderPhone?: string;
  price?: number;
  distance?: number;
  duration?: number;
}): Promise<Ride> {
  return apiFetch<Ride>("/rides", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getMyRides(): Promise<{ rides: Ride[]; total: number }> {
  return apiFetch("/rides?limit=50");
}

export async function getRide(id: number): Promise<Ride> {
  return apiFetch(`/rides/${id}`);
}

export async function loginUser(phone: string, password: string) {
  return apiFetch<{ user: any; token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
}

export async function registerUser(body: {
  phone: string;
  name: string;
  password: string;
}) {
  return apiFetch<{ user: any; token: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ ...body, role: "rider" }),
  });
}
