/**
 * Ordering-equivalence proof for the Redis-replicated driver queue (LAYER 2 sub-step 2).
 * Runs an identical mutation sequence and checks the resulting queue order + round-robin
 * skip counts. Run twice:
 *   node dist/queue-order-test.mjs                  → single-process (direct array ops)
 *   WS_PUBSUB=1 WS_CHANNEL_PREFIX=qtest node …      → clustered (publish → subscriber applies)
 * Both must yield the SAME order/skips, proving the pub/sub path preserves fairness exactly.
 */
import { enqueueDriver, moveToEnd, returnToQueue, removeFromQueue, markAssigned, getFullQueue } from "../../src/lib/driver-queue.js";

const IDS = [900001, 900002, 900003, 900004, 900005];
const clustered = process.env.WS_PUBSUB === "1";
const settle = () => new Promise((r) => setTimeout(r, clustered ? 600 : 0));

(async () => {
  for (const id of IDS) enqueueDriver(id);           // [1,2,3,4,5]
  await settle();
  moveToEnd(900002);                                  // [1,3,4,5,2]  2.skip=1
  await settle();
  removeFromQueue(900003);                            // [1,4,5,2]
  await settle();
  returnToQueue(900001);                              // [4,5,2,1]    1 fresh skip=0
  await settle();
  markAssigned(900004, 100);                          // [5,2,1]
  await settle();
  await settle();

  const q = getFullQueue().filter((e) => IDS.includes(e.driverId));
  const order = q.map((e) => e.driverId);
  const skips = Object.fromEntries(q.map((e) => [e.driverId, e.skippedCount]));
  const expectedOrder = [900005, 900002, 900001];
  const orderOk = JSON.stringify(order) === JSON.stringify(expectedOrder);
  const skipsOk = skips[900002] === 1 && skips[900005] === 0 && skips[900001] === 0;

  console.log(`\n[queue-order] mode = ${clustered ? "CLUSTERED (pub/sub)" : "SINGLE-PROCESS (direct)"}`);
  console.log(`  order: [${order.join(",")}]   expected [${expectedOrder.join(",")}]   ${orderOk ? "✓" : "✗"}`);
  console.log(`  skips: ${JSON.stringify(skips)}   expected {900002:1, rest:0}   ${skipsOk ? "✓" : "✗"}`);
  console.log(`  RESULT: ${orderOk && skipsOk ? "✓ PASS" : "✗ FAIL"}\n`);
  process.exit(orderOk && skipsOk ? 0 : 1);
})();
