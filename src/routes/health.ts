import { Router, type IRouter } from "express";
import { HealthCheckResponse, HealthCheckFullResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const data = HealthCheckFullResponse.parse({ status: "ok", db: "connected" });
    res.json(data);
  } catch {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

export default router;
