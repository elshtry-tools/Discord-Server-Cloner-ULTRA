import type {
  CategoryChannel,
  Guild,
  GuildChannel,
  GuildChannelCreateOptions,
  Message,
  OverwriteData,
  Role,
  TextChannel,
  ThreadChannel,
  VoiceChannel,
} from "discord.js-selfbot-v13";
import type {
  BackupData,
  ChannelPermissionsData,
  LoadOptions,
  MessageData,
  RestoreStats,
  TextChannelData,
  VoiceChannelData,
} from "../types";
import { t } from "../utils/i18n";
import { ProgressBar, type SessionLogger } from "../utils/logger";
import { executeWithRetry, RateLimitMonitor, sleep } from "./rateLimit";

const MAX_BITRATE_BY_TIER: Record<string, number> = {
  NONE: 96000,
  TIER_1: 128000,
  TIER_2: 256000,
  TIER_3: 384000,
  "0": 96000,
  "1": 128000,
  "2": 256000,
  "3": 384000,
};

export const MAX_EMOJIS_BY_TIER: Record<string, number> = {
  NONE: 50,
  TIER_1: 100,
  TIER_2: 150,
  TIER_3: 250,
  "0": 50,
  "1": 100,
  "2": 150,
  "3": 250,
};

export const MAX_STICKERS_BY_TIER: Record<string, number> = {
  NONE: 5,
  TIER_1: 15,
  TIER_2: 30,
  TIER_3: 60,
  "0": 5,
  "1": 15,
  "2": 30,
  "3": 60,
};

const TICKET_PREFIXES = ["ticket-", "closed-", "transcript-"];

export function getMaxBitrate(guild: Guild): number {
  const tierKey = String(guild.premiumTier ?? "NONE");
  return MAX_BITRATE_BY_TIER[tierKey] ?? 96000;
}

export function getMaxEmojis(guild: Guild): number {
  const tierKey = String(guild.premiumTier ?? "NONE");
  return MAX_EMOJIS_BY_TIER[tierKey] ?? 50;
}

export function getMaxStickers(guild: Guild): number {
  const tierKey = String(guild.premiumTier ?? "NONE");
  return MAX_STICKERS_BY_TIER[tierKey] ?? 5;
}

function resolvePermissionOverwrites(
  permissions: ChannelPermissionsData[],
  guild: Guild,
  roleMap: Map<string, string>
): OverwriteData[] {
  const overwrites: OverwriteData[] = [];
  const seenIds = new Set<string>();

  for (const perm of permissions) {
    let targetRoleId: string | undefined;

    if (perm.roleName === "@everyone") {
      targetRoleId = guild.id;
    } else if (perm.roleId && roleMap.has(perm.roleId)) {
      targetRoleId = roleMap.get(perm.roleId);
    } else {
      const matched = guild.roles.cache.find((r) => r.name === perm.roleName);
      if (matched) targetRoleId = matched.id;
    }

    if (targetRoleId && !seenIds.has(targetRoleId)) {
      seenIds.add(targetRoleId);
      overwrites.push({
        id: targetRoleId,
        allow: BigInt(perm.allow),
        deny: BigInt(perm.deny),
      });
    }
  }
  return overwrites;
}

async function runGuardedWrite<T>(
  phase: string,
  itemLabel: string,
  op: () => Promise<T>,
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger,
  monitor?: RateLimitMonitor
): Promise<{ skippedPhase: boolean; value?: T }> {
  const debug = Boolean(options.debug);
  if (!monitor) {
    const val = await executeWithRetry(op, { retries: 2, label: `${phase}:${itemLabel}`, debug });
    return { skippedPhase: false, value: val };
  }

  const res = await monitor.runWithGuard(op, 12000);
  if (res.status === "ok") {
    return { skippedPhase: false, value: res.value };
  }

  process.stdout.write("\n");
  logger.write(
    "WARN",
    `Discord Rate-Limit detected in phase '${phase}' (~${Math.ceil(res.timeoutMs / 1000)}s) on ${itemLabel}`
  );

  const decision = options.onRateLimit
    ? await options.onRateLimit({
        phase,
        timeoutMs: res.timeoutMs,
        path: res.path,
        global: res.global,
      })
    : "skip";

  if (decision === "skip") {
    if (phase !== "clear") {
      stats.rateLimitedPhases = Array.from(new Set([...(stats.rateLimitedPhases ?? []), phase]));
      stats.rateLimitUntil = Math.max(stats.rateLimitUntil ?? 0, Date.now() + res.timeoutMs);
    }
    return { skippedPhase: true };
  }

  const waitedValue = await res.pendingPromise;
  return { skippedPhase: false, value: waitedValue };
}

