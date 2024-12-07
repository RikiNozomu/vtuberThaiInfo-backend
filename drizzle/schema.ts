import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  json,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export enum TalentType {
  TWO_D = "TWO_D",
  THREE_D = "THREE_D",
  PNG = "PNG",
}

export const config = pgTable(
  "config",
  {
    id: serial("id").primaryKey(),
    key: text("key"),
    value: text("value"),
  },
  (table) => ({
    keyConfigIdx: uniqueIndex("keyConfigIdx").on(table.key),
  }),
);

export const approve = pgTable("approve", {
  id: serial("id").primaryKey(),
  type: text("type", { enum: ["TALENT", "AFFILIATE"] }).default("TALENT"),
  talentId: integer("talentId").references(() => talent.id, {
    onDelete: "set null",
  }),
  affiliateId: integer("affiliateId").references(() => affiliate.id, {
    onDelete: "set null",
  }),
  profileImgURL: text("profileImgURL"),
  data: json("data"),
  code: text("code").notNull().unique(),
  status: text("status", { enum: ["WAITING", "ACCEPTED", "REJECTED"] }).default(
    "WAITING",
  ),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  remark: text("remark"),
  reason: text("reason"),
});

export const talent = pgTable("talent", {
  id: serial("id").primaryKey(),
  name: text("name"),
  nameHeadline: text("nameHeadline"),
  slug: text("slug").unique(),
  profileImgType: text("profileImgType", {
    enum: ["NONE", "YOUTUBE", "TWITCH", "UPLOADED"],
  }).default("NONE"),
  profileImgURL: text("profileImgURL"),
  firstName: text("firstName"),
  middleName: text("middleName"),
  lastName: text("lastName"),
  bigName: text("bigName", { enum: ["FIRST", "MIDDLE", "LAST"] }).default(
    "FIRST",
  ),
  statusType: text("statusType", {
    enum: ["ACTIVE", "INACTIVE_AS_VTUBER", "RETIRED", "DELIST"],
  }).default("ACTIVE"),
  age: text("age"),
  bio: text("bio"),
  trivia: text("trivia"),
  type: json("type").$type<TalentType[]>().default([TalentType.TWO_D]),
  youtubeMainId: integer("youtubeMainId").references(() => channel.id, {
    onDelete: "set null",
  }),
  twitchMainId: integer("twitchMainId").references(() => channel.id, {
    onDelete: "set null",
  }),
});

export const affiliate = pgTable("affiliate", {
  id: serial("id").primaryKey(),
  name: text("name"),
  nameHeadline: text("nameHeadline"),
  slug: text("slug").unique(),
  profileImgURL: text("profileImgURL"),
  type: text("type", { enum: ["AFFILIATE", "GROUP", "ADS"] }).notNull(),
});

export const channel = pgTable("channel", {
  id: serial("id").primaryKey(),
  username: text("username"),
  channelName: text("channelName"),
  channelId: text("channelId").unique(),
  platform: text("platform", { enum: ["YOUTUBE", "TWITCH"] }).notNull(),
  profileImgURL: text("profileImgURL"),
  subs: integer("sub").default(0),
  views: integer("views").default(0),
});

