#!/bin/sh
# Runs one server process in the foreground (exec, so it receives SIGTERM directly).
set -e
case "${1:-api}" in
  api) cd /app/apps/api && exec node --import tsx src/server.ts ;;
  worker) cd /app/apps/feed-worker && exec node --import tsx src/main.ts ;;
  content) cd /app/apps/content-worker && exec node --import tsx src/main.ts ;;
  migrate) cd /app/apps/api && exec node --import tsx src/migrate.ts ;;
  *) exec "$@" ;;
esac