export async function clearGuild(
  guild: Guild,
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger,
  monitor?: RateLimitMonitor
): Promise<void> {
  const delayMs = options.delayMs ?? 350;
  const debug = Boolean(options.debug);

  const channels = [...guild.channels.cache.values()];
  const roles = [...guild.roles.cache.filter((r) => !r.managed && r.editable && r.id !== guild.id).values()];
  const emojis = [...guild.emojis.cache.values()];
  const stickers = [...guild.stickers.cache.values()];
  const totalItems = channels.length + roles.length + emojis.length + stickers.length;
  const bar = new ProgressBar(totalItems, t("phaseClear"));
  bar.render("Starting...");

  let clearAborted = false;
  for (const channel of channels) {
    if (clearAborted) break;
    try {
      const g = await runGuardedWrite("clear", channel.name, () => channel.delete(), options, stats, logger, monitor);
      if (g.skippedPhase) { clearAborted = true; break; }
      logger.write("OK", `Deleted channel: ${channel.name}`);
      await sleep(delayMs);
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed to delete channel ${channel.name}: ${err?.message ?? err}`);
    }
    bar.tick(channel.name);
  }

  for (const role of roles) {
    if (clearAborted) break;
    try {
      const g = await runGuardedWrite("clear", role.name, () => role.delete(), options, stats, logger, monitor);
      if (g.skippedPhase) { clearAborted = true; break; }
      logger.write("OK", `Deleted role: ${role.name}`);
      await sleep(delayMs);
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed to delete role ${role.name}: ${err?.message ?? err}`);
    }
    bar.tick(role.name);
  }

  for (const emoji of emojis) {
    if (clearAborted) break;
    try {
      const g = await runGuardedWrite("clear", emoji.name ?? "emoji", () => emoji.delete(), options, stats, logger, monitor);
      if (g.skippedPhase) { clearAborted = true; break; }
      logger.write("OK", `Deleted emoji: ${emoji.name}`);
      await sleep(delayMs);
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed to delete emoji ${emoji.name}: ${err?.message ?? err}`);
    }
    bar.tick(emoji.name ?? "emoji");
  }

  for (const sticker of stickers) {
    try {
      await executeWithRetry(() => sticker.delete(), {
        retries: 2,
        label: `delete sticker ${sticker.name}`,
        debug,
      });
      logger.write("OK", `Deleted sticker: ${sticker.name}`);
      await sleep(delayMs);
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed to delete sticker ${sticker.name}: ${err?.message ?? err}`);
    }
    bar.tick(sticker.name);
  }

  bar.finish();

  try {
    const webhooks = await guild.fetchWebhooks();
    for (const webhook of webhooks.values()) {
      await webhook.delete().catch(() => {});
      await sleep(delayMs);
    }
  } catch {
    // Missing Manage Webhooks is non-fatal
  }

  const resetOps: Array<() => Promise<unknown>> = [
    () => guild.setAFKChannel(null),
    () => guild.setAFKTimeout(300),
    () => guild.setIcon(null),
    () => guild.setBanner(null),
    () => guild.setSplash(null),
    () => guild.setDefaultMessageNotifications("ONLY_MENTIONS"),
    () => guild.setWidgetSettings({ enabled: false, channel: null }),
    () => guild.setSystemChannel(null),
  ];

  if (!guild.features.includes("COMMUNITY")) {
    resetOps.push(
      () => guild.setExplicitContentFilter("DISABLED"),
      () => guild.setVerificationLevel("NONE")
    );
  }

  for (const op of resetOps) {
    await op().catch(() => {});
  }
}

