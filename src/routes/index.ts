import { Router } from "express";
import healthRouter from "./health";
import vaultsRouter from "./vaults";
import transactionsRouter from "./transactions";

const router = Router();

router.use(healthRouter);
router.use(vaultsRouter);
router.use(transactionsRouter);

export default router;
