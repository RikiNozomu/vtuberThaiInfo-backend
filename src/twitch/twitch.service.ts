import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { AppTokenAuthProvider } from '@twurple/auth';
import { ApiClient, HelixStream } from '@twurple/api';
import { PGCONNECT } from 'src/constants';
import * as schema from '../../drizzle/schema';
import { HelixUserWithFollowers, VideoWithChannelRawId } from 'src/type';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DateTime } from 'luxon';
import { VideoService } from 'src/video/video.service';

@Injectable()
export class TwitchService {
  private authProvider: AppTokenAuthProvider;
  private apiClient: ApiClient;

  constructor(
    @Inject(PGCONNECT) private db: NodePgDatabase<typeof schema>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private videoService: VideoService,
  ) {
    this.getAuthProvider().then((provider) => {
      this.authProvider = provider;
      this.apiClient = new ApiClient({ authProvider: this.authProvider });
    });
  }

  private async getAuthProvider() {
    try {
      const clientId = process.env.TWITCH_CLIENT_ID;
      const clientSecret = process.env.TWITCH_CLIENT_SECRET;
      return new AppTokenAuthProvider(clientId, clientSecret);
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(error);
    }
  }

  async getLiveFeed() {
    let liveFeeds: VideoWithChannelRawId[] = [];
    try {
      let page = 0;
      let channels = await this.db.query.channel.findMany({
        where: (channel, { eq }) => eq(channel.platform, 'TWITCH'),
        with: { twitchTalent: true },
      });
      channels = channels.filter((item) => item.twitchTalent.length);
      while (page * 100 < channels.length) {
        const datas = await this.apiClient.streams.getStreams({
          userId: channels
            .slice(page * 100, page * 100 + 100)
            .map((item) => item.channelId),
          type: 'live',
          limit: 100,
        });
        if (datas.data.length > 0) {
          liveFeeds = [
            ...liveFeeds,
            ...datas.data.map((item: HelixStream) => {
              return {
                platform: 'TWITCH',
                streamId: item.id,
                videoId: null,
                title: item.title,
                thumbnail:
                  'https://static-cdn.jtvnw.net/previews-ttv/live_user_' +
                  item.userName +
                  '-1280x720.jpg',
                datetime: DateTime.fromJSDate(item.startDate).toSQL(),
                views: item.viewers,
                status: 'LIVE',
                type: 'LIVE',
                channelRawId: item.userId,
                durations: 0,
                updatedAt: null,
              } as VideoWithChannelRawId;
            }),
          ];
        }
        page = page + 1;
      }
    } catch (error) {
      console.error(error.message, { service: this.getLiveFeed.name });
    }
    return liveFeeds;
  }

  async fetchVideosByChannelRawId(channelRawId: string) {
    let videos: VideoWithChannelRawId[] = [];
    const feed = await this.videoService.getLiveFeed()
    let cursor = null;
    do {
      const resVideos = cursor
        ? await this.apiClient.videos.getVideosByUser(channelRawId, {
            limit: 100,
            after: cursor,
          })
        : await this.apiClient.videos.getVideosByUser(channelRawId, {
            limit: 100,
          });
      if (resVideos.data?.length) {
        videos = [
          ...videos,
          ...resVideos.data.map((x) => {
            const liveVideo = feed.find((y) => Boolean(y.streamId) && y.streamId == x.streamId && y.status == 'LIVE' );
            return {
              platform: 'TWITCH',
              streamId: x.streamId,
              videoId: x.id,
              title: x.title,
              thumbnail: liveVideo
                ? liveVideo.thumbnail
                : x.getThumbnailUrl(1280, 720),
              datetime: DateTime.fromJSDate(x.creationDate).toSQL(),
              views: x.views,
              status: liveVideo ? 'LIVE' : 'FINISHED',
              type: Boolean(x.streamId) ? 'LIVE' : 'UPLOADED',
              channelRawId,
              durations: x.durationInSeconds,
              updatedAt: null,
            } as VideoWithChannelRawId;
          }),
        ];
      }
      if (!resVideos.cursor) {
        break;
      }
      cursor = resVideos.cursor;
    } while (true);
    return videos;
  }

  async getChannelInfos(channelRawIds: string[]) {
    let page = 0;
    let channels: HelixUserWithFollowers[] = [];
    while (page * 50 < channelRawIds.length) {
      const resData = await this.apiClient.users.getUsersByIds(
        channelRawIds.slice(page * 50, page * 50 + 50),
      );
      const finalData = await Promise.all(
        resData.map(async (ch) => {
          const followers =
            await this.apiClient.channels.getChannelFollowerCount(ch.id);
          return {
            id: ch.id,
            displayName: ch.displayName,
            name: ch.name,
            profilePictureUrl: ch.profilePictureUrl,
            followers: followers || 0,
          } as HelixUserWithFollowers;
        }),
      );
      channels = [...channels, ...finalData];
      page = page + 1;
    }

    return channels;
  }

  async getChannelByUsername(username: string) {
    const channel = this.apiClient.users.getUserByName(username)
    return channel
  }
}
