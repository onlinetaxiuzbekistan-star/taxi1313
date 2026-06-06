import { Router, type IRouter } from "express";
import profile from "./profile.js";
import location from "./location.js";
import earnings from "./earnings.js";
import documents from "./documents.js";
import fleet from "./fleet.js";
import dispatch from "./dispatch.js";
import trips from "./trips.js";

// Composer for the former drivers.ts god-file. Sub-routers are mounted without a
// path prefix so the combined route paths are identical to the original.
const router: IRouter = Router();
router.use(profile);
router.use(location);
router.use(earnings);
router.use(documents);
router.use(fleet);
router.use(dispatch);
router.use(trips);

export default router;
