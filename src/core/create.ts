import type {
  CategoryChannel,
  ChannelLogsQueryOptions,
  Collection,
  Guild,
  GuildChannel,
  Message,
  NewsChannel,
  Snowflake,
  TextChannel,
  ThreadChannel,
  VoiceChannel,
} from "discord.js-selfbot-v13";
import type {
  BanData,
  CategoryData,
  ChannelPermissionsData,
  ChannelsData,
  CreateOptions,
  EmojiData,
  MessageData,
  RoleData,
  StickerData,
  TextChannelData,
  ThreadChannelData,
  VoiceChannelData,
} from "../types";
import { runtimeConfig } from "../utils/config";

const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

export async function fetchUrlAsBase64(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
  } catch (err) {
    if (runtimeConfig.debug) {
      console.warn(`[Debug] Failed to download image (${url}):`, err);
    }
    return undefined;
  }
}

export function fetchChannelPermissions(
  channel: TextChannel | VoiceChannel | CategoryChannel | NewsChannel | GuildChannel
): ChannelPermissionsData[] {
  const permissions: ChannelPermissionsData[] = [];
  try {
    if (!channel.permissionOverwrites?.cache) return permissions;

    for (const perm of channel.permissionOverwrites.cache.values()) {
      if (perm.type !== "role") continue;
      const role = channel.guild.roles.cache.get(perm.id);
      if (role) {
        permissions.push({
          roleId: role.id,
          roleName: role.name,
          allow: perm.allow.bitfield.toString(),
          deny: perm.deny.bitfield.toString(),
        });
      }
    }
  } catch (error) {
    if (runtimeConfig.debug) {
      console.error(`[Debug] Error fetching permissions for ${channel.name}:`, error);
    }
  }
  return permissions;
}

export async function getBans(guild: Guild): Promise<BanData[]> {
  const bans: BanData[] = [];
  try {
    const cases = await guild.bans.fetch();
    for (const ban of cases.values()) {
      bans.push({
        id: ban.user.id,
        reason: ban.reason ?? null,
      });
    }
  } catch (error) {
    if (runtimeConfig.debug) {
      console.warn("[Debug] Could not fetch bans (missing permission or restricted):", error);
    }
  }
  return bans;
}

export async function getRoles(guild: Guild): Promise<RoleData[]> {
  const roles: RoleData[] = [];
  const sortedRoles = [...guild.roles.cache.values()]
    .filter((role) => !role.managed)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  for (const role of sortedRoles) {
    roles.push({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      hoist: role.hoist,
      permissions: role.permissions.bitfield.toString(),
      mentionable: role.mentionable,
      position: role.position ?? 0,
      isEveryone: guild.id === role.id,
    });
  }
  return roles;
}

export async function getEmojis(guild: Guild, options: CreateOptions): Promise<EmojiData[]> {
  const emojis: EmojiData[] = [];
  for (const emoji of guild.emojis.cache.values()) {
    if (!emoji.name) continue;
    const eData: EmojiData = {
      name: emoji.name,
      animated: Boolean(emoji.animated),
    };

    if (options.saveImages === "base64") {
      const b64 = await fetchUrlAsBase64(emoji.url);
      if (b64) {
        eData.base64 = b64;
      } else {
        eData.url = emoji.url;
      }
    } else {
      eData.url = emoji.url;
    }
    emojis.push(eData);
  }
  return emojis;
}

export async function getStickers(guild: Guild, options: CreateOptions): Promise<StickerData[]> {
  const stickers: StickerData[] = [];
  try {
    const fetched = await guild.stickers.fetch().catch(() => guild.stickers.cache);
    for (const sticker of fetched.values()) {
      if (!sticker.name || !sticker.url) continue;
      const sData: StickerData = {
        name: sticker.name,
        description: sticker.description ?? null,
        tags: sticker.tags || "sticker",
        url: sticker.url,
      };
      if (options.saveImages === "base64") {
        const b64 = await fetchUrlAsBase64(sticker.url);
        if (b64) sData.base64 = b64;
      }
      stickers.push(sData);
    }
  } catch (err) {
    if (runtimeConfig.debug) {
      console.warn("[Debug] Could not fetch stickers:", err);
    }
  }
  return stickers;
}

export async function fetchChannelMessages(
  channel: TextChannel | NewsChannel | ThreadChannel,
  options: CreateOptions
): Promise<MessageData[]> {
  const maxCount =
    typeof options.maxMessagesPerChannel === "number" && !Number.isNaN(options.maxMessagesPerChannel)
      ? Math.max(0, Math.min(options.maxMessagesPerChannel, 100))
      : 0;

  if (maxCount === 0) return [];

  const messages: MessageData[] = [];
  let lastMessageId: Snowflake | undefined;

  while (messages.length < maxCount) {
    const remaining = maxCount - messages.length;
    const fetchOptions: ChannelLogsQueryOptions = {
      limit: Math.min(100, remaining),
      ...(lastMessageId ? { before: lastMessageId } : {}),
    };

    let fetched: Collection<Snowflake, Message>;
    try {
      fetched = await channel.messages.fetch(fetchOptions);
    } catch (error) {
      if (runtimeConfig.debug) {
        console.warn(`[Debug] Could not fetch messages for #${channel.name}:`, error);
      }
      break;
    }

    if (fetched.size === 0) break;
    lastMessageId = fetched.last()?.id;

    for (const msg of fetched.values()) {
      if (messages.length >= maxCount) break;
      if (!msg.author) continue;

      const files: { name: string; attachment: string | Buffer }[] = [];
      for (const att of msg.attachments.values()) {
        let attachmentValue: string | Buffer = att.url;
        if (options.saveImages === "base64" && IMAGE_EXT_REGEX.test(att.url)) {
          const b64 = await fetchUrlAsBase64(att.url);
          if (b64) attachmentValue = b64;
        }
        files.push({
          name: att.name ?? "attachment",
          attachment: attachmentValue,
        });
      }

      messages.push({
        username: msg.author.username,
        avatar: msg.author.displayAvatarURL(),
        content: msg.cleanContent,
        embeds: msg.embeds,
        files,
        pinned: msg.pinned,
      });
    }

    if (fetched.size < (fetchOptions.limit ?? 100)) break;
  }

  return messages;
}

