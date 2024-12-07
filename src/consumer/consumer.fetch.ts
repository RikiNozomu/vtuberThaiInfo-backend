import { Processor, Process } from '@nestjs/bull';
import { Inject, Injectable } from '@nestjs/common';
import { DoneCallback, Job } from 'bull';
import { DateTime } from 'luxon';
import { PGCONNECT } from 'src/constants';
import { TwitchService } from 'src/twitch/twitch.service';
import { YoutubeService } from 'src/youtube/youtube.service';
import * as schema from '../../drizzle/schema';
import { and, eq, inArray, ne, notInArray, or } from 'drizzle-orm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { VideoWithTalent } from 'src/type';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { VideoService } from 'src/video/video.service';

@Processor('fetch')
@Injectable()
export class FetchConsumer {
  constructor(
    private youtubeService: YoutubeService,
    private twitchService: TwitchService,
    private videoService: VideoService,
    @Inject(PGCONNECT) private db: NodePgDatabase<typeof schema>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Process({ concurrency: 1 })
  async transcode(
    job: Job<{
      type:
        | 'fetch-video'
        | 'feed'
        | 'yt-dt'
        | 'yt-upcoming'
        | 'fetch-yt'
        | 'fetch-tw';
      channelRawId?: string;
    }>,
    cb: DoneCallback,
  ) {
    try {
      switch (job.data.type) {
        case 'fetch-video':
          {
            await this.videoService.getLiveFeed(true);
          }
          break;
        case 'feed':
          {
            // Getting the update feed
            const ytData = this.youtubeService.isLoggedIn ? await this.youtubeService.getSubFeed() : [];
            const shortData = this.youtubeService.isLoggedIn ? await this.youtubeService.getSubShortFeed() : [];
            const twitchData = await this.twitchService.getLiveFeed();
            const feeds = [...ytData, ...shortData, ...twitchData];

            const videos = (await this.videoService.getLiveFeed()) || [];
            let newFeedVideos: VideoWithTalent[] = [];
            const MAXSLICE = 100;
            let slice = 0;

            while (slice < feeds.length) {
              const newItem = await Promise.all(
                feeds.slice(slice, slice + MAXSLICE).map(async (feed) => {
                  const tempVideo = videos.find(
                    (video) => video.streamId == feed.streamId,
                  );
                  const updatedAt = DateTime.now().toJSDate();
                  if (tempVideo) {
                    if (tempVideo.status != feed.status) {
                      await this.db
                        .update(schema.video)
                        .set({
                          status: feed.status,
                          title: feed.title,
                          thumbnail: feed.thumbnail,
                          views: feed.views,
                          durations: feed.durations,
                          updatedAt,
                          ...(feed.datetime ? { datetime: feed.datetime } : {}),
                        })
                        .where(eq(schema.video.id, tempVideo.id));
                    }
                    return {
                      ...tempVideo,
                      durations: feed.durations,
                      status: feed.status,
                      title: feed.title,
                      thumbnail: feed.thumbnail,
                      views: feed.views,
                      ...(feed.datetime ? { datetime: feed.datetime } : {}),
                      updatedAt,
                    };
                  } else {
                    const isCreated = await this.cacheManager.get<number>(
                      'created-' + feed.streamId,
                    );
                    if (!isCreated) {
                      // new video
                      if (!feed.channelRawId) {
                        const videoDetailData =
                          await this.youtubeService.getVideoDetail(
                            feed.videoId,
                          );
                        if (!videoDetailData) {
                          return null;
                        }
                        feed.channelRawId = videoDetailData.channelRawId;
                      }
                      // find channel & talent
                      const channelAndTalents = feed.channelRawId
                        ? await this.db.query.channel.findFirst({
                            where: eq(
                              schema.channel.channelId,
                              feed.channelRawId,
                            ),
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
                          })
                        : null;
                      await this.db
                        .insert(schema.video)
                        .values({
                          platform: feed.platform,
                          videoId: feed.videoId,
                          streamId: feed.streamId,
                          title: feed.title,
                          thumbnail: feed.thumbnail,
                          datetime: feed.datetime || null,
                          views: feed.views || 0,
                          durations: feed.durations || 0,
                          channelId: channelAndTalents?.id || null,
                          status: feed.status,
                          type: feed.type,
                        })
                        .onConflictDoUpdate({
                          target: schema.video.streamId,
                          set: {
                            videoId: feed.videoId,
                            title: feed.title,
                            thumbnail: feed.thumbnail,
                            views: feed.views,
                            durations: feed.durations,
                            status: feed.status,
                            updatedAt,
                            ...(feed.datetime
                              ? { datetime: feed.datetime }
                              : {}),
                          },
                        });
                      await this.cacheManager.set(
                        'created-' + feed.streamId,
                        1,
                        86400000,
                      );
                      if (feed.status == 'LIVE' && Boolean(feed.streamId)) {
                        return this.videoService.getVideoByStreamId(
                          feed.streamId,
                        );
                      }
                    }
                  }
                  return null;
                }),
              );
              newFeedVideos = [
                ...newFeedVideos,
                ...newItem.filter((s) => Boolean(s)),
              ];
              slice = slice + MAXSLICE;
            }

            //Twitch Remaining Videos
            const twitchVideos = videos.filter(
              (video) =>
                video.platform == 'TWITCH' &&
                !Boolean(feeds.find((item) => item.streamId == video.streamId)),
            );
            if (twitchVideos.length) {
              const updatedAt = DateTime.now().toJSDate();
              newFeedVideos = [
                ...newFeedVideos,
                ...twitchVideos.map((video) => {
                  video.status = 'FINISHED';
                  video.updatedAt = updatedAt;
                  return video;
                }),
              ];
              await this.db
                .update(schema.video)
                .set({
                  status: 'FINISHED',
                  updatedAt: updatedAt,
                })
                .where(
                  inArray(
                    schema.video.id,
                    twitchVideos.map((v) => v.id),
                  ),
                );
            }

            // YOUTUBE without updating more than 15 min.
            const ytVideos = videos.filter(
              (video) =>
                feeds.find((item) => item.streamId != video.streamId) &&
                video.platform == 'YOUTUBE' &&
                DateTime.fromJSDate(video.updatedAt).diffNow(['minutes'])
                  .minutes <= -15,
            );
            let page = 0;
            try {
              while (page * 50 < ytVideos.length) {
                const All50VideosID = ytVideos
                  .slice(page * 50, page * 50 + 50)
                  .map((x) => x.videoId);
                const videosAPI =
                  await this.youtubeService.getVideosDataByYoutubeAPIV3(
                    All50VideosID,
                  );
                const updatedVideos = await Promise.all(
                  videosAPI.data.items.map(async (v) => {
                    const { status, thumbnail, datetime, title, views } =
                      this.youtubeService.getDetailFromYoutubeAPIV3VideoObj(v);
                    const updatedAt = DateTime.now().toJSDate();
                    await this.db
                      .update(schema.video)
                      .set({
                        status,
                        title,
                        thumbnail,
                        datetime: DateTime.fromJSDate(datetime).toSQL(),
                        views,
                        updatedAt,
                      })
                      .where(eq(schema.video.videoId, v.id));
                    const objFeed = ytVideos.find(
                      (item) => v.id == item.videoId,
                    );
                    return {
                      ...objFeed,
                      status,
                      title,
                      thumbnail,
                      datetime: DateTime.fromJSDate(datetime).toSQL(),
                      views,
                      updatedAt,
                    };
                  }),
                );
                newFeedVideos = [...newFeedVideos, ...updatedVideos];
                const unavailableIds = All50VideosID.filter(
                  (v) =>
                    !Boolean(videosAPI.data.items.find((item) => item.id == v)),
                );
                if (Boolean(unavailableIds.length)) {
                  await this.db
                    .update(schema.video)
                    .set({
                      status: 'UNAVAILABLE',
                      updatedAt: DateTime.now().toJSDate(),
                    })
                    .where(inArray(schema.video.videoId, unavailableIds));
                }
                page = page + 1;
              }
            } catch (error) {
              console.error(error);
            }
            await this.cacheManager.set('videos', newFeedVideos, 9000000);
          }
          break;
        case 'yt-dt':
          {
            await this.youtubeService.setYoutubeVideoDatetime();
          }
          break;
        case 'yt-upcoming':
          {
            await this.youtubeService.setYoutubeUpcomingAndLiveDatetime();
          }
          break;
        case 'fetch-yt':
          {
            if (!job.data?.channelRawId) {
              break;
            }
            const channel = await this.db.query.channel.findFirst({
              where: eq(schema.channel.channelId, job.data.channelRawId),
              columns: { id: true, channelId: true, channelName: true },
              with: { youtubeTalent: { columns: { slug: true } } },
            });
            if (!channel) {
              break;
            }
            await this.db.transaction(async (tx) => {
              await tx
                .update(schema.video)
                .set({
                  status: 'UNAVAILABLE',
                  updatedAt: DateTime.now().toJSDate(),
                })
                .where(eq(schema.video.channelId, channel.id));
              const uploaded =
                await this.youtubeService.fetchVideosByChannelRawId(
                  job.data.channelRawId,
                  'video',
                );
              const lives = await this.youtubeService.fetchVideosByChannelRawId(
                job.data.channelRawId,
                'live',
              );
              const shorts =
                await this.youtubeService.fetchVideosByChannelRawId(
                  job.data.channelRawId,
                  'shorts',
                );

              const videos = [...uploaded, ...lives, ...shorts];

              let page = 0;
              while (page * 100 < videos.length) {
                await Promise.all(
                  videos.slice(page * 100, page * 100 + 100).map(async (x) => {
                    return await tx
                      .insert(schema.video)
                      .values({
                        platform: x.platform,
                        videoId: x.videoId,
                        streamId: x.streamId,
                        title: x.title,
                        thumbnail: x.thumbnail,
                        datetime: x.datetime,
                        views: x.views,
                        durations: x.durations || 0,
                        channelId: channel?.id,
                        status: x.status,
                        type: x.type,
                      })
                      .onConflictDoUpdate({
                        target: schema.video.videoId,
                        set: {
                          title: x.title,
                          thumbnail: x.thumbnail,
                          ...(x.durations ? { durations: x.durations } : {}),
                          ...(x.datetime ? { datetime: x.datetime } : {}),
                          views: x.views,
                          status: x.status,
                          updatedAt: DateTime.now().toJSDate(),
                        },
                      })
                      .returning();
                  }),
                );
                page = page + 1;
              }
              console.log(
                `YOUTUBE : (${channel?.channelId}) ${channel?.channelName} = ${videos.length} video(s).`,
                {
                  uploaded: uploaded.length,
                  lives: lives.length,
                  shorts: shorts.length,
                },
              );
            });
          }
          break;
        case 'fetch-tw':
          {
            if (!job.data?.channelRawId) {
              break;
            }
            const channel = await this.db.query.channel.findFirst({
              where: eq(schema.channel.channelId, job.data.channelRawId),
              columns: { id: true, channelId: true, channelName: true },
              with: { twitchTalent: { columns: { slug: true } } },
            });
            if (!channel) {
              break;
            }
            await this.db.transaction(async (tx) => {
              await tx
                .update(schema.video)
                .set({
                  status: 'UNAVAILABLE',
                  updatedAt: DateTime.now().toJSDate(),
                })
                .where(
                  and(
                    eq(schema.video.channelId, channel.id),
                    ne(schema.video.status, 'LIVE'),
                  ),
                )
                .returning();
              const videos = await this.twitchService.fetchVideosByChannelRawId(
                job.data.channelRawId,
              );

              let page = 0;
              while (page * 100 < videos.length) {
                await Promise.all(
                  videos.slice(page * 100, page * 100 + 100).map(async (x) => {
                    const createObj = {
                      platform: x.platform,
                      videoId: x.videoId,
                      streamId: x.streamId,
                      title: x.title,
                      thumbnail: x.thumbnail,
                      datetime: x.datetime,
                      views: x.views,
                      durations: x.durations,
                      channelId: channel?.id,
                      status: x.status,
                      type: x.type,
                    };
                    const updateObj = {
                      title: x.title,
                      thumbnail: x.thumbnail,
                      videoId: x.videoId,
                      streamId: x.streamId,
                      ...(x.datetime ? { datetime: x.datetime } : {}),
                      views: x.views,
                      durations: x.durations,
                      channelId: channel?.id,
                      status: x.status,
                      updatedAt: DateTime.now().toJSDate(),
                    };
                    try {
                      const existVideo = await tx.query.video.findFirst({
                        where: or(
                          eq(schema.video.videoId, x.videoId || 'null'),
                          eq(schema.video.streamId, x.streamId || 'null'),
                        ),
                      });
                      if (existVideo) {
                        await tx
                          .update(schema.video)
                          .set(updateObj)
                          .where(eq(schema.video.id, existVideo.id));
                      } else {
                        await tx.insert(schema.video).values(createObj);
                      }
                      return;
                    } catch (error) {
                      console.error(error);
                    }
                    return;
                  }),
                );
                page = page + 1;
              }
              console.log(
                `TWITCH : (${channel?.channelId}) ${channel?.channelName} = ${videos.length} video(s).`,
              );
            });
          }
          break;
        default:
          break;
      }
      cb(null, { timestamp: DateTime.now().toISO(), ...job.data });
    } catch (error) {
      console.error(error);
      cb(error, { timestamp: DateTime.now().toISO(), ...job.data });
    }
  }
}
