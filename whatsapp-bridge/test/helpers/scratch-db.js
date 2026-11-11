// Creates a throw-away PostgreSQL database for a test file and drops it afterwards.
// The application database named in DATABASE_URL is never touched: only its
// server and credentials are reused to create a separate "zigmaa_wa_test_*" database.
import crypto from 'node:crypto';
import pg from 'pg';
import { loadEnvFiles, parseDatabaseUrl, resolveSsl } from '../../src/config.js';
import { createPool, Db } from '../../src/db.js';

export async function createScratchDb() {
  const env = { ...process.env };
  loadEnvFiles(env);
  const base = parseDatabaseUrl(env.WA_TEST_DATABASE_URL || env.DATABASE_URL, env);
  if (!base) return null;

  const ssl = resolveSsl(base, env);
  const name = `zigmaa_wa_test_${crypto.randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({
    host: base.host,
    port: base.port,
    user: base.user,
    password: base.password,
    database: 'postgres',
    ssl: ssl ? { rejectUnauthorized: ssl === 'verify' } : false
  });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
  } catch (err) {
    await admin.end().catch(() => {});
    console.warn(`[scratch-db] cannot create a test database (${err.message}); database tests are skipped`);
    return null;
  }
  await admin.end();

  const config = { host: base.host, port: base.port, user: base.user, password: base.password, database: name, ssl, poolMax: 6 };
  const db = new Db(createPool(config));

  return {
    name,
    config,
    db,
    async destroy() {
      await db.close().catch(() => {});
      const dropper = new pg.Client({
        host: base.host,
        port: base.port,
        user: base.user,
        password: base.password,
        database: 'postgres',
        ssl: ssl ? { rejectUnauthorized: ssl === 'verify' } : false
      });
      await dropper.connect();
      await dropper.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await dropper.end();
    }
  };
}
