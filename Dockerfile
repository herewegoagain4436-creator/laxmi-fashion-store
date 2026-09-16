# Laxmi Fashion — cloud sync server (Express + SQLite + built web UI)
FROM node:20-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/

RUN npm ci

COPY apps/web apps/web
COPY apps/server apps/server
COPY scripts scripts
COPY capacitor.config.json ./

RUN npm run build -w @laxmi/web && npm run build -w @laxmi/server

# Prune to production deps for server runtime (+ keep web dist)
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV LAXMI_DATA_DIR=/data
ENV LAXMI_WEB_DIST=/app/apps/web/dist
# Set at deploy time — never bake real tokens into the image
# ENV LAXMI_SYNC_TOKEN=
# ENV LAXMI_SECRET=

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
