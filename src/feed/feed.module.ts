import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { VideoModule } from 'src/video/video.module';

@Module({
  imports:[VideoModule],
  controllers: [FeedController],
})
export class FeedModule {}
