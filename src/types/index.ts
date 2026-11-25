import type {
  DefaultMessageNotificationLevel,
  ExplicitContentFilterLevel,
  FileOptions,
  MessageEmbed,
  MessageMentionOptions,
  Snowflake,
  TextBasedChannelTypes,
  ThreadAutoArchiveDuration,
  ThreadChannelTypes,
  VerificationLevel,
  VoiceBasedChannelTypes,
} from "discord.js-selfbot-v13";

export type SpeedPreset = "safe" | "balanced" | "turbo" | "custom";

export interface AfkData {
  name: string;
  timeout: number;
}

export interface SystemChannelData {
  name: string;
  flags: number;
}

export interface WidgetData {
  enabled: boolean;
  channel?: string | null;
}

export interface BanData {
  id: Snowflake;
  reason?: string | null;
}

export interface EmojiData {
  name: string;
  url?: string;
  base64?: string;
  animated?: boolean;
}

export interface StickerData {
  name: string;
  description?: string | null;
  tags: string;
  url: string;
  base64?: string;
}

export interface RoleData {
  id: string;
  name: string;
  color: `#${string}`;
  hoist: boolean;
  permissions: string;
  mentionable: boolean;
  position: number;
  isEveryone: boolean;
}

export interface ChannelPermissionsData {
  roleId?: string;
  roleName: string;
  allow: string;
  deny: string;
}

export interface MessageData {
  username: string;
  avatar?: string;
  content?: string;
  embeds?: MessageEmbed[];
  files?: FileOptions[];
  pinned?: boolean;
}

export interface ThreadChannelData {
  type: ThreadChannelTypes;
  name: string;
  archived: boolean;
  autoArchiveDuration: ThreadAutoArchiveDuration;
  locked: boolean;
  rateLimitPerUser: number;
  messages: MessageData[];
}

export interface BaseChannelData {
  type: TextBasedChannelTypes | VoiceBasedChannelTypes | ThreadChannelTypes | string;
  name: string;
  parent?: string | null;
  position: number;
  permissions: ChannelPermissionsData[];
}

export interface TextChannelData extends BaseChannelData {
  nsfw: boolean;
  topic?: string | null;
  rateLimitPerUser?: number;
  isNews: boolean;
  messages: MessageData[];
  threads: ThreadChannelData[];
}

export interface VoiceChannelData extends BaseChannelData {
  bitrate: number;
  userLimit: number;
}

export interface CategoryData {
  name: string;
  position: number;
  permissions: ChannelPermissionsData[];
  children: Array<TextChannelData | VoiceChannelData>;
}

export interface ChannelsData {
  categories: CategoryData[];
  others: Array<TextChannelData | VoiceChannelData>;
}

export interface BackupData {
  version?: string;
  name: string;
  iconURL?: string | null;
  iconBase64?: string;
  splashURL?: string | null;
  splashBase64?: string;
  bannerURL?: string | null;
  bannerBase64?: string;
  verificationLevel: VerificationLevel;
  explicitContentFilter: ExplicitContentFilterLevel;
  defaultMessageNotifications: DefaultMessageNotificationLevel | number;
  afk?: AfkData | null;
  systemChannel?: SystemChannelData | null;
  widget: WidgetData;
  channels: ChannelsData;
  roles: RoleData[];
  bans: BanData[];
  emojis: EmojiData[];
  stickers: StickerData[];
  createdTimestamp: number;
  guildID: string;
  id: Snowflake;
}

export interface BackupSummary {
  id: string;
  name: string;
  sizeKb: number;
  createdAt: string;
  rolesCount: number;
  categoriesCount: number;
  channelsCount: number;
  emojisCount: number;
  stickersCount: number;
}

export interface CreateOptions {
  backupID?: string;
  maxMessagesPerChannel?: number;
  jsonSave?: boolean;
  jsonBeautify?: boolean;
  doNotBackup?: string[];
  saveImages?: "base64" | "";
  ignoreHiddenChannels?: boolean;
}

export interface LoadOptions {
  clearGuildBeforeRestore?: boolean;
  skipExisting?: boolean;
  maxMessagesPerChannel?: number;
  allowedMentions?: MessageMentionOptions;
  delayMs?: number;
  ignoreTickets?: boolean;
  ignoreHiddenChannels?: boolean;
  debug?: boolean;
  doNotRestore?: string[];
  onlyPhases?: string[];
  onRateLimit?: (info: { phase: string; timeoutMs: number; path: string; global: boolean }) => Promise<"skip" | "wait">;
}

export interface RestoreStats {
  rolesCreated: number;
  rolesSkipped: number;
  categoriesCreated: number;
  categoriesSkipped: number;
  channelsCreated: number;
  channelsSkipped: number;
  emojisCreated: number;
  emojisSkipped: number;
  stickersCreated: number;
  stickersSkipped: number;
  bansRestored: number;
  messagesCloned: number;
  errors: number;
  durationSeconds: number;
  logFilePath?: string;
  rateLimitedPhases?: string[];
  rateLimitUntil?: number;
}

export interface ClonerRuntimeConfig {
  maxMessagesPerChannel: number;
  jsonSave: boolean;
  jsonBeautify: boolean;
  saveImagesBase64: boolean;
  doNotBackup: string[];
  ignoreTickets: boolean;
  speedPreset: SpeedPreset;
  delayMs: number;
  clearGuildBeforeRestore: boolean;
  skipExisting: boolean;
  debug: boolean;
}
