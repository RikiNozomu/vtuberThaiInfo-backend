import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { YoutubeService } from './youtube.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DateTime } from 'luxon';

@Controller('youtube')
export class YoutubeController {
  constructor(
    @InjectQueue('fetch') private fetchQueue: Queue,
    private youtubeService: YoutubeService,
  ) {}

  @Get('signin')
  async signIn(@Res() res: Response, @Query('code') code?: string) {
    const result = await this.youtubeService.signIn(code || '');
    if(result.isLogged){
      return res.json(result);
    }
    return res.redirect(this.youtubeService.getRedirectURL())
  }

  @Get('signout')
  async singOut() {
    return await this.youtubeService.signOut();
  }

  @Get('sub/:channelId')
  async sub(@Param('channelId') channelId: string) {
    if(this.youtubeService.isLoggedIn()){
      return await this.youtubeService.subChannel(channelId);
    }
    return { message: `Please Login before use subscription features.`};
  }

  @Get('unsub/:channelId')
  async unsub(@Param('channelId') channelId: string) {
    if(this.youtubeService.isLoggedIn()){
      return await this.youtubeService.unSubChannel(channelId);
    }
    return { message: `Please Login before use subscription features.`};
  }
}