export const video = pgTable("video", {
  id: serial("id").primaryKey(),
  platform: text("platform", { enum: ["YOUTUBE", "TWITCH"] }).notNull(),
  videoId: text("videoId").unique(),
  streamId: text("streamId").unique(),
  title: text("title"),
  thumbnail: text("thumbnail"),
  datetime: timestamp("timestamp", { mode: "string", precision : 3, withTimezone : true }),
  views: integer("views").default(0),
  durations: integer("durations").default(0),
  channelId: integer("channelId").references(() => channel.id, {
    onDelete: "cascade",
  }),
  status: text("status", {
    enum: ["FINISHED", "UPCOMING", "LIVE", "UNAVAILABLE"],
  }).default("UPCOMING"),
  type: text("type", { enum: ["UPLOADED", "LIVE", "SHORT"] }).default("LIVE"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const hashtag = pgTable("hashtag", {
  id: serial("id").primaryKey(),
  text: text("text"),
  value: text("value"),
  talentId: integer("talentId")
    .notNull()
    .references(() => talent.id, { onDelete: "cascade" }),
});

export const info = pgTable("info", {
  id: serial("id").primaryKey(),
  key: text("key"),
  value: text("value"),
  link: text("link"),
  talentId: integer("talentId").references(() => talent.id, {
    onDelete: "cascade",
  }),
  affiliateId: integer("affiliateId").references(() => affiliate.id, {
    onDelete: "cascade",
  }),
});

export const social = pgTable("social", {
  id: serial("id").primaryKey(),
  text: text("text"),
  link: text("link"),
  platform: text("platform", {
    enum: [
      "WWW",
      "YOUTUBE",
      "TWITCH",
      "TWITTER",
      "FACEBOOK",
      "TIKTOK",
      "INSTAGRAM",
      "GITHUB",
      "DISCORD",
      "ARBUM",
      "PIXIV",
      "STEAM",
      "DEVIANART",
      "SOUNDCLOUD",
      "MASTODON",
      "MISSKEY",
    ],
  }).default("WWW"),
  talentId: integer("talentId").references(() => talent.id, {
    onDelete: "cascade",
  }),
  affiliateId: integer("affiliateId").references(() => affiliate.id, {
    onDelete: "cascade",
  }),
});

export const timeline = pgTable("timeline", {
  id: serial("id").primaryKey(),
  value: text("value"),
  day: integer("day"),
  month: integer("month"),
  year: integer("year"),
  isAnniversary: boolean("isAnniversary").default(true),
  type: text("type", {
    enum: [
      "DEBUT",
      "REDEBUT",
      "REMODEL",
      "REACTIVE",
      "INACTIVE",
      "RETIRED",
      "OTHER",
      "MOVE",
      "BIRTHDAY",
      "NEWMODEL",
    ],
  }).default("OTHER"),
  talentId: integer("talentId").references(() => talent.id, {
    onDelete: "cascade",
  }),
});

export const specialTimeline = pgTable("specialTimeline", {
  id: serial("id").primaryKey(),
  time: text("time"),
  title: text("title"),
  desc: text("desc"),
  day: integer("day"),
  month: integer("month"),
  year: integer("year"),
  isActive: boolean("isActive").default(true),
  imgUrl: text("imgUrl"),
  url: text('url')
});

export const transfer = pgTable("transfer", {
  id: serial("id").primaryKey(),
  hasIn: boolean("hasIn").default(false),
  hasOut: boolean("hasOut").default(false),
  dayIn: integer("dayIn"),
  monthIn: integer("monthIn"),
  yearIn: integer("yearIn"),
  dayOut: integer("dayOut"),
  monthOut: integer("monthOut"),
  yearOut: integer("yearOut"),
  isActive: boolean("isActive").default(true),
  type: text("type", { enum: ["MEMBER", "PARTNER", "OTHER"] }),
  typeString: text("typeString"),
  talentId: integer("talentId")
    .notNull()
    .references(() => talent.id, { onDelete: "cascade" }),
  affiliateName: text("affiliateName"),
  affiliateId: integer("affiliateId").references(() => affiliate.id, {
    onDelete: "set null",
  }),
});

export const SocialRelations = relations(social, ({ one }) => ({
  talent: one(talent, {
    fields: [social.talentId],
    references: [talent.id],
  }),
  affiliate: one(affiliate, {
    fields: [social.affiliateId],
    references: [affiliate.id],
  }),
}));

export const InfoRelations = relations(info, ({ one }) => ({
  talent: one(talent, {
    fields: [info.talentId],
    references: [talent.id],
  }),
  affiliate: one(affiliate, {
    fields: [info.affiliateId],
    references: [affiliate.id],
  }),
}));

export const HashtagRelations = relations(hashtag, ({ one }) => ({
  talent: one(talent, {
    fields: [hashtag.talentId],
    references: [talent.id],
  }),
}));

export const TalentRelations = relations(talent, ({ one, many }) => ({
  youtubeMain: one(channel, {
    fields: [talent.youtubeMainId],
    references: [channel.id],
    relationName: "youtubeTalent",
  }),
  twitchMain: one(channel, {
    fields: [talent.twitchMainId],
    references: [channel.id],
    relationName: "twitchTalent",
  }),
  timelines: many(timeline),
  transfers: many(transfer),
  socials: many(social),
  infos: many(info),
  hashtags: many(hashtag),
}));

export const VideoRelations = relations(video, ({ one }) => ({
  channel: one(channel, {
    fields: [video.channelId],
    references: [channel.id],
  }),
}));

export const ChannelRelations = relations(channel, ({ many }) => ({
  youtubeTalent: many(talent, { relationName: "youtubeTalent" }),
  twitchTalent: many(talent, { relationName: "twitchTalent" }),
}));

export const AffiliateRelations = relations(affiliate, ({ many }) => ({
  transfers: many(transfer),
  socials: many(social),
  infos: many(info),
}));

export const TimelineRelations = relations(timeline, ({ one }) => ({
  talent: one(talent, {
    fields: [timeline.talentId],
    references: [talent.id],
  }),
}));

export const TalentAndAffiliateRelations = relations(transfer, ({ one }) => ({
  talent: one(talent, {
    fields: [transfer.talentId],
    references: [talent.id],
  }),
  affiliate: one(affiliate, {
    fields: [transfer.affiliateId],
    references: [affiliate.id],
  }),
}));

export const ApproveRelations = relations(approve, ({ one }) => ({
  talent: one(talent, {
    fields: [approve.talentId],
    references: [talent.id],
  }),
  affiliate: one(affiliate, {
    fields: [approve.affiliateId],
    references: [affiliate.id],
  }),
}));
