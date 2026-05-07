# syntax=docker/dockerfile:1.7
#
# Multi-stage build for Railway. Replaces Railpack's "two full npm installs
# back-to-back" path that was taking ~50 min per deploy. With BuildKit cache
# mounts on /root/.npm, the npm tarball cache survives between deploys, so
# source-only changes typically build in ~3-5 min after the initial cold
# cache is populated.
#
# Why bookworm-slim and not alpine: @swc/core, sharp, and a few other Medusa
# native deps are flakey on musl. Bookworm-slim is glibc-based and only ~80MB
# larger than alpine.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=npm,target=/root/.npm npm ci

FROM deps AS build
COPY . .
# `npm run build` runs `medusa build && cd .medusa/server && npm install --omit=dev`,
# producing a self-contained .medusa/server/ with its own prod-only node_modules.
RUN --mount=type=cache,id=npm,target=/root/.npm npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/.medusa/server
ENV NODE_ENV=production
COPY --from=build /app/.medusa/server /app/.medusa/server
EXPOSE 9000
# Apply pending migrations on every boot, then start the server.
# This matches the previous `npm start` behavior and is required for the
# multi-stage deploy flow (the worktree image doesn't run npm scripts).
CMD ["sh", "-c", "npx medusa db:migrate && npx medusa start"]
