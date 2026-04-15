import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { logger } from "./logger";

const rooms = new Map<string, Set<WebSocket>>();

export function setupSyncWS(server: Server) {
  const wss = new WebSocketServer({ server, path: "/sync" });

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const address = url.searchParams.get("address")?.toLowerCase();

    if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
      ws.close(4000, "Invalid address");
      return;
    }

    if (!rooms.has(address)) rooms.set(address, new Set());
    const room = rooms.get(address)!;
    room.add(ws);
    logger.info({ address, peers: room.size }, "WS sync client joined");

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 20_000);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg?.type) return;
        for (const peer of room) {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify(msg));
          }
        }
      } catch {}
    });

    ws.on("close", () => {
      clearInterval(ping);
      room.delete(ws);
      if (room.size === 0) rooms.delete(address);
      logger.info({ address }, "WS sync client left");
    });

    ws.on("error", () => ws.terminate());
  });

  logger.info("WebSocket sync server ready at /sync");
}
