import { Module, forwardRef } from '@nestjs/common';
import { TwitchService } from './twitch.service';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { BullModule } from '@nestjs/bull';
import { TaskModule } from 'src/task/task.module';
import { VideoModule } from 'src/video/video.module';

@Module({
  imports: [
    DrizzleModule,
    BullModule.registerQueue({ name: 'fetch' }),
    VideoModule,
  ],
  providers: [TwitchService],
  exports: [TwitchService],
})
export class TwitchModule {}
