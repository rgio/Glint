import { buildApp } from './app';

const port = Number(process.env.PORT ?? 4000);
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim());

const app = buildApp({ logger: true, corsOrigins });

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
