import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

export default router;
