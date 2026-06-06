/**
 * Call Center Routes
 *
 * POST /api/calls/incoming  — SIP/telephony webhook: fires incoming_call WS event
 * GET  /api/calls            — list recent call logs
 */
import { Router, type IRouter } from "express";
import { db, callLogsTable, clientsTable } from "@workspace/db";
import { eq, desc, like, or } from "drizzle-orm";
import { broadcastToRole } from "../lib/websocket.js";

const router: IRouter = Router();

/**
 * POST /api/calls/incoming
 * Body: { phone: string, note?: string }
 *
 * Called by PBX/SIP gateway when a client phones in.
 * 1. Find or create client record
 * 2. Log the call
 * 3. Broadcast incoming_call to all dispatcher WS connections
 */
router.post("/incoming", async (req, res) => {
  try {
    const { phone, note } = req.body;
    if (!phone) {
      res.status(400).json({ error: "validation_error", message: "phone is required" });
      return;
    }

    const normalised = phone.trim().replace(/\s+/g, "");

    // Find or create client
    let client = (await db.select().from(clientsTable).where(eq(clientsTable.phone, normalised)))[0];
    if (!client) {
      [client] = await db.insert(clientsTable).values({ name: null as any, phone: normalised }).returning();
    }

    // Log the call
    const [callLog] = await db.insert(callLogsTable).values({
      phone: normalised,
      clientId: client.id,
      note,
    }).returning();

    // Fire WebSocket event ONLY to authenticated dispatchers (PII-safe)
    broadcastToRole("dispatcher", {
      type: "incoming_call",
      call: callLog,
      client: { id: client.id, name: client.name, phone: client.phone, totalOrders: client.totalOrders },
    });

    req.log.info({ phone: normalised, clientId: client.id }, "Incoming call processed");
    res.json({ callLog, client });
  } catch (err) {
    req.log.error({ err }, "Incoming call error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

/**
 * GET /api/calls/lookup-client?phone=...
 * Read-only client lookup by phone number (no side effects)
 */
router.get("/lookup-client", async (req, res) => {
  try {
    const phone = (req.query.phone as string || "").trim().replace(/\s+/g, "");
    if (!phone) {
      res.status(400).json({ error: "validation_error", message: "phone is required" });
      return;
    }
    const client = (await db.select().from(clientsTable).where(eq(clientsTable.phone, phone)))[0];
    if (!client) {
      res.json({ client: null });
      return;
    }
    res.json({ client: { id: client.id, name: client.name, phone: client.phone, totalOrders: client.totalOrders } });
  } catch (err) {
    req.log.error({ err }, "Client lookup error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

/**
 * GET /api/calls
 * Returns recent call logs (last 50)
 */
router.get("/", async (req, res) => {
  try {
    const { phone } = req.query as Record<string, string>;
    let query = db.select().from(callLogsTable).$dynamic();
    if (phone) {
      query = query.where(like(callLogsTable.phone, `%${phone}%`));
    }
    const logs = await query.orderBy(desc(callLogsTable.createdAt)).limit(50);
    res.json({ logs, total: logs.length });
  } catch (err) {
    req.log.error({ err }, "Get call logs error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

/**
 * PATCH /api/calls/:id/mark-handled
 * Mark a call as handled by a dispatcher
 */
router.patch("/:id/mark-handled", async (req, res) => {
  try {
    const { handledBy, rideCreated } = req.body;
    const [log] = await db
      .update(callLogsTable)
      .set({ handledBy, rideCreated: !!rideCreated })
      .where(eq(callLogsTable.id, parseInt(req.params.id)))
      .returning();
    res.json(log);
  } catch (err) {
    req.log.error({ err }, "Mark call handled error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
