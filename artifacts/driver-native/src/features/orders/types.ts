// Ride-flow types, ported from web taxi-app/src/pages/driver/orders/types.ts
// (adapted: City carries id/nameRu as the cities API actually returns).

export interface City {
  id: string;
  nameRu: string;
  lat?: number;
  lng?: number;
}

export interface RouteOption {
  id?: number;
  fromCity: string;
  toCity: string;
  isActive?: boolean;
  priceEconomy?: number;
  priceComfort?: number;
  priceBusiness?: number;
}

export interface SeatPassenger {
  id: number;
  name: string;
  phone: string;
  fromDistrict?: string | null;
  toDistrict?: string | null;
  fromCity?: string | null;
  toCity?: string | null;
  seatNumber: number;
  price: number;
  status: string;
  baggage?: string | null;
  notes?: string | null;
  gender?: string | null;
  age?: string | null;
  isManual?: boolean;
  isPriority?: boolean;
  source?: string;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
}

export interface QueueInfoData {
  position: number;
  total?: number;
  totalInQueue?: number;
  avgWaitMinutes?: number;
  estimatedWaitMinutes?: number;
  priorityBoost?: number;
  hint?: string;
  route?: string;
  rideId?: number;
  isExpired?: boolean;
}

export interface Ride {
  id: number;
  status: string;
  driverId?: number | null;
  fromCity: string;
  toCity: string;
  fromDistrict?: string;
  toDistrict?: string;
  departureTime?: string;
  totalSeats?: number;
  occupiedSeats?: number;
  price?: number;
  totalRevenue?: number;
  driverRevenue?: number;
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
  seatPassengers?: SeatPassenger[];
  version?: number;
  routeId?: number;
  queueInfo?: QueueInfoData;
  // extra fields the lifecycle screens read
  seatsTotal?: number;
  fromDistrictName?: string | null;
  toDistrictName?: string | null;
  distance?: number | string;
  duration?: number | string;
  scheduledAt?: string;
}

// idle (offline or no ride) | route_select (create) | seat_view/pickup/active (active ride) | completed
export type DriverScreen =
  | "loading"
  | "idle"
  | "route_select"
  | "seat_view"
  | "pickup"
  | "active"
  | "completed";
