export interface SeatPassenger {
  id: number;
  name: string;
  phone: string;
  fromDistrict: string | null;
  toDistrict: string | null;
  fromCity: string | null;
  toCity: string | null;
  seatNumber: number;
  price: number;
  status: string;
  baggage: string | null;
  notes: string | null;
  gender: string | null;
  age: string | null;
  isManual?: boolean;
  isPriority?: boolean;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
}

export interface TripStop {
  type: "pickup" | "dropoff";
  lat: number;
  lng: number;
  address: string;
  districtName: string | null;
  cityName: string;
  passengers: {
    id: number;
    name: string;
    phone: string;
    seatNumber: number;
    status: string;
  }[];
  distanceKm: number;
  isNext: boolean;
}

export interface QueueInfoData {
  position: number;
  totalInQueue: number;
  estimatedWaitMinutes?: number;
  route?: string;
  joinedAt?: string;
  passengers?: Array<{
    id: number;
    name: string;
    phone: string;
    status: string;
    seatNumber: number;
    isPriority?: boolean;
    fromDistrict?: string | null;
    toDistrict?: string | null;
  }>;
}

export interface PickupStop {
  lat: number;
  lng: number;
  address: string;
  districtName: string | null;
  cityName: string;
  passengers: {
    id: number;
    name: string;
    phone: string;
    seatNumber: number;
    status: string;
  }[];
  distanceKm: number;
}

export interface PickupRouteData {
  stops: PickupStop[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  routeGeometry?: [number, number][];
}

export interface Ride {
  id: number;
  status: string;
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
  driverPenalty?: number;
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
}

export interface CityInfo {
  name: string;
  lat: number;
  lng: number;
  districts?: { name: string; lat: number; lng: number }[];
}

export type DriverScreen = "idle" | "route_select" | "seat_view" | "pickup" | "active" | "completed";

export type GPSStatus = "waiting" | "active" | "denied" | "unavailable" | "error";
