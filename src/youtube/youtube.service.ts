import {
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  RequestTimeoutException,
  UnauthorizedException,
} from '@nestjs/common';
import { PGCONNECT } from 'src/constants';
import * as schema from '../../drizzle/schema';
import { Innertube, UniversalCache } from 'youtubei.js';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { delay } from 'src/utils';
import {
  RichItem,
  ShortsLockupView,
  ThumbnailOverlayTimeStatus,
  Video,
} from 'youtubei.js/dist/src/parser/nodes';
import * as numeral from 'numeral';
import { VideoWithChannelRawId } from 'src/type';
import { google, youtube_v3 } from 'googleapis';
import { DateTime } from 'luxon';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { OAuth2Client } from 'google-auth-library';
import { ChannelError } from 'youtubei.js/dist/src/utils/Utils';

@Injectable()
export class YoutubeService {
  private youtube: Innertube | undefined;
  private oAuth2Client: OAuth2Client | undefined;
  private cache = new UniversalCache(true, process.env.PATH_CACHE);

  constructor(
    @Inject(PGCONNECT) private db: NodePgDatabase<typeof schema>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    Innertube.create({
      cache : this.cache
    }).then(async (Innertube) => {
      this.youtube = Innertube;
      this.oAuth2Client = new OAuth2Client(
        process.env.GOOGLE_OAUTH2_CLIENT_ID,
        process.env.GOOGLE_OAUTH2_CLIENT_SECRET,
        process.env.GOOGLE_OAUTH2_URL_REDIRECT,
      );

      this.youtube.session.on('update-credentials', async (credentials) => {
        console.info('Credentials updated.');
        await this.youtube?.session.oauth.cacheCredentials();
      });

      const checkLogin = await this.signIn()
      console.log(checkLogin.message)

    });
  }

