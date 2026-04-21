import express, { type Express } from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// CORS first - before pinoHttp and all other middleware.
// cors() with preflightContinue:false (default) handles OPTIONS automatically.
// Note: Express 5 / path-to-regexp@8 rejects bare "*" routes - do NOT use
// app.options("*", ...) as it crashes on startup with PathError.
const corsOptions: CorsOptions = {
  origin: "*",
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  preflightContinue: false,
  maxAge: 86400,
};
app.use(cors(corsOptions));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
