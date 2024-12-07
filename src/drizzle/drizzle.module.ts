import { Inject, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as schema from '../../drizzle/schema';
import { PGCONNECT } from 'src/constants';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

@Module({
  providers: [
    {
      provide: 'DATABASE_CLIENT',
      useFactory: () => ({ client: null }),
    },
    {
      provide: PGCONNECT,
      inject: [ConfigService, 'DATABASE_CLIENT'],
      useFactory: async (
        configService: ConfigService,
        dbClient: { pool: Pool },
      ) => {
        const pool = new Pool({
          connectionString: configService.get<string>('DATABASE_URL'),
        });
        dbClient.pool = pool;
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [PGCONNECT],
})
export class DrizzleModule {
  constructor(@Inject('DATABASE_CLIENT') private dbClient: { pool: Pool }) {}

  async onModuleDestroy() {
    await this.dbClient.pool.end();
  }
}