export async function loadConfig(
  guild: Guild,
  backupData: BackupData,
  options: LoadOptions,
  logger: SessionLogger
): Promise<void> {
  const debug = Boolean(options.debug);
  const ops: Array<{ label: string; fn: () => Promise<unknown> }> = [];

  if (backupData.name) {
    ops.push({ label: "setName", fn: () => guild.setName(backupData.name) });
  }
  if (backupData.iconBase64) {
    ops.push({
      label: "setIcon(base64)",
      fn: () => guild.setIcon(Buffer.from(backupData.iconBase64!, "base64")),
    });
  } else if (backupData.iconURL) {
    ops.push({ label: "setIcon(url)", fn: () => guild.setIcon(backupData.iconURL!) });
  }
  if (backupData.splashBase64) {
    ops.push({
      label: "setSplash(base64)",
      fn: () => guild.setSplash(Buffer.from(backupData.splashBase64!, "base64")),
    });
  } else if (backupData.splashURL) {
    ops.push({ label: "setSplash(url)", fn: () => guild.setSplash(backupData.splashURL!) });
  }
  if (backupData.bannerBase64) {
    ops.push({
      label: "setBanner(base64)",
      fn: () => guild.setBanner(Buffer.from(backupData.bannerBase64!, "base64")),
    });
  } else if (backupData.bannerURL) {
    ops.push({ label: "setBanner(url)", fn: () => guild.setBanner(backupData.bannerURL!) });
  }
  if (backupData.verificationLevel) {
    ops.push({
      label: "setVerificationLevel",
      fn: () => guild.setVerificationLevel(backupData.verificationLevel),
    });
  }
  if (backupData.defaultMessageNotifications !== undefined) {
    ops.push({
      label: "setDefaultMessageNotifications",
      fn: () => guild.setDefaultMessageNotifications(backupData.defaultMessageNotifications),
    });
  }
  if (backupData.explicitContentFilter && guild.features.includes("COMMUNITY")) {
    ops.push({
      label: "setExplicitContentFilter",
      fn: () => guild.setExplicitContentFilter(backupData.explicitContentFilter),
    });
  }

  for (const op of ops) {
    try {
      await executeWithRetry(op.fn, { retries: 2, label: op.label, debug });
      logger.write("OK", `Config applied: ${op.label}`);
      await sleep(options.delayMs ?? 350);
    } catch (err: any) {
      logger.write("WARN", `Config skipped (${op.label}): ${err?.message ?? err}`);
    }
  }
}

