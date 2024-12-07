import { InjectQueue } from '@nestjs/bull';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bull';
import { PGCONNECT } from 'src/constants';
import * as schema from '../../drizzle/schema';
import { asc, eq, and, gt } from 'drizzle-orm';
import { TwitchService } from 'src/twitch/twitch.service';
import { YoutubeService } from 'src/youtube/youtube.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { revalidate } from 'src/utils';
import { DateTime } from 'luxon';
import * as _ from 'lodash';

@Injectable()
export class TaskService implements OnModuleInit {
  constructor(
    @InjectQueue('fetch') private fetchQueue: Queue,
    private twitchService: TwitchService,
    private youtubeService: YoutubeService,
    @Inject(PGCONNECT) private db: NodePgDatabase<typeof schema>,
  ) {}

  async onModuleInit() {
    
  }

  @Cron('0 * * * * *', {
    disabled: process.env.TASK_ENABLE != '1',
    timeZone: 'Asia/Bangkok',
  }) 
  async feedCron() {
    this.fetchQueue.add(
      { type: 'feed' },
      {
        jobId: 'feed',
        lifo: true,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  @Cron('*/5 * * * * *', {
    disabled: process.env.TASK_ENABLE != '1',
    timeZone: 'Asia/Bangkok',
  })
  async fetchVideo() {
    return this.fetchQueue.add(
      { type: 'fetch-video' },
      {
        jobId: 'fetch-video',
        lifo: true,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  @Cron('*/10 * * * * *', {
    disabled: process.env.TASK_ENABLE != '1',
    timeZone: 'Asia/Bangkok',
  })
  youtubeDTCron() {
    this.fetchQueue.add(
      { type: 'yt-dt' },
      {
        jobId: 'yt-dt',
        lifo: true,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  @Cron('0 0 * * * *', {
    disabled: process.env.TASK_ENABLE != '1',
    timeZone: 'Asia/Bangkok',
  })
  youtubeUpcomingCron() {
    this.fetchQueue.add(
      { type: 'yt-upcoming' },
      {
        jobId: 'yt-upcoming',
        lifo: true,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  @Cron('0 0 * * * *', {
    disabled: process.env.TASK_ENABLE != '1',
    timeZone: 'Asia/Bangkok',
  })
  async fetchTwitchCron() {
    const allTwitchChannels = (
      await this.db.query.channel.findMany({
        where: eq(schema.channel.platform, 'TWITCH'),
        with: {
          twitchTalent: {
            columns: {
              slug: true,
            },
          },
        },
        columns: {
          channelId: true,
        },
      })
    ).filter((value) => value.twitchTalent.length > 0);
    console.log('START TWITCH FETCHING');
    const channelDatas = await this.twitchService.getChannelInfos(
      allTwitchChannels.map((x) => x.channelId),
    );

    let page = 0;
    while (page * 100 < channelDatas.length) {
      await Promise.all(
        channelDatas.slice(page * 100, page * 100 + 100).map(async (ch) => {
          await this.db
            .update(schema.channel)
            .set({
              channelName: ch.displayName,
              username: ch.name,
              subs: ch.followers,
              profileImgURL: ch.profilePictureUrl,
            })
            .where(eq(schema.channel.channelId, ch.id));
          const talents = allTwitchChannels.find(
            (item) => item.channelId == ch.id,
          ).twitchTalent;
          for (const talent of talents) {
            revalidate('talent-' + talent.slug);
          }
          return ch;
        }),
      );
      page = page + 1;
    }
    /*for (const ch of channelDatas) {
      this.fetchQueue.add(
        { type: 'fetch-tw', channelRawId: ch.id },
        {
          jobId: 'tw-' + ch.id,
          lifo: false,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }*/
    revalidate('talent');
    console.log('UPDATED TWITCH INFO.');
  }

  private async fetchYoutubeCron() {
    const allYoutubeChannels = (
      await this.db.query.channel.findMany({
        where: eq(schema.channel.platform, 'YOUTUBE'),
        with: {
          youtubeTalent: {
            columns: {
              slug: true,
            },
          },
        },
        orderBy: [asc(schema.channel.id)],
        columns: {
          channelId: true,
        },
      })
    ).filter((value) => value.youtubeTalent.length > 0);
    console.log('START YOUTUBE FETCHING');
    const channelDatas = await this.youtubeService.getChannelInfos(
      allYoutubeChannels.map((x) => x.channelId),
    );

    let page = 0;
    while (page * 100 < channelDatas.length) {
      await Promise.all(
        channelDatas.slice(page * 100, page * 100 + 100).map(async (ch) => {
          let size = 0;
          let thumbnail: string = null;
          for (const [key, value] of Object.entries(ch.snippet.thumbnails)) {
            if (size < value.height) {
              thumbnail = value.url;
            }
          }
          await this.db
            .update(schema.channel)
            .set({
              channelName: ch.snippet.title,
              username: ch.snippet.customUrl,
              subs: ch.statistics.hiddenSubscriberCount
                ? 0
                : parseInt(ch.statistics.subscriberCount),
              views: parseInt(ch.statistics.viewCount),
              profileImgURL: thumbnail,
            })
            .where(eq(schema.channel.channelId, ch.id));

          const talents = allYoutubeChannels.find(
            (item) => item.channelId == ch.id,
          ).youtubeTalent;
          for (const talent of talents) {
            revalidate('talent-' + talent.slug);
          }
          return ch;
        }),
      );
      page = page + 1;
    }
    revalidate('talent');
    console.log('UPDATED YOUTUBE INFO.');
    /*for (const ch of channelDatas) {
      this.fetchQueue.add(
        { type: 'fetch-yt', channelRawId: ch.id },
        {
          jobId: 'yt-' + ch.id,
          lifo: false,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }*/
  }

  @Cron('0 1 0 * * *', {
    disabled: process.env.TASK_ENABLE != '1',
    timeZone: 'Asia/Bangkok',
  })
  async daliyCron() {
    // set to retired talents
    const infos = await this.db.query.timeline.findMany({
      where: and(
        gt(schema.timeline.year, 0),
        gt(schema.timeline.month, 0),
        gt(schema.timeline.day, 0),
        eq(schema.timeline.type, 'RETIRED'),
      ),
      with: {
        talent: {
          columns: {
            slug: true,
          },
        },
      },
    });

    const pastTalented = infos.filter(
      (item) =>
        DateTime.fromObject(
          { day: item.day, month: item.month, year: item.year },
          { zone: 'Asia/Bangkok' },
        )
          .endOf('day')
          .diffNow(['seconds']).seconds <= 0,
    );
    for (const item of pastTalented) {
      await this.db
        .update(schema.talent)
        .set({
          statusType: 'RETIRED',
        })
        .where(eq(schema.talent.id, item.talentId));
      revalidate('talent-' + item.talent.slug);
    }

    // fetch youtube data
    this.fetchYoutubeCron();
  }
}
