import { Controller, Get } from '@nestjs/common';
import { VideoService } from 'src/video/video.service';

@Controller('feed')
export class FeedController {
  constructor(private videoService: VideoService) {}

  @Get('')
  async getFeed() {
    return { data: this.videoService.getLiveFeed() || [] }
  }
}