export async function loadRoles(
  guild: Guild,
  backupData: BackupData,
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger,
  monitor?: RateLimitMonitor
): Promise<Map<string, string>> {
  const roleMap = new Map<string, string>();
  const delayMs = options.delayMs ?? 350;
  const debug = Boolean(options.debug);
  const skipExisting = Boolean(options.skipExisting && options.clearGuildBeforeRestore === false);

  const orderedRoles = [...backupData.roles].sort((a, b) => a.position - b.position);
  const bar = new ProgressBar(orderedRoles.length, t("phaseRoles"));
  bar.render("Starting...");

  for (const roleData of orderedRoles) {
    try {
      if (roleData.isEveryone) {
        const everyoneRole = guild.roles.cache.get(guild.id);
        if (everyoneRole) {
          await executeWithRetry(
            () =>
              everyoneRole.edit({
                permissions: BigInt(roleData.permissions),
                mentionable: roleData.mentionable,
              }),
            { retries: 2, label: "edit @everyone", debug }
          );
          if (roleData.id) roleMap.set(roleData.id, everyoneRole.id);
          logger.write("OK", "Updated @everyone permissions");
        }
      } else {
        const existingRole = skipExisting
          ? guild.roles.cache.find((r) => r.name === roleData.name && !r.managed)
          : undefined;

        if (existingRole) {
          if (roleData.id) roleMap.set(roleData.id, existingRole.id);
          stats.rolesSkipped++;
          logger.write("SKIP", `Role already exists: ${roleData.name}`);
        } else {
          const rolePayload: any = {
            name: roleData.name,
            hoist: roleData.hoist,
            permissions: BigInt(roleData.permissions),
            mentionable: roleData.mentionable,
          };
          if (roleData.color && roleData.color !== "#000000") {
            rolePayload.colors = { primaryColor: roleData.color };
          }
          const guardRes = await runGuardedWrite<Role>(
            "roles",
            roleData.name,
            () => guild.roles.create(rolePayload),
            options,
            stats,
            logger,
            monitor
          );
          if (guardRes.skippedPhase) {
            break;
          }
          const createdRole = guardRes.value!;
          if (roleData.id) roleMap.set(roleData.id, createdRole.id);
          stats.rolesCreated++;
          logger.write("OK", `Created role: ${createdRole.name}`);
          await sleep(delayMs);
        }
      }
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed role ${roleData.name}: ${err?.message ?? err}`);
    }
    bar.tick(roleData.name);
  }

  bar.finish();
  return roleMap;
}

async function restoreChannelMessages(
  channel: TextChannel | ThreadChannel,
  messages: MessageData[],
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger
): Promise<void> {
  const maxMsgs = options.maxMessagesPerChannel ?? 0;
  if (maxMsgs <= 0 || messages.length === 0) return;

  const isThread = "parent" in channel && channel.isThread();
  const webhookTarget = isThread ? (channel.parent as TextChannel | null) : (channel as TextChannel);
  if (!webhookTarget || typeof webhookTarget.createWebhook !== "function") return;

  let webhook: Awaited<ReturnType<TextChannel["createWebhook"]>> | null = null;
  try {
    webhook = await webhookTarget.createWebhook("ClonerRestore", {
      avatar: channel.client.user?.displayAvatarURL(),
    });

    const validMessages = messages
      .filter(
        (m) =>
          (m.content && m.content.length > 0) ||
          (m.embeds && m.embeds.length > 0) ||
          (m.files && m.files.length > 0)
      )
      .reverse()
      .slice(-maxMsgs);

    for (const msg of validMessages) {
      try {
        const sent = await webhook.send({
          content: msg.content || undefined,
          username: msg.username || "User",
          avatarURL: msg.avatar,
          embeds: msg.embeds,
          files: msg.files,
          allowedMentions: options.allowedMentions ?? { parse: [] },
          ...(isThread ? { threadId: channel.id } : {}),
        });
        stats.messagesCloned++;
        if (msg.pinned && sent && "pin" in sent) {
          await (sent as Message).pin().catch(() => {});
        }
        await sleep(Math.max(250, options.delayMs ?? 350));
      } catch (err: any) {
        stats.errors++;
        logger.write("WARN", `Message restore failed in #${channel.name}: ${err?.message ?? err}`);
      }
    }
  } catch (err: any) {
    logger.write("WARN", `Webhook failed in #${channel.name}: ${err?.message ?? err}`);
  } finally {
    if (webhook) {
      await webhook.delete().catch(() => {});
    }
  }
}