  getRedirectURL() {
    return this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        "http://gdata.youtube.com",
        "https://www.googleapis.com/auth/youtube",
        "https://www.googleapis.com/auth/youtube.force-ssl",
        "https://www.googleapis.com/auth/youtube-paid-content",
        "https://www.googleapis.com/auth/accounts.reauth",
      ],
      include_granted_scopes: true,
      prompt: 'consent',
    });
  }

  async signIn(code?: string) {
    if (!this.oAuth2Client || !this.youtube) {
      throw new InternalServerErrorException(
        'OAuth2 client or Youtube instance is not initialized.',
      );
    }
    
    if (code) {
      const { tokens } = await this.oAuth2Client.getToken(code as string);

      await this.youtube.session.signIn({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: new Date(tokens.expiry_date).toISOString(),
        client: {
          client_id: process.env.GOOGLE_OAUTH2_CLIENT_ID,
          client_secret: process.env.GOOGLE_OAUTH2_CLIENT_SECRET
        }
      });
      await this.youtube.session.oauth.cacheCredentials();
      return { message: `Logged in successfully.`, isLogged: true };
    } else {
      // Re-login
      if (await this.cache.get('youtubei_oauth_credentials')){
        await this.youtube.session.signIn();
      }
      
      if(this.youtube.session.logged_in) {
        return { message: `Logged in successfully.`, isLogged: true };
      }
      
      // redirect to google OAuth
      return { message: `Please Login before use subscription features.`, isLogged: false };

    }
  }

  async signOut() {
    if (!this.youtube) {
      throw new InternalServerErrorException(
        'Youtube instance is not initialized.',
      );
    }
    if(!this.isLoggedIn()){
      return { message: `Logged out Youtube successful.` };
    }
    await this.youtube.session.signOut();
    return { message: `Logged out Youtube successful.` };
  }

  async getSubFeed() {
    try {
      if (!this.youtube.session.logged_in) {
        throw new UnauthorizedException(
          'Please Authen Youtube before use this feature.',
        );
      }
      let returnData: VideoWithChannelRawId[] = [];
      let feedData = await this.youtube.getSubscriptionsFeed();

      do {
        let hasToday = false;
        const videos = feedData.videos;
        if (!videos?.length) {
          break;
        }
        for (const rawVideo of videos) {
          let type: typeof schema.video.$inferSelect.type = 'UPLOADED';
          let status: typeof schema.video.$inferSelect.status = 'FINISHED';
          let views = 0;

          if (rawVideo.type == 'Video') {
            const video = rawVideo as Video;

            if (returnData.find((x) => x.videoId == video.id)) {
              // QUIT FROM BUG
              hasToday = false;
              break;
            }

            if (
              video.published?.text?.includes('second') ||
              video.published?.text?.includes('minute') ||
              video.published?.text?.includes('hour')
            ) {
              hasToday = true;
            } else if (video.published?.text?.length) {
              continue;
            }

            if (video.upcoming) {
              type = video.duration?.seconds ? 'UPLOADED' : 'LIVE';
              status = 'UPCOMING';
            } else if (video.is_live) {
              type = 'LIVE';
              status = 'LIVE';
            } else if (video.is_premiere) {
              type = 'UPLOADED';
              status = 'LIVE';
            } else if (
              video.published.toString().toLowerCase().includes('streamed')
            ) {
              type = 'LIVE';
            }

            if (video.view_count?.text?.includes('watching')) {
              views = numeral(
                video.view_count?.toString().replace(' watching', ''),
              ).value();
            } else if (video.view_count?.text?.includes('views')) {
              views = numeral(
                video.view_count?.toString().replace(' views', ''),
              ).value();
            }

            returnData.push({
              platform: 'YOUTUBE',
              videoId: video.id,
              streamId: video.id,
              title: video.title.toString(),
              thumbnail: video.thumbnails
                .sort((a, b) => b.width - a.width)
                .at(0)
                ?.url.split('?')[0],
              datetime: video.upcoming
                ? DateTime.fromJSDate(video.upcoming).toSQL()
                : null,
              views: views ? views : 0,
              durations: video.duration.seconds ? video.duration.seconds : 0,
              channelRawId: video.author.id,
              status: status,
              type: type,
              updatedAt: null,
            });
          }
        }
        if (feedData.has_continuation && hasToday) {
          feedData = await feedData.getContinuation();
        } else {
          break;
        }
      } while (feedData && returnData.length < 1000);
      return returnData.filter((item) => item != null);
    } catch (error) {
      console.error(error.message, { service: this.getSubFeed.name });
    }
    return [];
  }

  async getSubShortFeed() {
    if (!this.youtube.session.logged_in) {
      throw new UnauthorizedException(
        'Please Authen Youtube before use this feature.',
      );
    }

    try {
      // First Time
      const response = await this.youtube.actions.execute('/browse', {
        browseId: 'FEsubscriptions_shorts',
        parse: true,
      });
      if (!response.contents_memo.get('RichItem')?.length) {
        return [];
      }
      const reels = (response.contents_memo.get('RichItem') as RichItem[])?.map(
        (item) => item.content as ShortsLockupView,
      );

      return reels.map((item) => {
        let views = 0;
        if (item.overlay_metadata?.secondary_text?.toString()) {
          const txtSubs = item.overlay_metadata?.secondary_text
            ?.toString()
            ?.replace(' views', '')
            .toUpperCase();
          if (txtSubs.includes('K')) {
            views = Math.round(numeral(txtSubs).value() * 1000);
          } else if (txtSubs.includes('M')) {
            views = Math.round(numeral(txtSubs).value() * 1000000);
          } else {
            views = Math.round(numeral(txtSubs).value());
          }
        }
        return {
          id: null,
          platform: 'YOUTUBE',
          videoId: item.on_tap_endpoint.payload.videoId,
          streamId: item.on_tap_endpoint.payload.videoId,
          title:
            item.accessibility_text
              .split(/(.*)(\u002c\s(?:[a-z. 0-9]+|no) view(s*) - play short)/gi)
              .at(1) || null,
          thumbnail: item.thumbnail[0]?.url?.split('?')?.at(0) || null,
          datetime: null,
          views: views || 0,
          durations: 0,
          channelId: null,
          channelRawId: null,
          status: 'FINISHED',
          type: 'SHORT',
          updatedAt: DateTime.now().toJSDate(),
        } as VideoWithChannelRawId;
      });
    } catch (error) {
      console.error(error.message, { service: this.getSubShortFeed.name });
    }
    return [];
  }

  async getVideoDetail(videoId: string) {
    try {
      const data = await this.youtube.getBasicInfo(videoId);
      if (!data) {
        return null;
      }
      let status: typeof schema.video.$inferSelect.status = 'FINISHED';
      if (data.basic_info.is_upcoming) {
        status = 'UPCOMING';
      } else if (data.basic_info.is_live) {
        status = 'LIVE';
      }

      return {
        platform: 'YOUTUBE',
        videoId: videoId,
        streamId: videoId,
        title: data.basic_info.title,
        thumbnail: data.basic_info.thumbnail
          .sort((a, b) => b.width - a.width)
          .at(0)
          ?.url.split('?')[0],
        datetime: data.basic_info.start_timestamp || null,
        views: data.basic_info.view_count,
        durations: data.basic_info.duration || 0,
        channelId: null, // find in later
        channelRawId: data.basic_info.channel_id,
        status: status,
        type: data.basic_info.is_live_content ? 'LIVE' : 'UPLOADED', // don't care about SHORT
      };
    } catch (error) {
      if (error?.message != 'This video is unavailable') {
        console.error(error?.message);
      }
      return null;
    }
  }

  async getVideosDataByYoutubeAPIV3(videoIds: string[]) {
    if (!Boolean(videoIds?.length)) {
      return {
        data: {
          items: [] as youtube_v3.Schema$Video[],
        },
      };
    }
    const datas = await google.youtube('v3').videos.list({
      key: process.env.YOUTUBE_V3_API_KEY,
      part: ['snippet', 'liveStreamingDetails', 'statistics'],
      id: videoIds,
    });
    if (datas.status != 200) {
      throw new HttpException(datas.statusText, datas.status);
    }
    return datas;
  }

  getDetailFromYoutubeAPIV3VideoObj(video: youtube_v3.Schema$Video) {
    let status: 'FINISHED' | 'UPCOMING' | 'LIVE' | 'UNAVAILABLE' = 'FINISHED';
    let datetime: Date = DateTime.now().toJSDate();
    let thumbnail: string = null;
    let views = video.statistics.viewCount
      ? Math.floor(numeral(video.statistics.viewCount).value())
      : 0;
    if (video.liveStreamingDetails?.actualStartTime) {
      datetime = DateTime.fromISO(
        video.liveStreamingDetails?.actualStartTime,
      ).toJSDate();
      if (video.liveStreamingDetails?.concurrentViewers) {
        status = 'LIVE';
        views = Math.floor(
          numeral(video.liveStreamingDetails.concurrentViewers).value(),
        );
      }
    } else if (video.liveStreamingDetails?.scheduledStartTime) {
      datetime = DateTime.fromISO(
        video.liveStreamingDetails?.scheduledStartTime,
      ).toJSDate();
      status = 'UPCOMING';
    } else if (video.snippet?.publishedAt) {
      datetime = DateTime.fromISO(video.snippet?.publishedAt).toJSDate();
    }
    let size = 0;

    for (const [key, value] of Object.entries(video.snippet.thumbnails)) {
      if (size < value.height) {
        thumbnail = value.url;
        size = value.height;
      }
    }
    return {
      datetime,
      status,
      thumbnail,
      title: video.snippet.title,
      views,
    };
  }

  private async updateVideoByYoutubeAPIV3(videoIds: string[]) {
    try {
      const datas = await this.getVideosDataByYoutubeAPIV3(videoIds);
      const itemVideos = datas.data.items;
      await Promise.all(
        itemVideos.map(async (video) => {
          const { status, thumbnail, views, title, datetime } =
            this.getDetailFromYoutubeAPIV3VideoObj(video);
          const rep = await this.db
            .update(schema.video)
            .set({
              status,
              thumbnail,
              views,
              title,
              datetime: DateTime.fromJSDate(datetime).toSQL(),
              updatedAt: DateTime.now().toJSDate(),
            })
            .where(eq(schema.video.videoId, video.id))
            .returning({ videoId: schema.video.videoId });

          return rep.at(0);
        }),
      );
      const foundIds = itemVideos.map((x) => x.id);
      await Promise.all(
        videoIds
          .filter((x) => !foundIds.includes(x))
          .map(async (videoId) => {
            const rep = await this.db
              .update(schema.video)
              .set({
                status: 'UNAVAILABLE',
                datetime: DateTime.now().toSQL(),
              })
              .where(eq(schema.video.videoId, videoId))
              .returning();

            return rep.at(0);
          }),
      );
    } catch (error) {
      console.error(error);
    }
  }

  async setYoutubeUpcomingAndLiveDatetime() {
    const videos = await this.db.query.video.findMany({
      where: and(
        isNull(schema.video.datetime),
        eq(schema.video.platform, 'YOUTUBE'),
        inArray(schema.video.status, ['UPCOMING', 'LIVE']),
      ),
      columns: {
        videoId: true,
      },
    });

    try {
      let page = 0;
      while (page * 50 < videos.length) {
        await this.updateVideoByYoutubeAPIV3(
          videos.slice(page * 50, page * 50 + 50).map((x) => x.videoId),
        );
        page = page + 1;
      }
    } catch (error) {
      console.error(error);
    }
  }

  async setYoutubeVideoDatetime() {
    const videos = await this.db.query.video.findMany({
      where: and(
        isNull(schema.video.datetime),
        eq(schema.video.platform, 'YOUTUBE'),
      ),
      limit: 50,
      columns: {
        videoId: true,
      },
    });

    try {
      if (videos.length) {
        await this.updateVideoByYoutubeAPIV3(videos.map((x) => x.videoId));
      }
    } catch (error) {
      console.error(error);
    }
  }

  async getChannelInfos(channelRawIds: string[]) {
    let page = 0;
    let channels: youtube_v3.Schema$Channel[] = [];
    while (page * 50 < channelRawIds.length) {
      const datas = await google.youtube('v3').channels.list({
        key: process.env.YOUTUBE_V3_API_KEY,
        part: ['snippet', 'statistics'],
        id: channelRawIds.slice(page * 50, page * 50 + 50),
      });
      channels = [...channels, ...datas.data.items];
      page = page + 1;
    }
    return channels;
  }

  async fetchVideosByChannelRawId(
    channelRawId: string,
    type: 'video' | 'live' | 'shorts' = 'video',
  ) {
    let videos: VideoWithChannelRawId[] = [];
    let loopRound = 0;
    try {
      let channel = await this.youtube.getChannel(channelRawId);
      if (!channel) {
        return videos;
      }
      switch (type) {
        case 'live':
          {
            if (!channel.has_live_streams) {
              return videos;
            }
            channel = await channel.getLiveStreams();
          }
          break;

        case 'shorts':
          {
            if (!channel.has_shorts) {
              return videos;
            }
            channel = await channel.getShorts();
          }
          break;

        default:
          if (!channel.has_videos) {
            return videos;
          }
          channel = await channel.getVideos();
          break;
      }
      let rawVideos = channel.videos;
      let continuation = null;

      while (rawVideos) {
        // loop for add or update
        for (const rawVideo of rawVideos) {
          let status: 'FINISHED' | 'UPCOMING' | 'LIVE' | 'UNAVAILABLE' =
            'FINISHED';
          let views = 0;
          if (rawVideo.type == 'Video') {
            const video = rawVideo as Video;
            const overlayTime = video.thumbnail_overlays?.find(
              (x) => x.type == 'ThumbnailOverlayTimeStatus',
            ) as ThumbnailOverlayTimeStatus;
            if (
              overlayTime?.style == 'LIVE' ||
              overlayTime?.style == 'PREMIERE'
            ) {
              status = 'LIVE';
            } else if (overlayTime?.style == 'UPCOMING') {
              status = 'UPCOMING';
            }

            if (video.view_count?.text?.includes('watching')) {
              status = 'LIVE';
            } else if (video.view_count?.text?.includes('views')) {
              views = numeral(
                video.view_count?.text.replace(' views', ''),
              ).value();
            }

            videos.push({
              platform: 'YOUTUBE',
              videoId: video.id,
              streamId: video.id,
              title: video.title.toString(),
              thumbnail:
                video.thumbnails
                  ?.sort((a, b) => b.height - a.height)
                  ?.at(0)
                  ?.url.split('?')
                  ?.at(0) || '',
              datetime: video.upcoming
                ? DateTime.fromJSDate(video.upcoming).toSQL()
                : null,
              views: views || 0,
              durations: video.duration.seconds,
              status,
              type: type == 'video' ? 'UPLOADED' : 'LIVE',
              updatedAt: DateTime.now().toJSDate(),
            });
          } else if (rawVideo.type == 'ShortsLockupView') {
            const video = rawVideo as ShortsLockupView;

            let views = 0;
            if (video.overlay_metadata?.secondary_text?.toString()) {
              const txtSubs = video.overlay_metadata?.secondary_text
                ?.toString()
                ?.replace(' views', '')
                .toUpperCase();
              if (txtSubs.includes('K')) {
                views = Math.round(numeral(txtSubs).value() * 1000);
              } else if (txtSubs.includes('M')) {
                views = Math.round(numeral(txtSubs).value() * 1000000);
              } else {
                views = Math.round(numeral(txtSubs).value());
              }
            }

            videos.push({
              platform: 'YOUTUBE',
              videoId: video.on_tap_endpoint.payload.videoId,
              streamId: video.on_tap_endpoint.payload.videoId,
              title:
                video.accessibility_text
                  .split(
                    /(.*)(\u002c\s(?:[a-z. 0-9]+|no) view(s*) - play short)/gi,
                  )
                  .at(1) || null,
              thumbnail: video.thumbnail[0]?.url?.split('?')?.at(0) || null,
              datetime: null,
              views: views || 0,
              durations: 0,
              status: 'FINISHED',
              type: 'SHORT',
              updatedAt: DateTime.now().toJSDate(),
            });
          } else {
            continue;
          }
        }

        // get Continuation
        if (!loopRound) {
          // first Loop
          continuation = channel.has_continuation
            ? await channel.getContinuation()
            : null;
        } else {
          continuation = continuation.has_continuation
            ? await continuation.getContinuation()
            : null;
        }

        if (!continuation?.videos) {
          return videos;
        }
        rawVideos = continuation.videos;
        loopRound = loopRound + 1;
      }
    } catch (error) {
      if(!error.message?.includes("ChannelError")){
        console.error(error);
      }
    }
    return videos;
  }

  async subChannel(channelId: string) {
    try {
      if (!this.youtube.session.logged_in) {
        throw new UnauthorizedException(
          'Please Authen Youtube before use this feature.',
        );
      }
      const channel = await this.youtube.getChannel(channelId);
      if (!channel) {
        throw new NotFoundException('Channel not found.');
      }
      const res = await this.youtube.interact.subscribe(channelId);
      return res;
    } catch (error) {
      throw new InternalServerErrorException(error?.message);
    }
  }

  async unSubChannel(channelId: string) {
    try {
      if (!this.youtube.session.logged_in) {
        throw new UnauthorizedException(
          'Please Authen Youtube before use this feature.',
        );
      }
      const channel = await this.youtube.getChannel(channelId);
      if (!channel) {
        throw new NotFoundException('Channel not found.');
      }
      const res = await this.youtube.interact.unsubscribe(channelId);
      return res;
    } catch (error) {
      throw new InternalServerErrorException(error?.message);
    }
  }

  isLoggedIn() {
    return this.youtube.session.logged_in
  }
}
