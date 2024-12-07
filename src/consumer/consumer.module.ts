import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { FetchConsumer } from './consumer.fetch';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { YoutubeModule } from 'src/youtube/youtube.module';
import { TwitchModule } from 'src/twitch/twitch.module';
import { VideoModule } from 'src/video/video.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'fetch' }),
    DrizzleModule,
    YoutubeModule,
    TwitchModule,
    VideoModule
  ],
  providers: [FetchConsumer],
})
export class ConsumerModule {}
