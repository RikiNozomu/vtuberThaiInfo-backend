import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from './drizzle/drizzle.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { YoutubeModule } from './youtube/youtube.module';
import { CacheModule } from '@nestjs/cache-manager';
import { ConsumerModule } from './consumer/consumer.module';
import { BullModule } from '@nestjs/bull';
import { TaskModule } from './task/task.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TwitchModule } from './twitch/twitch.module';
import { FeedModule } from './feed/feed.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true }),
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule,
    YoutubeModule,
    ConsumerModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        return {
          redis: {
            username: config.get('REDIS_USERNAME'),
            password: config.get('REDIS_PASSWORD'),
            host: config.get('REDIS_HOST'),
            port: parseInt(config.get('REDIS_PORT')),
            db: parseInt(config.get('REDIS_DB')),
            sentinelMaxConnections: 1,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
          settings: {
            stalledInterval: 60000,
            maxStalledCount: 5,
          },
        };
      },
      inject: [ConfigService],
    }),
    TaskModule,
    TwitchModule,
    FeedModule,
    VideoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