async function createSingleChannel(
  channelData: TextChannelData | VoiceChannelData,
  guild: Guild,
  roleMap: Map<string, string>,
  category: CategoryChannel | null,
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger,
  monitor?: RateLimitMonitor
): Promise<{ channel: GuildChannel | null; rateLimited: boolean }> {
  const delayMs = options.delayMs ?? 350;
  const debug = Boolean(options.debug);
  const skipExisting = Boolean(options.skipExisting && options.clearGuildBeforeRestore === false);

  if (
    options.ignoreHiddenChannels !== false &&
    channelData.name.toLowerCase().includes("___hidden___")
  ) {
    stats.channelsSkipped++;
    logger.write("SKIP", `Ignored hidden channel: ${channelData.name}`);
    return { channel: null, rateLimited: false };
  }

  if (
    options.ignoreTickets &&
    TICKET_PREFIXES.some((prefix) => channelData.name.toLowerCase().startsWith(prefix))
  ) {
    stats.channelsSkipped++;
    logger.write("SKIP", `Ignored ticket channel: ${channelData.name}`);
    return { channel: null, rateLimited: false };
  }

  if (skipExisting) {
    const existing = guild.channels.cache.find(
      (ch) =>
        ch.name === channelData.name &&
        (category ? ch.parentId === category.id : !ch.parentId)
    );
    if (existing) {
      stats.channelsSkipped++;
      logger.write("SKIP", `Channel already exists: ${channelData.name}`);
      return { channel: existing as GuildChannel, rateLimited: false };
    }
  }

  const createOptions: GuildChannelCreateOptions = {
    parent: category?.id,
    permissionOverwrites: resolvePermissionOverwrites(channelData.permissions, guild, roleMap),
  };

  if (channelData.type === "GUILD_TEXT" || channelData.type === "GUILD_NEWS") {
    const textData = channelData as TextChannelData;
    createOptions.type =
      textData.isNews && guild.features.includes("NEWS") ? "GUILD_NEWS" : "GUILD_TEXT";
    if (textData.topic) createOptions.topic = textData.topic;
    createOptions.nsfw = Boolean(textData.nsfw);
    if (typeof textData.rateLimitPerUser === "number") {
      createOptions.rateLimitPerUser = textData.rateLimitPerUser;
    }
  } else if (channelData.type === "GUILD_VOICE" || channelData.type === "GUILD_STAGE_VOICE") {
    const voiceData = channelData as VoiceChannelData;
    const maxBitrate = getMaxBitrate(guild);
    const safeBitrate = Math.max(8000, Math.min(voiceData.bitrate || 64000, maxBitrate));

    createOptions.type =
      channelData.type === "GUILD_STAGE_VOICE" && guild.features.includes("COMMUNITY")
        ? "GUILD_STAGE_VOICE"
        : "GUILD_VOICE";
    createOptions.bitrate = safeBitrate;
    if (typeof voiceData.userLimit === "number" && voiceData.userLimit >= 0 && voiceData.userLimit <= 99) {
      createOptions.userLimit = voiceData.userLimit;
    }
  } else {
    createOptions.type = "GUILD_TEXT";
  }

  const chGuard = await runGuardedWrite<GuildChannel>(
    "channels",
    channelData.name,
    () => guild.channels.create(channelData.name, createOptions),
    options,
    stats,
    logger,
    monitor
  );
  if (chGuard.skippedPhase || !chGuard.value) {
    return { channel: null, rateLimited: true };
  }
  const created = chGuard.value;

  stats.channelsCreated++;
  logger.write("OK", `Created channel (${createOptions.type}): ${created.name}`);

  if (created.type === "GUILD_TEXT" || created.type === "GUILD_NEWS") {
    const textData = channelData as TextChannelData;

    if (textData.threads && textData.threads.length > 0) {
      for (const threadData of textData.threads) {
        try {
          const thread = await (created as TextChannel).threads.create({
            name: threadData.name,
            autoArchiveDuration: threadData.autoArchiveDuration,
          });
          if (threadData.messages?.length > 0 && (options.maxMessagesPerChannel ?? 0) > 0) {
            await restoreChannelMessages(thread, threadData.messages, options, stats, logger);
          }
          await sleep(delayMs);
        } catch (err: any) {
          logger.write("WARN", `Thread failed (${threadData.name}): ${err?.message ?? err}`);
        }
      }
    }

    if (textData.messages?.length > 0 && (options.maxMessagesPerChannel ?? 0) > 0) {
      await restoreChannelMessages(created as TextChannel, textData.messages, options, stats, logger);
    }
  }

  await sleep(delayMs);
  return { channel: created, rateLimited: false };
}

