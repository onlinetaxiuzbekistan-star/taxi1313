import { matchRoute, type MatchPriority, type RouteMatchResult } from "./route-match.js";

export interface BatchRide {
  id: number;
  fromCity: string;
  toCity: string;
  carClass?: string;
  passengers?: number;
}

export interface BatchDriver {
  id: number;
  tripId: number;
  fromCity: string;
  toCity: string;
  totalSeats: number;
  seatsTaken: number;
  hasPassengers: boolean;
}

export interface BatchAssignment {
  rideId: number;
  driverId: number;
  tripId: number;
  matchPriority: MatchPriority;
  matchScore: number;
  extraDistanceKm: number;
  extraTimeMin: number;
}

interface Candidate {
  ride: BatchRide;
  driver: BatchDriver;
  match: RouteMatchResult;
  finalScore: number;
}

function runPass(
  rides: BatchRide[],
  drivers: BatchDriver[],
  maxDetourKm: number,
  maxDetourMin: number,
  assignedRides: Set<number>,
  driverSeatUsed: Map<number, number>,
): BatchAssignment[] {
  const candidates: Candidate[] = [];
  const rideAlternatives = new Map<number, number>();
  const unassignedRides = rides.filter(r => !assignedRides.has(r.id));

  for (const ride of unassignedRides) {
    let altCount = 0;
    const requiredSeats = ride.passengers || 1;
    for (const driver of drivers) {
      const used = driverSeatUsed.get(driver.id) || driver.seatsTaken;
      if (used + requiredSeats > driver.totalSeats) continue;

      const result = matchRoute(
        driver.fromCity, driver.toCity,
        ride.fromCity, ride.toCity,
        maxDetourKm, maxDetourMin,
      );
      if (!result) continue;

      altCount++;

      let finalScore = result.score;

      const currentUsed = driverSeatUsed.get(driver.id) || driver.seatsTaken;
      if (currentUsed > 0) finalScore += 20;

      const fillRatio = currentUsed / driver.totalSeats;
      finalScore += fillRatio * 10;

      if (result.priority === "exact") finalScore += 50;
      else if (result.priority === "partial") finalScore += 20;

      const remainingSeats = driver.totalSeats - currentUsed;
      if (remainingSeats >= 3) finalScore += 5;

      candidates.push({ ride, driver, match: result, finalScore });
    }
    rideAlternatives.set(ride.id, altCount);
  }

  for (const c of candidates) {
    const alts = rideAlternatives.get(c.ride.id) || 1;
    if (alts === 1) c.finalScore += 30;
    else if (alts <= 3) c.finalScore += 15;
  }

  candidates.sort((a, b) => {
    const altsA = rideAlternatives.get(a.ride.id) || 999;
    const altsB = rideAlternatives.get(b.ride.id) || 999;
    if (altsA !== altsB) return altsA - altsB;
    return b.finalScore - a.finalScore;
  });

  const assignments: BatchAssignment[] = [];

  for (const c of candidates) {
    if (assignedRides.has(c.ride.id)) continue;

    const reqSeats = c.ride.passengers || 1;
    const used = driverSeatUsed.get(c.driver.id) || 0;
    if (used + reqSeats > c.driver.totalSeats) continue;

    assignedRides.add(c.ride.id);
    driverSeatUsed.set(c.driver.id, used + reqSeats);

    assignments.push({
      rideId: c.ride.id,
      driverId: c.driver.id,
      tripId: c.driver.tripId,
      matchPriority: c.match.priority,
      matchScore: c.finalScore,
      extraDistanceKm: c.match.extraDistanceKm,
      extraTimeMin: c.match.extraTimeMin,
    });
  }

  return assignments;
}

export function batchMatchRides(
  rides: BatchRide[],
  drivers: BatchDriver[],
  maxDetourKm: number = 50,
  maxDetourMin: number = 40,
): BatchAssignment[] {
  const assignedRides = new Set<number>();
  const driverSeatUsed = new Map<number, number>();

  for (const driver of drivers) {
    driverSeatUsed.set(driver.id, driver.seatsTaken);
  }

  const allAssignments: BatchAssignment[] = [];

  const pass1 = runPass(rides, drivers, maxDetourKm, maxDetourMin, assignedRides, driverSeatUsed);
  allAssignments.push(...pass1);

  const remaining1 = rides.filter(r => !assignedRides.has(r.id)).length;
  if (remaining1 > 0) {
    const widerKm = Math.min(maxDetourKm * 1.6, 120);
    const widerMin = Math.min(maxDetourMin * 1.6, 80);
    const pass2 = runPass(rides, drivers, widerKm, widerMin, assignedRides, driverSeatUsed);
    allAssignments.push(...pass2);
  }

  const remaining2 = rides.filter(r => !assignedRides.has(r.id)).length;
  if (remaining2 > 0) {
    const ultraKm = Math.min(maxDetourKm * 2.5, 200);
    const ultraMin = Math.min(maxDetourMin * 2.5, 120);
    const pass3 = runPass(rides, drivers, ultraKm, ultraMin, assignedRides, driverSeatUsed);
    allAssignments.push(...pass3);
  }

  return allAssignments;
}
