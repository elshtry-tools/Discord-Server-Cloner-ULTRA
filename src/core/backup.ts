import type { Guild } from "discord.js-selfbot-v13";
import { SnowflakeUtil } from "discord.js-selfbot-v13";
import { existsSync, mkdirSync } from "fs";
import { readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import gradient from "gradient-string";
import type {
  BackupData,
  BackupSummary,
  CreateOptions,
  LoadOptions,
  RestoreStats,
} from "../types";
import { t } from "../utils/i18n";
import { SessionLogger } from "../utils/logger";
import { RateLimitMonitor } from "./rateLimit";
import * as createMaster from "./create";
import * as loadMaster from "./load";

let backupsDir = path.resolve(process.cwd(), "backups");

function ensureBackupsDir(): void {
  if (!existsSync(backupsDir)) {
    mkdirSync(backupsDir, { recursive: true });
  }
}

export function getStorageFolder(): string {
  ensureBackupsDir();
  return backupsDir;
}

function getBackupFilePath(backupId: string): string {
  const safeId = backupId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(getStorageFolder(), `${safeId}.json`);
}

export async function getBackupData(backupId: string): Promise<BackupData> {
  const filePath = getBackupFilePath(backupId);
  if (!existsSync(filePath)) {
    throw new Error(`Backup '${backupId}' not found.`);
  }
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as BackupData;
  if (!parsed.stickers) parsed.stickers = [];
  return parsed;
}

export function countBackupChannels(data: BackupData): number {
  const inCats = data.channels.categories.reduce((sum, c) => sum + c.children.length, 0);
  return inCats + data.channels.others.length;
}

export async function listBackups(): Promise<BackupSummary[]> {
  ensureBackupsDir();
  const files = await readdir(backupsDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const results: BackupSummary[] = [];

  for (const file of jsonFiles) {
    try {
      const fullPath = path.join(backupsDir, file);
      const [raw, fileStat] = await Promise.all([readFile(fullPath, "utf-8"), stat(fullPath)]);
      const parsed = JSON.parse(raw) as BackupData;
      results.push({
        id: file.replace(/\.json$/, ""),
        name: parsed.name || "Unknown",
        sizeKb: Number((fileStat.size / 1024).toFixed(2)),
        createdAt: parsed.createdTimestamp
          ? new Date(parsed.createdTimestamp).toLocaleString()
          : "Unknown",
        rolesCount: parsed.roles?.length ?? 0,
        categoriesCount: parsed.channels?.categories?.length ?? 0,
        channelsCount: countBackupChannels(parsed),
        emojisCount: parsed.emojis?.length ?? 0,
        stickersCount: parsed.stickers?.length ?? 0,
      });
    } catch {
      // Skip malformed JSON files
    }
  }

  return results;
}

export async function removeBackup(backupId: string): Promise<void> {
  const filePath = getBackupFilePath(backupId);
  if (!existsSync(filePath)) {
    throw new Error(`Backup '${backupId}' not found.`);
  }
  await unlink(filePath);
}

export async function createBackup(
  guild: Guild,
  options: CreateOptions = {}
): Promise<BackupData> {
  const skipSet = new Set((options.doNotBackup ?? []).map((s) => s.toLowerCase().trim()));
  const backupId = options.backupID || SnowflakeUtil.generate(Date.now());

  const backupData: BackupData = {
    version: "5.3.0",
    name: guild.name,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    afk: guild.afkChannel
      ? { name: guild.afkChannel.name, timeout: guild.afkTimeout }
      : null,
    systemChannel: guild.systemChannel
      ? { name: guild.systemChannel.name, flags: guild.systemChannelFlags?.bitfield ?? 0 }
      : null,
    widget: {
      enabled: Boolean(guild.widgetEnabled),
      channel: guild.widgetChannel ? guild.widgetChannel.name : null,
    },
    channels: { categories: [], others: [] },
    roles: [],
    bans: [],
    emojis: [],
    stickers: [],
    createdTimestamp: Date.now(),
    guildID: guild.id,
    id: backupId,
  };

  const iconUrl = guild.iconURL({ dynamic: true, size: 1024 });
  if (iconUrl) {
    backupData.iconURL = iconUrl;
    if (options.saveImages === "base64") {
      backupData.iconBase64 = await createMaster.fetchUrlAsBase64(iconUrl);
    }
  }

  const splashUrl = guild.splashURL({ size: 1024 });
  if (splashUrl) {
    backupData.splashURL = splashUrl;
    if (options.saveImages === "base64") {
      backupData.splashBase64 = await createMaster.fetchUrlAsBase64(splashUrl);
    }
  }

  const bannerUrl = guild.bannerURL({ size: 1024 });
  if (bannerUrl) {
    backupData.bannerURL = bannerUrl;
    if (options.saveImages === "base64") {
      backupData.bannerBase64 = await createMaster.fetchUrlAsBase64(bannerUrl);
    }
  }

  if (!skipSet.has("roles")) {
    backupData.roles = await createMaster.getRoles(guild);
  }
  if (!skipSet.has("emojis")) {
    backupData.emojis = await createMaster.getEmojis(guild, options);
  }
  if (!skipSet.has("stickers")) {
    backupData.stickers = await createMaster.getStickers(guild, options);
  }
  if (!skipSet.has("channels")) {
    backupData.channels = await createMaster.getChannels(guild, options);
  }
  if (!skipSet.has("bans")) {
    backupData.bans = await createMaster.getBans(guild);
  }

  if (options.jsonSave !== false) {
    ensureBackupsDir();
    const jsonText =
      options.jsonBeautify !== false
        ? JSON.stringify(backupData, null, 2)
        : JSON.stringify(backupData);
    await writeFile(getBackupFilePath(backupId), jsonText, "utf-8");
  }

  return backupData;
}

export async function loadBackup(
  backup: string | BackupData,
  guild: Guild,
  options: LoadOptions = {}
): Promise<RestoreStats> {
  if (!guild) {
    throw new Error("Invalid target guild.");
  }

  const logger = new SessionLogger(`clone-${guild.id}`);
  const startTime = process.hrtime.bigint();
  const stats: RestoreStats = {
    rolesCreated: 0,
    rolesSkipped: 0,
    categoriesCreated: 0,
    categoriesSkipped: 0,
    channelsCreated: 0,
    channelsSkipped: 0,
    emojisCreated: 0,
    emojisSkipped: 0,
    stickersCreated: 0,
    stickersSkipped: 0,
    bansRestored: 0,
    messagesCloned: 0,
    errors: 0,
    durationSeconds: 0,
    logFilePath: logger.filePath,
  };

  const backupData: BackupData =
    typeof backup === "string" ? await getBackupData(backup) : backup;
  const skipSet = new Set((options.doNotRestore ?? []).map((s) => s.toLowerCase().trim()));

  logger.write("INFO", `Restoring '${backupData.name}' into target '${guild.name}' (${guild.id})`);
  const monitor = new RateLimitMonitor(guild.client);
  const onlySet = options.onlyPhases && options.onlyPhases.length > 0
    ? new Set(options.onlyPhases.map((p) => p.toLowerCase()))
    : null;
  const shouldRun = (phase: string) =>
    !skipSet.has(phase) && (!onlySet || onlySet.has(phase));

  try {
    // 1. Optional clear
    if (options.clearGuildBeforeRestore !== false && !onlySet) {
      await loadMaster.clearGuild(guild, options, stats, logger, monitor);
    }

    // 2. Server metadata & settings
    if (!onlySet || onlySet.has("config")) {
      console.log(gradient(["#00c6ff", "#0072ff"])(t("phaseConfig")));
      await loadMaster.loadConfig(guild, backupData, options, logger);
    }

    // 3. Roles FIRST (hierarchy order + roleMap)
    let roleMap = new Map<string, string>();
    if (shouldRun("roles") && backupData.roles.length > 0) {
      roleMap = await loadMaster.loadRoles(guild, backupData, options, stats, logger, monitor);
    }

    // 4. Categories, channels & permissions
    if (shouldRun("channels")) {
      await loadMaster.loadChannels(guild, backupData, roleMap, options, stats, logger, monitor);
    }

    // 5. Emojis & Stickers (with real-time Rate-Limit interception!)
    if (shouldRun("emojis") && backupData.emojis.length > 0) {
      await loadMaster.loadEmojis(guild, backupData, options, stats, logger, monitor);
    }
    if (shouldRun("stickers") && (backupData.stickers?.length ?? 0) > 0) {
      await loadMaster.loadStickers(guild, backupData, options, stats, logger, monitor);
    }

    // 6. AFK, System Channel, Widget & Bans
    if (!onlySet || onlySet.has("extras")) {
      console.log(gradient(["#00c6ff", "#0072ff"])(t("phaseExtras")));
      await loadMaster.loadAFK(guild, backupData, logger);
      await loadMaster.loadSystemChannel(guild, backupData, logger);
      await loadMaster.loadEmbedChannel(guild, backupData, logger);
    }

    if (shouldRun("bans") && backupData.bans.length > 0) {
      await loadMaster.loadBans(guild, backupData, options, stats, logger, monitor);
    }
  } finally {
    monitor.dispose();
  }

  const elapsedNs = process.hrtime.bigint() - startTime;
  stats.durationSeconds = Number(elapsedNs) / 1e9;
  logger.write("INFO", `Completed in ${stats.durationSeconds.toFixed(2)}s with ${stats.errors} errors.`);
  return stats;
}

export default {
  create: createBackup,
  load: loadBackup,
  get: getBackupData,
  list: listBackups,
  remove: removeBackup,
  countChannels: countBackupChannels,
};