export async function loadChannels(
  guild: Guild,
  backupData: BackupData,
  roleMap: Map<string, string>,
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger,
  monitor?: RateLimitMonitor
): Promise<void> {
  const delayMs = options.delayMs ?? 350;
  const debug = Boolean(options.debug);
  const skipExisting = Boolean(options.skipExisting && options.clearGuildBeforeRestore === false);

  const totalCount =
    backupData.channels.others.length +
    backupData.channels.categories.reduce((sum, cat) => sum + 1 + cat.children.length, 0);
  const bar = new ProgressBar(totalCount, t("phaseChannels"));
  bar.render("Starting...");

  let channelsAborted = false;
  for (const channelData of backupData.channels.others) {
    if (channelsAborted) break;
    try {
      const r = await createSingleChannel(channelData, guild, roleMap, null, options, stats, logger, monitor);
      if (r.rateLimited) { channelsAborted = true; break; }
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed channel ${channelData.name}: ${err?.message ?? err}`);
    }
    bar.tick(channelData.name);
  }

  for (const categoryData of backupData.channels.categories) {
    if (channelsAborted) break;
    if (
      options.ignoreHiddenChannels !== false &&
      categoryData.name.toLowerCase().includes("___hidden___")
    ) {
      stats.categoriesSkipped++;
      stats.channelsSkipped += categoryData.children.length;
      logger.write("SKIP", `Ignored hidden category: ${categoryData.name}`);
      bar.tick(categoryData.name);
      for (const childData of categoryData.children) {
        bar.tick(childData.name);
      }
      continue;
    }
    let category: CategoryChannel | null = null;
    try {
      const existingCat = skipExisting
        ? (guild.channels.cache.find(
            (ch) => ch.type === "GUILD_CATEGORY" && ch.name === categoryData.name
          ) as CategoryChannel | undefined)
        : undefined;

      if (existingCat) {
        category = existingCat;
        stats.categoriesSkipped++;
        logger.write("SKIP", `Category already exists: ${categoryData.name}`);
      } else {
        const catGuard = await runGuardedWrite<CategoryChannel>(
          "channels",
          categoryData.name,
          () =>
            guild.channels.create(categoryData.name, {
              type: "GUILD_CATEGORY",
              permissionOverwrites: resolvePermissionOverwrites(
                categoryData.permissions,
                guild,
                roleMap
              ),
            }) as Promise<CategoryChannel>,
          options,
          stats,
          logger,
          monitor
        );
        if (catGuard.skippedPhase || !catGuard.value) {
          channelsAborted = true;
          break;
        }
        category = catGuard.value;
        stats.categoriesCreated++;
        logger.write("OK", `Created category: ${category.name}`);
        await sleep(delayMs);
      }
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed category ${categoryData.name}: ${err?.message ?? err}`);
    }
    bar.tick(categoryData.name);

    for (const childData of categoryData.children) {
      if (channelsAborted) break;
      try {
        const r = await createSingleChannel(childData, guild, roleMap, category, options, stats, logger, monitor);
        if (r.rateLimited) { channelsAborted = true; break; }
      } catch (err: any) {
        stats.errors++;
        logger.write("ERROR", `Failed child channel ${childData.name}: ${err?.message ?? err}`);
      }
      bar.tick(childData.name);
    }
  }

  bar.finish();
}

export async function loadAFK(
  guild: Guild,
  backupData: BackupData,
  logger: SessionLogger
): Promise<void> {
  if (!backupData.afk) return;
  try {
    const afkChannel = guild.channels.cache.find(
      (ch) => ch.name === backupData.afk!.name && ch.type === "GUILD_VOICE"
    ) as VoiceChannel | undefined;
    if (afkChannel) {
      await guild.setAFKChannel(afkChannel);
      logger.write("OK", `Restored AFK channel: ${afkChannel.name}`);
    }
    if (backupData.afk.timeout) {
      await guild.setAFKTimeout(backupData.afk.timeout);
    }
  } catch (err: any) {
    logger.write("WARN", `AFK restore failed: ${err?.message ?? err}`);
  }
}

