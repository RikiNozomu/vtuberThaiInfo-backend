import { Module } from '@nestjs/common';
import { TaskService } from './task.service';
import { BullModule } from '@nestjs/bull';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { TwitchModule } from 'src/twitch/twitch.module';
import { YoutubeModule } from 'src/youtube/youtube.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'fetch' }),
    DrizzleModule,
    YoutubeModule,
    TwitchModule,
  ],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
