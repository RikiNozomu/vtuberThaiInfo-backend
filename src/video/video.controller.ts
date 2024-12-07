import { Controller, Get, Param, Res } from '@nestjs/common';
import { VideoService } from './video.service';
import { DateTime } from 'luxon';
import { Response } from 'express';

@Controller('video')
export class VideoController {
  constructor(private videoService: VideoService) {}

  @Get('/fetch/:slug')
  async fetchVideosBtTalent(
    @Res() res: Response,
    @Param('slug') slug: string,
  ) {
    this.videoService.fetchVideoByTalent(slug)
    return res.json({ data: `${slug} already been fetched.` });
  }

  @Get('/talent/:slug/:type/:sort/:token?')
  async getTalentVideos(
    @Res() res: Response,
    @Param('slug') slug: string,
    @Param('type') type: 'UPLOADED' | 'LIVE' | 'SHORT',
    @Param('sort') sort: 'old' | 'new' | 'views',
    @Param('token') token?: string,
  ) {
    const data = await this.videoService.getVideosByTalent({
      slug,
      type,
      sort,
      ...(token ? { token } : {}),
    });
    return res
      .header({ 'Cache-Control': 'public, max-age=60, s-maxage=60' })
      .json(data);
  }

  @Get('/:type/:date?')
  async getVideos(
    @Res() res: Response,
    @Param('type') type: string,
    @Param('date') date?: string,
  ) {
    const startDT = date
      ? DateTime.fromISO(date, { zone: 'Asia/Bangkok' })
          .setZone('Asia/Bangkok')
          .startOf('day')
          .toJSDate()
      : DateTime.now().minus({ day: 1 }).setZone('Asia/Bangkok').toJSDate();
    const endDT = date
      ? DateTime.fromISO(date, { zone: 'Asia/Bangkok' })
          .plus({ day: 1 })
          .setZone('Asia/Bangkok')
          .toJSDate()
      : DateTime.now().plus({ day: 1 }).setZone('Asia/Bangkok').toJSDate();

    switch (type) {
      case 'SHORT': {
        const data = await this.videoService.getVideos({
          type: ['SHORT'],
          status: ['FINISHED'],
          startDT: Boolean(date) ? startDT : null,
          endDT: Boolean(date) ? endDT : null,
        });
        return res.header({ 'Cache-Control': 'max-age=60' }).json({
          data: data.sort(
            (a, b) =>
              DateTime.fromSQL(b.datetime).toMillis() -
              DateTime.fromSQL(a.datetime).toMillis(),
          ),
        });
      }
      case 'FINISHED': {
        const data = await this.videoService.getVideos({
          status: ['FINISHED'],
          type: ['LIVE', 'UPLOADED'],
          startDT: Boolean(date) ? startDT : null,
          endDT: Boolean(date) ? endDT : null,
        });
        return res.header({ 'Cache-Control': 'max-age=60' }).json({
          data: data.sort((a, b) => b.views - a.views),
        });
      }
      case 'UPCOMING': {
        const data = await this.videoService.getVideos({
          status: ['UPCOMING'],
          startDT: Boolean(date) ? startDT : null,
          endDT: Boolean(date) ? endDT : null,
        });
        return res.header({ 'Cache-Control': 'max-age=60' }).json({
          data: data.sort(
            (a, b) =>
              DateTime.fromSQL(a.datetime).toMillis() -
              DateTime.fromSQL(b.datetime).toMillis(),
          ),
        });
      }
      case 'LIVE':
      default: {
        const data = await this.videoService.getVideos({ status: ['LIVE'] });
        return res
          .header({ 'Cache-Control': 'max-age=60' })
          .json({ data: data.sort((a, b) => b.views - a.views) });
      }
    }
  }
}
