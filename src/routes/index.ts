import { Router } from "express";
import healthRouter from "./health.js";
import vaultsRouter from "./vaults.js";
import transactionsRouter from "./transactions.js";

const router = Router();

router.use(healthRouter);
router.use(vaultsRouter);
router.use(transactionsRouter);

export default router;