export async function loadSystemChannel(
  guild: Guild,
  backupData: BackupData,
  logger: SessionLogger
): Promise<void> {
  if (!backupData.systemChannel) return;
  try {
    const sysChan = guild.channels.cache.find(
      (ch) => ch.name === backupData.systemChannel!.name && ch.type === "GUILD_TEXT"
    ) as TextChannel | undefined;
    if (sysChan) {
      await guild.setSystemChannel(sysChan);
      await guild.setSystemChannelFlags(backupData.systemChannel.flags).catch(() => {});
      logger.write("OK", `Restored System channel: ${sysChan.name}`);
    }
  } catch (err: any) {
    logger.write("WARN", `System channel restore failed: ${err?.message ?? err}`);
  }
}

export async function loadEmbedChannel(
  guild: Guild,
  backupData: BackupData,
  logger: SessionLogger
): Promise<void> {
  if (!backupData.widget?.channel) return;
  try {
    const widgetChannel = guild.channels.cache.find((ch) => ch.name === backupData.widget.channel);
    if (widgetChannel) {
      await guild.setWidgetSettings({
        enabled: Boolean(backupData.widget.enabled),
        channel: widgetChannel as TextChannel,
      });
      logger.write("OK", `Restored Widget channel: ${widgetChannel.name}`);
    }
  } catch (err: any) {
    logger.write("WARN", `Widget restore failed: ${err?.message ?? err}`);
  }
}

