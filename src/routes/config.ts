import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/config", (_req, res) => {
    const wcProjectId = process.env.WALLETCONNECT_PROJECT_ID ?? "";
    res.json({ wcProjectId });
});

export default router;
