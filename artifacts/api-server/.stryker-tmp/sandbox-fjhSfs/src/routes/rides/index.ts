// @ts-nocheck
import { Router, type IRouter } from "express";
import create from "./create.js";
import manage from "./manage.js";
import query from "./query.js";

// Composer for the former rides.ts god-file. query (with GET /:id) is mounted
// last so single-segment static GETs keep precedence; paths are unchanged.
const router: IRouter = Router();
router.use(create);
router.use(manage);
router.use(query);

export default router;
export { CITIES } from "./shared.js";
