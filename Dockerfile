# One image for the server side: the API, the feed and content workers, and database migrations.
#   docker build -t podcast-server .
#   docker run podcast-server api       # default; listens on $PORT (4000)
#   docker run podcast-server worker    # polls feeds
#   docker run podcast-server content   # transcripts, excerpts, embeddings, recommendations
#   docker run podcast-server migrate   # e.g. as a release step, with MIGRATE_ON_START=false
# Settings come from the environment; see apps/api/.env.example and docs/deploy.md.

FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY . .
# Production dependencies of the API and workers and the packages they use; not the app.
RUN pnpm install --frozen-lockfile --prod --filter "@podcast/api..." --filter "@podcast/feed-worker..." --filter "@podcast/content-worker..."

FROM node:24-slim
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/feed-worker ./apps/feed-worker
COPY --from=build --chown=node:node /app/apps/content-worker ./apps/content-worker
COPY --chown=node:node deploy/entrypoint.sh /usr/local/bin/entrypoint
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["entrypoint"]
CMD ["api"]
