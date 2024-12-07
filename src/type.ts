import { video } from 'drizzle/schema';
import { NavigationEndpoint } from 'youtubei.js/dist/src/parser/nodes';

export type VideoWithChannelRawId = Omit<typeof video.$inferSelect, "id" | "channelId"> & {
  channelRawId?: string;
};

export type HelixUserWithFollowers = {
  displayName: string;
  id: string;
  name: string;
  profilePictureUrl: string;
  followers: number;
};

export type VideoWithTalent = {
  id: number;
  videoId?: string;
  streamId?: string;
  title: string;
  thumbnail?: string;
  durations: number;
  datetime?: string;
  platform: "TWITCH" | "YOUTUBE";
  type: "UPLOADED" | "LIVE" | "SHORT" ;
  status: "FINISHED" | "UPCOMING" | "LIVE" | "UNAVAILABLE";
  views: number;
  url?: string;
  updatedAt?: Date | null
  talents: {
    id: number;
    name: string;
    profileImgURL?: string;
    slug: string;
  }[];
};