export async function fetchVoiceChannelData(channel: VoiceChannel): Promise<VoiceChannelData> {
  return {
    type: channel.type,
    name: channel.name,
    bitrate: channel.bitrate ?? 64000,
    userLimit: channel.userLimit ?? 0,
    position: channel.position ?? 0,
    parent: channel.parent ? channel.parent.name : null,
    permissions: fetchChannelPermissions(channel),
  };
}

export async function fetchTextChannelData(
  channel: TextChannel | NewsChannel,
  options: CreateOptions
): Promise<TextChannelData> {
  const channelData: TextChannelData = {
    type: channel.type,
    name: channel.name,
    nsfw: Boolean(channel.nsfw),
    position: channel.position ?? 0,
    rateLimitPerUser: channel.type === "GUILD_TEXT" ? channel.rateLimitPerUser : undefined,
    parent: channel.parent ? channel.parent.name : null,
    topic: channel.topic ?? null,
    permissions: fetchChannelPermissions(channel),
    messages: [],
    isNews: channel.type === "GUILD_NEWS",
    threads: [],
  };

  if (channel.threads?.cache && channel.threads.cache.size > 0) {
    for (const thread of channel.threads.cache.values()) {
      const threadData: ThreadChannelData = {
        type: thread.type,
        name: thread.name,
        archived: Boolean(thread.archived),
        autoArchiveDuration: thread.autoArchiveDuration ?? 1440,
        locked: Boolean(thread.locked),
        rateLimitPerUser: thread.rateLimitPerUser ?? 0,
        messages: [],
      };
      if ((options.maxMessagesPerChannel ?? 0) > 0) {
        threadData.messages = await fetchChannelMessages(thread, options);
      }
      channelData.threads.push(threadData);
    }
  }

  if ((options.maxMessagesPerChannel ?? 0) > 0) {
    channelData.messages = await fetchChannelMessages(channel, options);
  }

  return channelData;
}

function isHiddenChannelName(name?: string | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  return normalized === "___hidden___" || normalized.includes("___hidden___");
}

function isTextLikeChannel(type: string): boolean {
  return type === "GUILD_TEXT" || type === "GUILD_NEWS";
}

function isVoiceLikeChannel(type: string): boolean {
  return type === "GUILD_VOICE" || type === "GUILD_STAGE_VOICE";
}

export async function getChannels(guild: Guild, options: CreateOptions): Promise<ChannelsData> {
  const channels: ChannelsData = {
    categories: [],
    others: [],
  };

  const allChannels = [...guild.channels.cache.values()];
  const ignoredTypes = new Set([
    "GUILD_CATEGORY",
    "GUILD_STORE",
    "GUILD_NEWS_THREAD",
    "GUILD_PRIVATE_THREAD",
    "GUILD_PUBLIC_THREAD",
  ]);

  const skipHidden = options.ignoreHiddenChannels !== false;

  const categories = allChannels
    .filter((ch): ch is CategoryChannel => ch.type === "GUILD_CATEGORY")
    .filter((ch) => !(skipHidden && isHiddenChannelName(ch.name)))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const category of categories) {
    const categoryData: CategoryData = {
      name: category.name,
      position: category.position ?? 0,
      permissions: fetchChannelPermissions(category),
      children: [],
    };

    // Safely collect child channels by parentId (works across all discord.js-selfbot-v13 versions)
    const children = allChannels
      .filter(
        (ch): ch is Exclude<GuildChannel, ThreadChannel> =>
          !ignoredTypes.has(ch.type) &&
          "parentId" in ch &&
          ch.parentId === category.id &&
          !(skipHidden && isHiddenChannelName(ch.name))
      )
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    for (const child of children) {
      if (isTextLikeChannel(child.type)) {
        categoryData.children.push(await fetchTextChannelData(child as TextChannel, options));
      } else if (isVoiceLikeChannel(child.type)) {
        categoryData.children.push(await fetchVoiceChannelData(child as VoiceChannel));
      }
    }
    channels.categories.push(categoryData);
  }

  const others = allChannels
    .filter(
      (ch): ch is Exclude<GuildChannel, ThreadChannel> =>
        !ignoredTypes.has(ch.type) &&
        (!("parentId" in ch) || !ch.parentId) &&
        !(skipHidden && isHiddenChannelName(ch.name))
    )
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const channel of others) {
    if (isTextLikeChannel(channel.type)) {
      channels.others.push(await fetchTextChannelData(channel as TextChannel, options));
    } else if (isVoiceLikeChannel(channel.type)) {
      channels.others.push(await fetchVoiceChannelData(channel as VoiceChannel));
    }
  }

  return channels;
}
