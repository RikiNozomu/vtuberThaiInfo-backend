import * as dotenv from 'dotenv';
import type { Config } from 'drizzle-kit';

dotenv.config();

export default {
  driver: 'pg',
  schema: './drizzle/schema.ts',
  out: './drizzle/migration',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL,
  },
} satisfies Config;
