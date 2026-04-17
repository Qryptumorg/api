FROM node:22-alpine
WORKDIR /app

RUN npm install -g pnpm@10

COPY pnpm-workspace.yaml package.json ./
COPY packages/ packages/
COPY src/ src/
COPY build.mjs tsconfig.json ./
COPY verify-inputs/ verify-inputs/

RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
