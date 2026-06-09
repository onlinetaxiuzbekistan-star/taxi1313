// Global flag: true while the driver has an active (accepted/in-progress) ride.
// Set by use-orders; read by the (driver) layout's hardware-back handler so the
// app cannot be exited until the ride is completed.
let active = false;

export function setRideActive(v: boolean) {
  active = v;
}

export function isRideActive(): boolean {
  return active;
}
