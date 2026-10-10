/**
 * Liveness and readiness for load balancers, uptime monitors and release smoke checks.
 *
 * The check round-trips to the database, because a process that is running but
 * cannot reach MySQL serves errors to every customer — a check that only proves
 * the process is alive would report that as healthy.
 *
 * Returns 200 when the database answers and 503 when it does not, so a load
 * balancer takes the instance out of rotation on its own. The body says nothing
 * about versions, hosts or configuration: this route is public.
 */
import express from 'express';
import { prisma } from '../../config/config.js';

const router = express.Router();

// Fail fast: a health check that hangs is worse than one that says "down"
const DB_TIMEOUT_MS = 3000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))
  ]);

router.get('/', async (req, res) => {
  const startedAt = Date.now();

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'ok',
      data: {
        database: 'up',
        databaseLatencyMs: Date.now() - startedAt,
        uptimeSeconds: Math.round(process.uptime())
      }
    });
  } catch {
    // The reason stays in the logs; the public body does not describe the failure
    return res.status(503).json({
      success: false,
      status: 503,
      message: 'Service unavailable',
      data: { database: 'down' }
    });
  }
});

export default router;
