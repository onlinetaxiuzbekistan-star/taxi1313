export type LocationEvent = {
  lat: number;
  lng: number;
  speed: number;
  accuracy: number;
  bearing: number;
  time: number;
};

export type BuxtaxiBackgroundEvents = {
  onLocation: (event: LocationEvent) => void;
};
