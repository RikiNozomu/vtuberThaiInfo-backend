import { Inject, Injectable } from '@nestjs/common';
import * as schema from '../../drizzle/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PGCONNECT } from 'src/constants';
import {
  SQL,
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
} from 'drizzle-orm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { VideoWithTalent } from 'src/type';
import * as _ from 'lodash';
import { getTalentImageUrl, getURLVideo, revalidate } from 'src/utils';
import generateCursor, { CursorConfig } from 'drizzle-cursor';
import { DateTime } from 'luxon';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class VideoService {
  constructor(
    @Inject(PGCONNECT) private db: NodePgDatabase<typeof schema>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectQueue('fetch') private fetchQueue: Queue,
  ) {}

  async getVideos({
    status,
    type,
    startDT,
    endDT,
  }: {
    status: ('FINISHED' | 'UPCOMING' | 'LIVE' | 'UNAVAILABLE')[];
    type?: ('UPLOADED' | 'LIVE' | 'SHORT')[];
    startDT?: Date;
    endDT?: Date;
  }) {
    const feeds = (await this.getLiveFeed())?.filter((item) => {
      if (!status.includes(item.status)) {
        return false;
      }
      if (type?.length && !type.find((x) => x == item.type)) {
        return false;
      }
      return true;
    });
    // Not specific Date, return Cache.
    if (!startDT && !endDT) {
      return feeds;
    }

    const results = await this.db.query.video.findMany({
      where: (video, { and, or, eq, gte, lte }) => {
        const where: SQL[] = [];
        const whereFeed: SQL[] = [];
        if (status) {
          where.push(inArray(video.status, status));
        }
        if (type?.length) {
          where.push(inArray(video.type, type));
        }
        if (startDT) {
          where.push(gte(video.datetime, DateTime.fromJSDate(startDT).toSQL()));
          whereFeed.push(
            gte(video.datetime, DateTime.fromJSDate(startDT).toSQL()),
          );
        }
        if (endDT) {
          where.push(lte(video.datetime, DateTime.fromJSDate(endDT).toSQL()));
          whereFeed.push(
            lte(video.datetime, DateTime.fromJSDate(endDT).toSQL()),
          );
        }
        if (feeds?.length) {
          return or(
            and(
              inArray(
                schema.video.streamId,
                feeds.map((item) => item.streamId),
              ),
              ...whereFeed,
            ),
            and(...where),
          );
        }
        return and(...where);
      },
      with: {
        channel: {
          with: {
            twitchTalent: {
              where(talent, { notInArray }) {
                return notInArray(talent.statusType, [
                  'INACTIVE_AS_VTUBER',
                  'DELIST',
                ]);
              },
              with: {
                twitchMain: { columns: { profileImgURL: true } },
                youtubeMain: { columns: { profileImgURL: true } },
              },
              columns: {
                id: true,
                name: true,
                profileImgType: true,
                profileImgURL: true,
                slug: true,
              },
            },
            youtubeTalent: {
              where(talent, { notInArray }) {
                return notInArray(talent.statusType, [
                  'INACTIVE_AS_VTUBER',
                  'DELIST',
                ]);
              },
              with: {
                twitchMain: { columns: { profileImgURL: true } },
                youtubeMain: { columns: { profileImgURL: true } },
              },
              columns: {
                id: true,
                name: true,
                profileImgType: true,
                profileImgURL: true,
                slug: true,
              },
            },
          },
          columns: {
            username: true,
          },
        },
      },
    });
    return results
      .map((item) => {
        return {
          ..._.omit(item, ['channel']),
          status:
            status ||
            feeds?.find((x) => x.streamId == item.streamId)?.status ||
            item.status,
          views:
            feeds?.find((x) => x.streamId == item.streamId)?.views ||
            item.views ||
            0,
          thumbnail:
            feeds?.find((x) => x.streamId == item.streamId)?.thumbnail ||
            item.thumbnail,
          talents: [
            ...(item.channel?.twitchTalent || []),
            ...(item.channel?.youtubeTalent || []),
          ].map((talent) => ({
            ..._.omit(talent, ['twitchMain', 'youtubeMain', 'profileImgType']),
            profileImgURL: getTalentImageUrl(talent),
          })),
          datetime: item.datetime || null,
          url: getURLVideo(item),
        };
      })
      .filter((item) => item.status != 'UNAVAILABLE')
      .filter((item) => (status ? item.status == status : true))
      .filter((item) => item.talents.length > 0)
      .filter((item) => (type?.length ? type.includes(item.type) : true));
  }

  async getVideosByTalent({
    slug,
    type,
    sort,
    token,
  }: {
    slug: string;
    type: 'UPLOADED' | 'LIVE' | 'SHORT';
    sort: 'old' | 'new' | 'views';
    token?: string;
  }) {
    const cacheKey = `videos-${slug}-${type}-${sort}${token ? '-' + token : ''}`;
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }
    const talent = await this.db.query.talent.findFirst({
      where: eq(schema.talent.slug, slug),
      columns: {
        profileImgType: true,
        profileImgURL: true,
      },
      with: {
        twitchMain: {
          columns: {
            id: true,
            channelId: true,
          },
        },
        youtubeMain: {
          columns: {
            id: true,
            channelId: true,
          },
        },
      },
    });
    if (!talent || (!talent.twitchMain && !talent.youtubeMain)) {
      await this.cacheManager.set(`fetching-videos-${slug}`, 1, 3600 * 1000);
      return {
        data: [],
        cursor: null,
      };
    }

    const feeds = await this.getLiveFeed();
    const whereChId: SQL[] = [];
    const where: SQL[] = [];
    // Prepair for cursor
    let cursorConfig: CursorConfig = {
      cursors: [],
      primaryCursor: null,
    };

    // fetching video from YT & Twitch
    await this.fetchVideoByTalent(slug);

    if (talent.youtubeMain) {
      whereChId.push(eq(schema.video.channelId, talent.youtubeMain.id));
    }
    if (talent.twitchMain) {
      whereChId.push(eq(schema.video.channelId, talent.twitchMain.id));
    }
    where.push(or(...whereChId));
    where.push(inArray(schema.video.status, ['FINISHED', 'LIVE', 'UPCOMING']));
    where.push(eq(schema.video.type, type));
    switch (sort) {
      case 'new':
        cursorConfig.primaryCursor = {
          order: 'DESC',
          key: 'datetime',
          schema: schema.video.datetime,
        };
        break;
      case 'old':
        cursorConfig.primaryCursor = {
          order: 'ASC',
          key: 'datetime',
          schema: schema.video.datetime,
        };
        break;
      default:
        cursorConfig.primaryCursor = {
          order: 'DESC',
          key: 'views',
          schema: schema.video.views,
        };
        break;
    }
    const cursor = generateCursor(cursorConfig);

    const videos = await this.db.query.video.findMany({
      where: and(cursor.where(token || null), ...where),
      orderBy: cursor.orderBy,
      limit: parseInt(process.env.VIDEO_PER_PAGE || '30'),
      with: {
        channel: {
          columns: {
            username: true,
          },
        },
      },
    });

    token =
      videos.length >= parseInt(process.env.VIDEO_PER_PAGE || '30')
        ? cursor.serialize(videos.at(-1))
        : null;
    const returnData = {
      data: videos.map((item) => ({
        ..._.omit(item, ['channel']),
        status:
          feeds?.find((x) => x.streamId == item.streamId)?.status ||
          item.status,
        views:
          feeds?.find((x) => x.streamId == item.streamId)?.views ||
          item.views ||
          0,
        title:
          feeds?.find((x) => x.streamId == item.streamId)?.title ||
          item.title ||
          '',
        thumbnail:
          feeds?.find((x) => x.streamId == item.streamId)?.thumbnail ||
          item.thumbnail ||
          '',
        durations:
          feeds?.find((x) => x.streamId == item.streamId)?.durations ||
          item.durations ||
          0,
        talents: [], // not need for talent list.
        url: getURLVideo(item),
      })),
      token: token || null,
    };
    await this.cacheManager.set(
      cacheKey,
      returnData,
      (token ? 3600 : 60) * 1000,
    );
    revalidate('talent-' + slug);
    return returnData;
  }

  async getVideoByStreamId(streamId: string) {
    const video = await this.db.query.video.findFirst({
      where: eq(schema.video.streamId, streamId),
      with: {
        channel: {
          with: {
            youtubeTalent: {
              with: {
                twitchMain: {
                  columns: {
                    profileImgURL: true,
                  },
                },
                youtubeMain: {
                  columns: {
                    profileImgURL: true,
                  },
                },
              },
            },
            twitchTalent: {
              with: {
                twitchMain: {
                  columns: {
                    profileImgURL: true,
                  },
                },
                youtubeMain: {
                  columns: {
                    profileImgURL: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    return video
      ? {
          id: video.id,
          videoId: video.videoId,
          streamId: video.streamId,
          title: video.title,
          thumbnail: video.thumbnail,
          durations: video.durations,
          datetime: video.datetime,
          platform: video.platform,
          type: video.type,
          status: video.status,
          views: video.views,
          url: getURLVideo(video),
          talents:
            (video.platform == 'YOUTUBE'
              ? video.channel?.youtubeTalent
              : video.channel?.twitchTalent
            )?.map((talent) => ({
              id: talent.id,
              name: talent.name,
              profileImgURL: getTalentImageUrl(talent),
              slug: talent.slug,
            })) || [],
          updatedAt: video.updatedAt,
        }
      : null;
  }

  async getLiveFeed(isForceFeed = false) {
    try {
      const oldVideos =
        await this.cacheManager.get<VideoWithTalent[]>('videos');
      if (oldVideos && !isForceFeed) {
        return oldVideos;
      }
      const startDT = DateTime.now()
        .minus({ day: 1 })
        .setZone('Asia/Bangkok')
        .toSQL();
      const endDT = DateTime.now()
        .plus({ day: 1 })
        .setZone('Asia/Bangkok')
        .toSQL();
      const rawVideos = await this.db.query.video.findMany({
        where: and(
          gte(schema.video.datetime, startDT),
          lte(schema.video.datetime, endDT),
          ne(schema.video.status, 'UNAVAILABLE'),
          isNotNull(schema.video.channelId),
        ),
        with: {
          channel: {
            with: {
              youtubeTalent: {
                with: {
                  twitchMain: {
                    columns: {
                      profileImgURL: true,
                    },
                  },
                  youtubeMain: {
                    columns: {
                      profileImgURL: true,
                    },
                  },
                },
              },
              twitchTalent: {
                with: {
                  twitchMain: {
                    columns: {
                      profileImgURL: true,
                    },
                  },
                  youtubeMain: {
                    columns: {
                      profileImgURL: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      const videos = rawVideos.map((video) => {
        const lastestVideo =
          oldVideos?.find(
            (ov) =>
              (ov.streamId == video.streamId && Boolean(video.streamId)) ||
              (ov.videoId == video.videoId && Boolean(video.videoId)),
          ) || null;
        return {
          id: video.id,
          videoId: lastestVideo?.videoId || video.videoId,
          streamId: lastestVideo?.streamId || video.streamId,
          title: lastestVideo?.title || video.title,
          thumbnail: lastestVideo?.thumbnail || video.thumbnail,
          durations: Math.max(
            lastestVideo?.durations || 0,
            video.durations || 0,
          ),
          datetime: video.datetime,
          platform: video.platform,
          type: video.type,
          status: lastestVideo?.status || video.status,
          views: lastestVideo?.views || video.views,
          url: getURLVideo(video),
          talents: (video.platform == 'YOUTUBE'
            ? video.channel.youtubeTalent
            : video.channel.twitchTalent
          ).map((talent) => ({
            id: talent.id,
            name: talent.name,
            profileImgURL: getTalentImageUrl(talent),
            slug: talent.slug,
          })),
          updatedAt: video.updatedAt,
        };
      });
      await this.cacheManager.set('videos', videos, 600000);
      return videos || [];
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  async fetchVideoByTalent(slug: string) {
    const talent = await this.db.query.talent.findFirst({
      where: eq(schema.talent.slug, slug),
      columns: {},
      with: {
        twitchMain: {
          columns: {
            channelId: true,
          },
        },
        youtubeMain: {
          columns: {
            channelId: true,
          },
        },
      },
    });

    const isAvaliable = await this.cacheManager.get(`fetching-videos-${slug}`);
    if (!isAvaliable) {
      if (talent?.twitchMain) {
        // TWitch
        const job =
          (await this.fetchQueue.getJob('tw-' + talent.twitchMain.channelId)) ||
          (await this.fetchQueue.add(
            { type: 'fetch-tw', channelRawId: talent.twitchMain.channelId },
            {
              jobId: 'tw-' + talent.twitchMain.channelId,
              lifo: false,
              removeOnComplete: {
                age: 3600,
              },
              removeOnFail: true,
            },
          ));
        const status = await job.getState();
        if (status == 'active' || status == 'waiting') {
          await job.finished();
        }
      }

      if (talent?.youtubeMain) {
        const job =
          (await this.fetchQueue.getJob('yt-' + talent.youtubeMain.channelId)) ||
          (await this.fetchQueue.add(
            { type: 'fetch-yt', channelRawId: talent.youtubeMain.channelId },
            {
              jobId: 'yt-' + talent.youtubeMain.channelId,
              lifo: false,
              removeOnComplete: {
                age: 3600 * 3,
              },
              removeOnFail: true,
            },
          ));
          
        const status = await job.getState();
        if (status == 'active' || status == 'waiting') {
          await job.finished();
        }
      }
    }
  }
}
