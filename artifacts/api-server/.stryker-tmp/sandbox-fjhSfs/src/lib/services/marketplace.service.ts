/**
 * Marketplace service — listing data-access (list / create / claim-for-purchase).
 */
// @ts-nocheck

import { db, marketplaceListingsTable, ridesTable, usersTable } from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";
import type { DbTransaction } from "../ledger.js";

/** Active listings not owned by the requesting driver, enriched with ride + seller info. */
export async function listListings(excludeUserId: number) {
  return db
    .select({
      id: marketplaceListingsTable.id,
      rideId: marketplaceListingsTable.rideId,
      sellerId: marketplaceListingsTable.sellerId,
      price: marketplaceListingsTable.price,
      comment: marketplaceListingsTable.comment,
      status: marketplaceListingsTable.status,
      createdAt: marketplaceListingsTable.createdAt,
      fromCity: marketplaceListingsTable.fromCity,
      toCity: marketplaceListingsTable.toCity,
      scheduledAt: marketplaceListingsTable.scheduledAt,
      seatsCount: marketplaceListingsTable.seatsCount,
      clientName: marketplaceListingsTable.clientName,
      clientPhone: marketplaceListingsTable.clientPhone,
      baggageType: marketplaceListingsTable.baggageType,
      basePrice: marketplaceListingsTable.basePrice,
      routeId: marketplaceListingsTable.routeId,
      fromDistrictId: marketplaceListingsTable.fromDistrictId,
      toDistrictId: marketplaceListingsTable.toDistrictId,
      rideFromCity: ridesTable.fromCity,
      rideToCity: ridesTable.toCity,
      rideScheduledAt: ridesTable.scheduledAt,
      passengers: ridesTable.passengers,
      carClass: ridesTable.carClass,
      ridePrice: ridesTable.price,
      sellerName: usersTable.name,
      sellerPhone: usersTable.phone,
      sellerCar: usersTable.carModel,
      sellerCarNumber: usersTable.carNumber,
      sellerRating: usersTable.rating,
    })
    .from(marketplaceListingsTable)
    .leftJoin(ridesTable, eq(marketplaceListingsTable.rideId, ridesTable.id))
    .innerJoin(usersTable, eq(marketplaceListingsTable.sellerId, usersTable.id))
    .where(and(eq(marketplaceListingsTable.status, "active"), ne(marketplaceListingsTable.sellerId, excludeUserId)))
    .orderBy(desc(marketplaceListingsTable.createdAt));
}

export async function createListing(tx: DbTransaction, values: typeof marketplaceListingsTable.$inferInsert) {
  const [listing] = await tx.insert(marketplaceListingsTable).values(values).returning();
  return listing;
}

/** Lock an active listing for purchase (FOR UPDATE). Returns it, or null if gone/sold. */
export async function buyListing(tx: DbTransaction, listingId: number) {
  const [listing] = await tx
    .select()
    .from(marketplaceListingsTable)
    .where(and(eq(marketplaceListingsTable.id, listingId), eq(marketplaceListingsTable.status, "active")))
    .for("update");
  return listing ?? null;
}
