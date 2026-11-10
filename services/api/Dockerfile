# The api: Node 24 runs the .ts sources directly, so the image is the workspace's api + game packages and their deps.
# Build from the repo root: docker build -f services/api/Dockerfile .
FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/game/package.json packages/game/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --prod --filter @nyxeron/api...
COPY packages/game packages/game
COPY services/api services/api
ENV NODE_ENV=production DATA_DIR=/data PORT=8788
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8788/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "services/api/src/main.ts"]