export async function loadEmojis(
  guild: Guild,
  backupData: BackupData,
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger,
  monitor?: RateLimitMonitor
): Promise<void> {
  if (backupData.emojis.length === 0) return;

  const delayMs = Math.max(500, options.delayMs ?? 350);
  const debug = Boolean(options.debug);
  const skipExisting = Boolean(options.skipExisting && options.clearGuildBeforeRestore === false);
  const maxPerType = getMaxEmojis(guild);
  let staticCount = guild.emojis.cache.filter((e) => !e.animated).size;
  let animatedCount = guild.emojis.cache.filter((e) => Boolean(e.animated)).size;

  const bar = new ProgressBar(backupData.emojis.length, t("phaseEmojis"));
  bar.render("Starting...");

  for (const emoji of backupData.emojis) {
    const isAnimated = Boolean(emoji.animated ?? emoji.url?.endsWith(".gif"));
    if (skipExisting && guild.emojis.cache.some((e) => e.name === emoji.name)) {
      stats.emojisSkipped++;
      logger.write("SKIP", `Emoji already exists: ${emoji.name}`);
      bar.tick(emoji.name);
      continue;
    }

    if ((isAnimated && animatedCount >= maxPerType) || (!isAnimated && staticCount >= maxPerType)) {
      stats.emojisSkipped++;
      logger.write("SKIP", `Emoji tier limit reached, skipped: ${emoji.name}`);
      bar.tick(emoji.name);
      continue;
    }

    try {
      const source = emoji.base64 ? Buffer.from(emoji.base64, "base64") : emoji.url;
      if (!source) {
        bar.tick(emoji.name);
        continue;
      }

      const result = monitor
        ? await monitor.runWithGuard(() => guild.emojis.create(source, emoji.name), 12000)
        : {
            status: "ok" as const,
            value: await executeWithRetry(() => guild.emojis.create(source, emoji.name), {
              retries: 2,
              label: `create emoji ${emoji.name}`,
              debug,
            }),
          };

      if (result.status === "rate_limited") {
        process.stdout.write("\n");
        logger.write("WARN", `Discord Emoji Rate-Limit hit (~${Math.ceil(result.timeoutMs / 1000)}s) on ${emoji.name}`);
        const decision = options.onRateLimit
          ? await options.onRateLimit({
              phase: "emojis",
              timeoutMs: result.timeoutMs,
              path: result.path,
              global: result.global,
            })
          : "skip";

        if (decision === "skip") {
          stats.rateLimitedPhases = Array.from(new Set([...(stats.rateLimitedPhases ?? []), "emojis"]));
          stats.rateLimitUntil = Math.max(stats.rateLimitUntil ?? 0, Date.now() + result.timeoutMs);
          break;
        } else {
          await result.pendingPromise;
        }
      }

      if (isAnimated) animatedCount++;
      else staticCount++;

      stats.emojisCreated++;
      logger.write("OK", `Created emoji: ${emoji.name}`);
      await sleep(delayMs);
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed emoji ${emoji.name}: ${err?.message ?? err}`);
    }
    bar.tick(emoji.name);
  }

  bar.finish();
}

export async function loadStickers(
  guild: Guild,
  backupData: BackupData,
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger,
  monitor?: RateLimitMonitor
): Promise<void> {
  const stickers = backupData.stickers ?? [];
  if (stickers.length === 0) return;

  const delayMs = Math.max(500, options.delayMs ?? 350);
  const debug = Boolean(options.debug);
  const skipExisting = Boolean(options.skipExisting && options.clearGuildBeforeRestore === false);
  const maxStickers = getMaxStickers(guild);
  let currentCount = guild.stickers.cache.size;

  const bar = new ProgressBar(stickers.length, t("phaseStickers"));
  bar.render("Starting...");

  for (const sticker of stickers) {
    if (skipExisting && guild.stickers.cache.some((s) => s.name === sticker.name)) {
      stats.stickersSkipped++;
      logger.write("SKIP", `Sticker already exists: ${sticker.name}`);
      bar.tick(sticker.name);
      continue;
    }

    if (currentCount >= maxStickers) {
      stats.stickersSkipped++;
      logger.write("SKIP", `Sticker tier limit reached, skipped: ${sticker.name}`);
      bar.tick(sticker.name);
      continue;
    }

    try {
      const fileSource = sticker.base64
        ? Buffer.from(sticker.base64, "base64")
        : sticker.url;

      const createStickerOp = () =>
        guild.stickers.create(
          fileSource,
          sticker.name,
          sticker.tags || "sticker",
          { description: sticker.description ?? undefined }
        );

      const result = monitor
        ? await monitor.runWithGuard(createStickerOp, 12000)
        : {
            status: "ok" as const,
            value: await executeWithRetry(createStickerOp, {
              retries: 2,
              label: `create sticker ${sticker.name}`,
              debug,
            }),
          };

      if (result.status === "rate_limited") {
        process.stdout.write("\n");
        logger.write("WARN", `Discord Sticker Rate-Limit hit (~${Math.ceil(result.timeoutMs / 1000)}s) on ${sticker.name}`);
        const decision = options.onRateLimit
          ? await options.onRateLimit({
              phase: "stickers",
              timeoutMs: result.timeoutMs,
              path: result.path,
              global: result.global,
            })
          : "skip";

        if (decision === "skip") {
          stats.rateLimitedPhases = Array.from(new Set([...(stats.rateLimitedPhases ?? []), "stickers"]));
          stats.rateLimitUntil = Math.max(stats.rateLimitUntil ?? 0, Date.now() + result.timeoutMs);
          break;
        } else {
          await result.pendingPromise;
        }
      }

      currentCount++;
      stats.stickersCreated++;
      logger.write("OK", `Created sticker: ${sticker.name}`);
      await sleep(delayMs);
    } catch (err: any) {
      stats.errors++;
      logger.write("ERROR", `Failed sticker ${sticker.name}: ${err?.message ?? err}`);
    }
    bar.tick(sticker.name);
  }

  bar.finish();
}

export async function loadBans(
  guild: Guild,
  backupData: BackupData,
  options: LoadOptions,
  stats: RestoreStats,
  logger: SessionLogger,
  monitor?: RateLimitMonitor
): Promise<void> {
  const delayMs = options.delayMs ?? 350;
  const debug = Boolean(options.debug);

  for (const ban of backupData.bans) {
    try {
      const g = await runGuardedWrite(
        "bans",
        ban.id,
        () => guild.members.ban(ban.id, { reason: ban.reason ?? undefined }),
        options,
        stats,
        logger,
        monitor
      );
      if (g.skippedPhase) break;
      stats.bansRestored++;
      logger.write("OK", `Restored ban: ${ban.id}`);
      await sleep(delayMs);
    } catch (err: any) {
      stats.errors++;
      logger.write("WARN", `Failed ban ${ban.id}: ${err?.message ?? err}`);
    }
  }
}
