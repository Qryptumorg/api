import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vaultsRouter from "./vaults";
import transactionsRouter from "./transactions";
import chatRouter from "./chat";
import portfolioRouter from "./portfolio";
import shieldRouter from "./shield";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vaultsRouter);
router.use(transactionsRouter);
router.use(chatRouter);
router.use(portfolioRouter);
router.use(shieldRouter);

export default router;
