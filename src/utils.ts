import Bull, { Queue } from 'bull';

export function delay(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

export function uniqueFilter(value: any, index: number, self: any[]) {
  return self.indexOf(value) === index;
}

export const revalidate = async (tag: string) => {
  if (process.env.REVALIDATE_ENABLE != '1') {
    return;
  }

  await fetch(
    `${process.env.REVALIDATE_URL}/${tag}?secret=${process.env.REVALIDATE_SERECT}`,
  ).catch(() => {
    /*Do Nothing*/
  });
};

export const getTalentImageUrl = (talent: {
  profileImgType: 'TWITCH' | 'YOUTUBE' | 'UPLOADED' | 'NONE';
  profileImgURL: string | null;
  twitchMain: {
    profileImgURL: string | null;
  };
  youtubeMain: {
    profileImgURL: string | null;
  };
}) => {
  switch (talent?.profileImgType) {
    case 'TWITCH':
      return talent.twitchMain?.profileImgURL;
    case 'YOUTUBE':
      return talent.youtubeMain?.profileImgURL;
    default:
      return talent?.profileImgURL || null;
  }
};

export const getURLVideo = (video: {
  platform: 'TWITCH' | 'YOUTUBE';
  status: string | null;
  videoId: string | null;
  type: string | null;
  channel: {
    username: string | null;
  } | null;
}) => {
  let url = null;
  switch (video.platform) {
    case 'TWITCH':
      {
        if (video.status == 'FINISHED' && video.videoId) {
          url = 'https://www.twitch.tv/videos/' + video.videoId;
        } else {
          url = 'https://www.twitch.tv/' + video.channel?.username;
        }
      }
      break;
    default:
      {
        if (video.type == 'SHORT') {
          url = 'https://www.youtube.com/shorts/' + video.videoId;
        } else {
          url = 'https://www.youtube.com/watch?v=' + video.videoId;
        }
      }
      break;
  }
  return url;
};
