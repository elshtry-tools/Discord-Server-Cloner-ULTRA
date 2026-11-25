import boxen from "boxen";
import chalk from "chalk";
import type { Client, Guild } from "discord.js-selfbot-v13";
import gradient from "gradient-string";
import type readline from "readline";
import backup from "../core/backup";
import { clearGuild, getMaxEmojis, getMaxStickers } from "../core/load";
import { executeWithRetry, formatDuration, RateLimitMonitor, sleep } from "../core/rateLimit";
import { ProgressBar, SessionLogger } from "../utils/logger";
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from "../utils/resumeState";
import { listSavedAccounts, removeSavedAccount } from "../utils/accounts";
import type { BackupData, RestoreStats } from "../types";
import {
  applySpeedPreset,
  resetConfig,
  runtimeConfig,
  saveConfig,
} from "../utils/config";
import { t, toggleLang } from "../utils/i18n";

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

async function askYesNo(rl: readline.Interface, question: string): Promise<boolean> {
  const ans = await ask(
    rl,
    gradient(["#00c6ff", "#0072ff"])(question) +
      gradient(["#f7971e", "#ffd200"])(t("yesNoHint"))
  );
  return ans === "1" || ans.toLowerCase() === "y" || ans.toLowerCase() === "yes";
}

function maskSensitive(value: string | null | undefined): string {
  if (!value) return t("none");
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return value.length > 4 ? `${"*".repeat(value.length - 4)}${value.slice(-4)}` : "****";
}

export function printBanner(client?: Client): void {
  console.clear();
  console.log(
    gradient(["#00f5d4", "#00bbf9", "#9b5de5"])(`
   _____ ______ _______      ________ _____     _____ _      ____  _   _ ______ _____  
  / ____|  ____|  __ \\ \\    / /  ____|  __ \\   / ____| |    / __ \\| \\ | |  ____|  __ \\ 
 | (___ | |__  | |__) \\ \\  / /| |__  | |__) | | |    | |   | |  | |  \\| | |__  | |__) |
  \\___ \\|  __| |  _  / \\ \\/ / |  __| |  _  /  | |    | |   | |  | | . \` |  __| |  _  / 
  ____) | |____| | \\ \\  \\  /  | |____| | \\ \\  | |____| |___| |__| | |\\  | |____| | \\ \\ 
 |_____/|______|_|  \\_\\  \\/   |______|_|  \\_\\  \\_____|______\\____/|_| \\_|______|_|  \\_\\
                              ★  ULTRA EDITION  v5.3  ★
`)
  );
  if (client?.user) {
    const speedTag = chalk.magenta(`[${runtimeConfig.speedPreset.toUpperCase()} ${runtimeConfig.delayMs}ms]`);
    const modeTag = runtimeConfig.clearGuildBeforeRestore
      ? chalk.red("[WIPE]")
      : runtimeConfig.skipExisting
      ? chalk.green("[SMART SYNC]")
      : chalk.yellow("[APPEND]");
    console.log(
      chalk.gray(`  ${t("loggedInAs")}`) +
        chalk.cyan.bold(client.user.tag) +
        chalk.gray(` (${client.guilds.cache.size} servers)  `) +
        speedTag +
        " " +
        modeTag +
        "\n"
    );
  }
}

/**
 * Interactive Server Picker: displays numbered list of joined guilds with badges,
 * OR accepts a pasted 17-20 digit Server ID directly.
 */
async function pickServer(
  client: Client,
  rl: readline.Interface,
  title: string,
  onlyAdmin = false
): Promise<{ guild?: Guild; rawId: string } | null> {
  await client.guilds.fetch().catch(() => {});
  const allGuilds = [...client.guilds.cache.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const displayList = onlyAdmin
    ? allGuilds.filter(
        (g) => g.ownerId === client.user?.id || g.members?.me?.permissions?.has("ADMINISTRATOR")
      )
    : allGuilds;

  const listToShow = displayList.length > 0 ? displayList : allGuilds;
  const maxShow = 30;
  const lines = listToShow.slice(0, maxShow).map((g, idx) => {
    const num = chalk.cyan(`[${String(idx + 1).padStart(2, " ")}]`);
    const badge =
      g.ownerId === client.user?.id
        ? chalk.yellow(" [OWNER]")
        : g.members?.me?.permissions?.has("ADMINISTRATOR")
        ? chalk.green(" [ADMIN]")
        : "";
    const meta = chalk.gray(` (${g.memberCount} mem, ${g.channels.cache.size} ch)`);
    return `${num} ${chalk.white(g.name)}${badge}${meta}`;
  });

  if (listToShow.length > maxShow) {
    lines.push(chalk.gray(`  ... +${listToShow.length - maxShow} more (paste ID directly)`));
  }

  console.log(
    boxen(lines.join("\n") || chalk.gray(t("none")), {
      title,
      titleAlignment: "center",
      padding: 1,
      margin: { top: 0, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "cyan",
    })
  );

  const input = await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("pickerHint")));
  if (!input) return null;

  const indexNum = Number.parseInt(input, 10);
  if (
    /^\d{1,3}$/.test(input) &&
    !Number.isNaN(indexNum) &&
    indexNum >= 1 &&
    indexNum <= listToShow.length
  ) {
    const chosen = listToShow[indexNum - 1];
    return { guild: chosen, rawId: chosen.id };
  }

  return { guild: client.guilds.cache.get(input), rawId: input };
}

function renderStructureTree(data: BackupData): void {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan(`📦 ${data.name}`) + chalk.gray(` (${data.roles.length} roles, ${data.emojis.length} emojis, ${data.stickers?.length ?? 0} stickers)`));

  if (data.channels.others.length > 0) {
    lines.push(chalk.yellow("├─ [Uncategorized]"));
    for (const ch of data.channels.others) {
      const icon = ch.type === "GUILD_VOICE" || ch.type === "GUILD_STAGE_VOICE" ? "🔊" : ch.type === "GUILD_NEWS" ? "📣" : "#";
      lines.push(chalk.gray(`│  ├─ ${icon} ${ch.name}`));
    }
  }

  data.channels.categories.forEach((cat, idx) => {
    const isLastCat = idx === data.channels.categories.length - 1;
    const branch = isLastCat ? "└─" : "├─";
    const childPrefix = isLastCat ? "   " : "│  ";
    lines.push(chalk.magenta(`${branch} 📁 ${cat.name}`) + chalk.gray(` (${cat.children.length})`));
    cat.children.forEach((ch, cIdx) => {
      const cBranch = cIdx === cat.children.length - 1 ? "└─" : "├─";
      const icon = ch.type === "GUILD_VOICE" || ch.type === "GUILD_STAGE_VOICE" ? "🔊" : ch.type === "GUILD_NEWS" ? "📣" : "#";
      lines.push(chalk.gray(`${childPrefix}${cBranch} ${icon} ${ch.name}`));
    });
  });

  console.log(
    boxen(lines.join("\n"), {
      title: t("dryRunTitle"),
      titleAlignment: "center",
      padding: 1,
      margin: { top: 1, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "yellow",
    })
  );
}

function showPreFlightReport(data: BackupData, targetGuild: Guild | null): void {
  const channelCount = backup.countChannels(data);
  const totalOps =
    (runtimeConfig.clearGuildBeforeRestore && targetGuild
      ? targetGuild.channels.cache.size + targetGuild.roles.cache.size
      : 0) +
    data.roles.length +
    data.channels.categories.length +
    channelCount +
    data.emojis.length +
    (data.stickers?.length ?? 0);

  const estSeconds = Math.ceil((totalOps * (runtimeConfig.delayMs + 120)) / 1000);
  const modeLine = runtimeConfig.clearGuildBeforeRestore
    ? chalk.red(t("preflightModeClear"))
    : runtimeConfig.skipExisting
    ? chalk.green(t("preflightModeSync"))
    : chalk.yellow(t("preflightModeAppend"));

  const warnings: string[] = [];
  if (targetGuild) {
    if (
      targetGuild.ownerId !== targetGuild.client.user?.id &&
      !targetGuild.members?.me?.permissions?.has("ADMINISTRATOR")
    ) {
      warnings.push(chalk.yellow(t("preflightWarnNoAdmin")));
    }
    if (data.emojis.length > getMaxEmojis(targetGuild)) {
      warnings.push(chalk.yellow(t("preflightWarnEmojis")));
    }
    if ((data.stickers?.length ?? 0) > getMaxStickers(targetGuild)) {
      warnings.push(chalk.yellow(t("preflightWarnStickers")));
    }
    if ((data.bannerURL || data.splashURL) && String(targetGuild.premiumTier) === "NONE") {
      warnings.push(chalk.yellow(t("preflightWarnBanner")));
    }
  }

  const lines = [
    `${chalk.cyan("Source:")} ${chalk.bold.white(data.name)}`,
    `${chalk.cyan("Target:")} ${chalk.bold.white(targetGuild ? targetGuild.name : "New Server")}`,
    modeLine,
    `${chalk.cyan("Items:")} ${data.roles.length} Roles | ${data.channels.categories.length} Categories | ${channelCount} Channels | ${data.emojis.length} Emojis | ${data.stickers?.length ?? 0} Stickers`,
    `${chalk.cyan(t("preflightEstTime"))}${chalk.bold.white(formatDuration(estSeconds))} (${runtimeConfig.speedPreset.toUpperCase()} / ${runtimeConfig.delayMs}ms)`,
  ];

  if (warnings.length > 0) {
    lines.push("", ...warnings);
  }

  console.log(
    boxen(lines.join("\n"), {
      title: t("preflightTitle"),
      titleAlignment: "center",
      padding: 1,
      margin: { top: 1, bottom: 0, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: warnings.length > 0 ? "yellow" : "green",
    })
  );
}

function createRateLimitHandler(rl: readline.Interface) {
  return async (info: { phase: string; timeoutMs: number; path: string; global: boolean }): Promise<"skip" | "wait"> => {
    const secs = Math.max(10, Math.ceil(info.timeoutMs / 1000));
    const boxBody = [
      `${chalk.yellow.bold(t("rateLimitBody"))} ${chalk.white.bold(info.phase.toUpperCase())}`,
      `${chalk.cyan(t("rateLimitCooldown"))} ${chalk.bold.white(formatDuration(secs))}`,
    ].join("\n");

    console.log(
      boxen(boxBody, {
        title: t("rateLimitTitle"),
        titleAlignment: "center",
        padding: 1,
        margin: { top: 1, bottom: 0, left: 2, right: 2 },
        borderStyle: "round",
        borderColor: "yellow",
      })
    );

    const ans = await ask(rl, gradient(["#f7971e", "#ffd200"])(t("rateLimitPrompt")));
    if (ans === "2") {
      console.log(chalk.cyan(`\n${t("rateLimitWaiting")}`));
      return "wait";
    }
    return "skip";
  };
}

function handlePostRestoreCheckpoint(
  backupData: BackupData,
  targetGuild: Guild,
  stats: RestoreStats
): void {
  if (stats.rateLimitedPhases && stats.rateLimitedPhases.length > 0) {
    saveCheckpoint({
      backupId: backupData.id,
      sourceName: backupData.name,
      targetGuildId: targetGuild.id,
      targetGuildName: targetGuild.name,
      pendingPhases: stats.rateLimitedPhases,
      rateLimitUntil: stats.rateLimitUntil,
      accountUserId: targetGuild.client.user?.id,
      accountUsername: targetGuild.client.user?.tag,
      createdAt: Date.now(),
    });
    console.log(chalk.yellow.bold(`\n${t("rateLimitSkippedSaved")}`));
  }
}

function printStats(stats: RestoreStats): void {
  console.log("\n" + gradient(["#00f5d4", "#00bbf9"])(t("cloneCompleted")));
  console.log(chalk.white(`${t("statDuration")}${chalk.cyan(formatDuration(stats.durationSeconds))}`));
  console.log(chalk.white(`${t("statRoles")}${chalk.green(String(stats.rolesCreated))} / ${chalk.gray(String(stats.rolesSkipped))}`));
  console.log(chalk.white(`${t("statCategories")}${chalk.green(String(stats.categoriesCreated))} / ${chalk.gray(String(stats.categoriesSkipped))}`));
  console.log(chalk.white(`${t("statChannels")}${chalk.green(String(stats.channelsCreated))} / ${chalk.gray(String(stats.channelsSkipped))}`));
  console.log(chalk.white(`${t("statEmojis")}${chalk.green(String(stats.emojisCreated))} / ${chalk.gray(String(stats.emojisSkipped))}`));
  console.log(chalk.white(`${t("statStickers")}${chalk.green(String(stats.stickersCreated))} / ${chalk.gray(String(stats.stickersSkipped))}`));
  console.log(chalk.white(`${t("statMessages")}${chalk.cyan(String(stats.messagesCloned))}`));
  console.log(chalk.white(`${t("statBans")}${chalk.cyan(String(stats.bansRestored))}`));
  console.log(
    chalk.white(
      `${t("statErrors")}${stats.errors > 0 ? chalk.yellow(String(stats.errors)) : chalk.green("0")}`
    )
  );
  if (stats.logFilePath) {
    console.log(chalk.gray(`${t("statLogFile")}${stats.logFilePath}`));
  }
}

function printSettingsBox(): void {
  const skipText =
    runtimeConfig.doNotBackup.length > 0
      ? chalk.yellow(runtimeConfig.doNotBackup.join(", "))
      : chalk.gray(t("none"));

  const content = [
    `${chalk.cyan("•")} ${t("settingSpeed")}: ${chalk.magenta.bold(runtimeConfig.speedPreset.toUpperCase())} (${runtimeConfig.delayMs} ms)`,
    `${chalk.cyan("•")} ${t("settingClearTarget")}: ${runtimeConfig.clearGuildBeforeRestore ? chalk.red(t("yes")) : chalk.green(t("no"))}`,
    `${chalk.cyan("•")} ${t("settingSkipExisting")}: ${runtimeConfig.skipExisting ? chalk.green(t("yes")) : chalk.red(t("no"))}`,
    `${chalk.cyan("•")} ${t("settingMessages")}: ${chalk.bold.white(String(runtimeConfig.maxMessagesPerChannel))}`,
    `${chalk.cyan("•")} ${t("settingSaveJson")}: ${runtimeConfig.jsonSave ? chalk.green(t("yes")) : chalk.red(t("no"))}`,
    `${chalk.cyan("•")} ${t("settingBeautifyJson")}: ${runtimeConfig.jsonBeautify ? chalk.green(t("yes")) : chalk.red(t("no"))}`,
    `${chalk.cyan("•")} ${t("settingBase64")}: ${runtimeConfig.saveImagesBase64 ? chalk.green(t("yes")) : chalk.red(t("no"))}`,
    `${chalk.cyan("•")} ${t("settingDoNotBackup")}: ${skipText}`,
    `${chalk.cyan("•")} ${t("settingIgnoreTickets")}: ${runtimeConfig.ignoreTickets ? chalk.green(t("yes")) : chalk.red(t("no"))}`,
    `${chalk.cyan("•")} ${t("settingIgnoreHidden")}: ${runtimeConfig.ignoreHiddenChannels ? chalk.green(t("yes")) : chalk.red(t("no"))}`,
    `${chalk.cyan("•")} ${t("settingDebug")}: ${runtimeConfig.debug ? chalk.green(t("yes")) : chalk.red(t("no"))}`,
  ].join("\n");

  console.log(
    boxen(content, {
      title: t("settingsTitle"),
      titleAlignment: "center",
      padding: 1,
      margin: { top: 0, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "cyan",
    })
  );
}

async function handleCloneFlow(
  client: Client,
  rl: readline.Interface,
  mode: "existing" | "new" | "template"
): Promise<void> {
  printBanner(client);
  const srcPick = await pickServer(client, rl, t("sourceServerTitle"), false);
  if (!srcPick) return;

  const sourceGuild = srcPick.guild;
  if (!sourceGuild) {
    console.error(chalk.red(`\n${t("serverNotFound")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  let targetGuild: Guild | null = null;
  if (mode === "existing") {
    printBanner(client);
    const dstPick = await pickServer(client, rl, t("targetServerTitle"), true);
    if (!dstPick) return;
    if (dstPick.rawId === sourceGuild.id) {
      console.error(chalk.red(`\n${t("sameServerError")}`));
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
      return;
    }
    if (!dstPick.guild) {
      console.error(chalk.red(`\n${t("targetNotFound")}`));
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
      return;
    }
    targetGuild = dstPick.guild;
  }

  console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("backingUp")}`));
  let backupData: BackupData;
  try {
    backupData = await backup.create(sourceGuild, {
      maxMessagesPerChannel: runtimeConfig.maxMessagesPerChannel,
      jsonSave: runtimeConfig.jsonSave,
      jsonBeautify: runtimeConfig.jsonBeautify,
      doNotBackup: runtimeConfig.doNotBackup,
      saveImages: runtimeConfig.saveImagesBase64 ? "base64" : "",
      ignoreHiddenChannels: runtimeConfig.ignoreHiddenChannels,
    });
    if (runtimeConfig.jsonSave) {
      console.log(chalk.green(`${t("backupSaved")}${backupData.id}`));
    }
  } catch (err: any) {
    console.error(chalk.red(`\n${t("backupFailed")}${err?.message ?? err}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  // Pre-Flight Check & optional Dry-Run loop
  while (true) {
    showPreFlightReport(backupData, targetGuild);
    const decision = await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("preflightPrompt")));
    if (decision === "2") {
      renderStructureTree(backupData);
      continue;
    }
    if (decision !== "1") return;
    break;
  }

  if (mode !== "existing") {
    console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("creatingServer")}`));
    try {
      targetGuild = await client.guilds.create(sourceGuild.name || "Cloned Server");
    } catch (err) {
      console.error(chalk.red(`\n${t("createServerFailed")}`), runtimeConfig.debug ? err : "");
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
      return;
    }
  }

  if (!targetGuild) {
    console.error(chalk.red(`\n${t("targetNotFound")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("startingRestore")}\n`));
  try {
    const stats = await backup.load(backupData, targetGuild, {
      clearGuildBeforeRestore: mode === "existing" ? runtimeConfig.clearGuildBeforeRestore : true,
      skipExisting: runtimeConfig.skipExisting,
      maxMessagesPerChannel: runtimeConfig.maxMessagesPerChannel,
      delayMs: runtimeConfig.delayMs,
      ignoreTickets: runtimeConfig.ignoreTickets,
      ignoreHiddenChannels: runtimeConfig.ignoreHiddenChannels,
      debug: runtimeConfig.debug,
      doNotRestore: runtimeConfig.doNotBackup,
      onRateLimit: createRateLimitHandler(rl),
    });

    printStats(stats);
    handlePostRestoreCheckpoint(backupData, targetGuild, stats);

    if (mode === "template") {
      console.log(gradient(["#f7971e", "#ffd200"])(`\n${t("creatingTemplate")}`));
      try {
        const template = await targetGuild.createTemplate(
          sourceGuild.name.slice(0, 100),
          `Server template cloned from ${sourceGuild.name}`
        );
        console.log(chalk.yellow.bold(`${t("templateUrl")}${template.url}`));
      } catch (err: any) {
        console.warn(chalk.yellow(`${t("templateFailed")}${err?.message ?? err}`));
      }
    }
  } catch (err: any) {
    console.error(chalk.red(`\n${t("unexpectedError")}${err?.message ?? err}`));
  }

  await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
}

async function handleBackupOnly(client: Client, rl: readline.Interface): Promise<void> {
  printBanner(client);
  const pick = await pickServer(client, rl, t("sourceServerTitle"), false);
  if (!pick) return;
  if (!pick.guild) {
    console.error(chalk.red(`\n${t("serverNotFound")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("backingUp")}`));
  try {
    const data = await backup.create(pick.guild, {
      maxMessagesPerChannel: runtimeConfig.maxMessagesPerChannel,
      jsonSave: true,
      jsonBeautify: runtimeConfig.jsonBeautify,
      doNotBackup: runtimeConfig.doNotBackup,
      saveImages: runtimeConfig.saveImagesBase64 ? "base64" : "",
      ignoreHiddenChannels: runtimeConfig.ignoreHiddenChannels,
    });
    console.log(chalk.green(`\n${t("backupSaved")}${data.id}`));
  } catch (err: any) {
    console.error(chalk.red(`\n${t("backupFailed")}${err?.message ?? err}`));
  }

  await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
}

async function handleDryRunStandalone(client: Client, rl: readline.Interface): Promise<void> {
  printBanner(client);
  const pick = await pickServer(client, rl, t("sourceServerTitle"), false);
  if (!pick || !pick.guild) {
    if (pick) console.error(chalk.red(`\n${t("serverNotFound")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("backingUp")}`));
  const data = await backup.create(pick.guild, {
    maxMessagesPerChannel: 0,
    jsonSave: false,
    doNotBackup: ["bans"],
    ignoreHiddenChannels: runtimeConfig.ignoreHiddenChannels,
  });
  renderStructureTree(data);
  await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
}

async function handleBackupManager(client: Client, rl: readline.Interface): Promise<void> {
  while (true) {
    printBanner(client);
    const backups = await backup.list();

    if (backups.length === 0) {
      console.log(chalk.yellow(`  ${t("noBackupsFound")}`));
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
      return;
    }

    const lines = backups.map((b, idx) => {
      const num = chalk.cyan(`[${idx + 1}]`);
      return `${num} ${chalk.bold.white(b.name)} ${chalk.gray(`(${b.id})`)} — ${chalk.cyan(`${b.rolesCount}R/${b.channelsCount}C/${b.emojisCount}E/${b.stickersCount}S`)} — ${chalk.gray(`${b.sizeKb} KB | ${b.createdAt}`)}`;
    });

    console.log(
      boxen(lines.join("\n"), {
        title: t("backupManagerTitle"),
        titleAlignment: "center",
        padding: 1,
        margin: { top: 0, bottom: 0, left: 2, right: 2 },
        borderStyle: "round",
        borderColor: "magenta",
      })
    );

    const action = await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("backupManagerPrompt")));
    if (action === "0" || action === "") return;

    const pickInput = await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("selectBackupPrompt")));
    if (!pickInput) continue;

    const idx = Number.parseInt(pickInput, 10);
    const chosen =
      /^\d{1,3}$/.test(pickInput) && idx >= 1 && idx <= backups.length
        ? backups[idx - 1]
        : backups.find((b) => b.id === pickInput);

    if (!chosen) {
      console.error(chalk.red(`\n${t("backupNotFound")}`));
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
      continue;
    }

    if (action === "2") {
      const data = await backup.get(chosen.id);
      renderStructureTree(data);
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    } else if (action === "3") {
      await backup.remove(chosen.id);
      console.log(chalk.green(`\n${t("backupDeleted")}${chosen.id}`));
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    } else if (action === "1") {
      const modeChoice = await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("restoreTargetMode")));
      if (modeChoice !== "1" && modeChoice !== "2") continue;

      const data = await backup.get(chosen.id);
      let targetGuild: Guild | null = null;

      if (modeChoice === "1") {
        const dstPick = await pickServer(client, rl, t("targetServerTitle"), true);
        if (!dstPick?.guild) {
          console.error(chalk.red(`\n${t("targetNotFound")}`));
          await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
          continue;
        }
        targetGuild = dstPick.guild;
      } else {
        console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("creatingServer")}`));
        targetGuild = await client.guilds.create(data.name || "Restored Server");
      }

      console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("startingRestore")}\n`));
      const stats = await backup.load(data, targetGuild, {
        clearGuildBeforeRestore: modeChoice === "1" ? runtimeConfig.clearGuildBeforeRestore : true,
        skipExisting: runtimeConfig.skipExisting,
        maxMessagesPerChannel: runtimeConfig.maxMessagesPerChannel,
        delayMs: runtimeConfig.delayMs,
        ignoreTickets: runtimeConfig.ignoreTickets,
        ignoreHiddenChannels: runtimeConfig.ignoreHiddenChannels,
        debug: runtimeConfig.debug,
        doNotRestore: runtimeConfig.doNotBackup,
        onRateLimit: createRateLimitHandler(rl),
      });
      printStats(stats);
      handlePostRestoreCheckpoint(data, targetGuild, stats);
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    }
  }
}

async function handleSettingsMenu(client: Client, rl: readline.Interface): Promise<void> {
  while (true) {
    printBanner(client);
    printSettingsBox();
    const choice = await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("settingsPrompt")));

    if (choice === "1") {
      const sp = await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("speedPrompt")));
      if (sp === "1") applySpeedPreset("safe");
      else if (sp === "2") applySpeedPreset("balanced");
      else if (sp === "3") applySpeedPreset("turbo");
      else if (sp === "4") {
        const raw = await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("inputCustomDelay")));
        const ms = Number.parseInt(raw, 10);
        if (!Number.isNaN(ms) && ms >= 100 && ms <= 5000) {
          runtimeConfig.speedPreset = "custom";
          runtimeConfig.delayMs = ms;
          saveConfig();
        }
      }
    } else if (choice === "2") {
      const m = await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("syncModePrompt")));
      if (m === "1") {
        runtimeConfig.clearGuildBeforeRestore = true;
        runtimeConfig.skipExisting = false;
      } else if (m === "2") {
        runtimeConfig.clearGuildBeforeRestore = false;
        runtimeConfig.skipExisting = true;
      } else if (m === "3") {
        runtimeConfig.clearGuildBeforeRestore = false;
        runtimeConfig.skipExisting = false;
      }
      saveConfig();
    } else if (choice === "3") {
      const mods = ["roles", "channels", "emojis", "stickers", "bans"];
      while (true) {
        printBanner(client);
        printSettingsBox();
        const pick = await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("modulesPrompt")));
        if (pick === "0" || pick === "") break;
        const idx = Number.parseInt(pick, 10) - 1;
        if (idx >= 0 && idx < mods.length) {
          const mod = mods[idx];
          if (runtimeConfig.doNotBackup.includes(mod)) {
            runtimeConfig.doNotBackup = runtimeConfig.doNotBackup.filter((m) => m !== mod);
          } else {
            runtimeConfig.doNotBackup.push(mod);
          }
          saveConfig();
        }
      }
    } else if (choice === "4") {
      const msgRaw = await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("inputMessages")));
      const parsedMsgs = Number.parseInt(msgRaw, 10);
      if (!Number.isNaN(parsedMsgs) && parsedMsgs >= 0) {
        runtimeConfig.maxMessagesPerChannel = Math.min(parsedMsgs, 100);
      }
      runtimeConfig.jsonSave = await askYesNo(rl, t("inputSaveJson"));
      runtimeConfig.jsonBeautify = await askYesNo(rl, t("inputBeautifyJson"));
      runtimeConfig.saveImagesBase64 = await askYesNo(rl, t("inputBase64"));
      runtimeConfig.ignoreTickets = await askYesNo(rl, t("inputIgnoreTickets"));
      runtimeConfig.ignoreHiddenChannels = await askYesNo(rl, t("inputIgnoreHidden"));
      runtimeConfig.debug = await askYesNo(rl, t("inputDebug"));
      saveConfig();
      console.log(chalk.green(`\n${t("settingsSaved")}`));
    } else if (choice === "5") {
      resetConfig();
      console.log(chalk.green(`\n${t("settingsReset")}`));
    } else if (choice === "0" || choice === "") {
      return;
    }
  }
}

async function handleAccountInfo(client: Client, rl: readline.Interface): Promise<void> {
  printBanner(client);
  const u = client.user;
  if (!u) return;

  const info = [
    `${chalk.cyan(t("accUsername"))}${u.username}`,
    `${chalk.cyan(t("accGlobalName"))}${u.globalName ?? t("none")}`,
    `${chalk.cyan(t("accId"))}${u.id}`,
    `${chalk.cyan(t("accCreated"))}${u.createdAt.toLocaleString()}`,
    `${chalk.cyan(t("accGuilds"))}${client.guilds.cache.size}`,
    `${chalk.cyan(t("accNitro"))}${u.nitroType ?? "NONE"}`,
    `${chalk.cyan(t("accEmail"))}${maskSensitive(u.emailAddress)}`,
    `${chalk.cyan(t("accPhone"))}${maskSensitive(u.phoneNumber)}`,
    `${chalk.cyan(t("accLocale"))}${client.settings?.locale ?? "Unknown"}`,
    `${chalk.cyan(t("accAvatar"))}${u.avatarURL({ format: "png", dynamic: true, size: 1024 }) ?? t("none")}`,
  ].join("\n");

  console.log(
    boxen(info, {
      title: t("accountInfoTitle"),
      titleAlignment: "center",
      padding: 1,
      margin: { top: 0, bottom: 1, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "cyan",
    })
  );

  await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
}

async function handleServerInfo(client: Client, rl: readline.Interface): Promise<void> {
  printBanner(client);
  const pick = await pickServer(client, rl, t("pickerTitle"), false);
  if (!pick) return;

  try {
    if (pick.guild) {
      const g = pick.guild;
      const info = [
        `${chalk.cyan(t("srvName"))}${g.name}`,
        `${chalk.cyan(t("srvId"))}${g.id}`,
        `${chalk.cyan(t("srvDesc"))}${g.description ?? t("none")}`,
        `${chalk.cyan(t("srvMembers"))}${g.memberCount}`,
        `${chalk.cyan(t("srvChannels"))}${g.channels.cache.size}`,
        `${chalk.cyan(t("srvRoles"))}${g.roles.cache.size}`,
        `${chalk.cyan(t("srvEmojis"))}${g.emojis.cache.size}`,
        `${chalk.cyan(t("srvStickers"))}${g.stickers.cache.size}`,
        `${chalk.cyan(t("srvBoosts"))}${g.premiumTier} (${g.premiumSubscriptionCount ?? 0})`,
        `${chalk.cyan(t("srvCreated"))}${g.createdAt.toLocaleString()}`,
        `${chalk.cyan(t("srvIcon"))}${g.iconURL({ dynamic: true, size: 1024 }) ?? t("none")}`,
        `${chalk.cyan(t("srvBanner"))}${g.bannerURL({ size: 1024 }) ?? t("none")}`,
        `${chalk.cyan(t("srvFeatures"))}${g.features.join(", ") || t("none")}`,
      ].join("\n");

      console.log(
        boxen(info, {
          title: t("serverInfoTitle"),
          titleAlignment: "center",
          padding: 1,
          margin: { top: 1, bottom: 1, left: 2, right: 2 },
          borderStyle: "round",
          borderColor: "cyan",
        })
      );
    } else {
      const preview = await client.fetchGuildPreview(pick.rawId);
      const info = [
        `${chalk.cyan(t("srvName"))}${preview.name}`,
        `${chalk.cyan(t("srvId"))}${preview.id}`,
        `${chalk.cyan(t("srvDesc"))}${preview.description ?? t("none")}`,
        `${chalk.cyan(t("srvMembers"))}${preview.approximateMemberCount}`,
        `${chalk.cyan(t("srvOnline"))}${preview.approximatePresenceCount}`,
        `${chalk.cyan(t("srvEmojis"))}${preview.emojis.size}`,
        `${chalk.cyan(t("srvStickers"))}${preview.stickers.size}`,
        `${chalk.cyan(t("srvCreated"))}${preview.createdAt.toLocaleString()}`,
        `${chalk.cyan(t("srvIcon"))}${preview.iconURL({ size: 1024 }) ?? t("none")}`,
        `${chalk.cyan(t("srvFeatures"))}${preview.features.join(", ") || t("none")}`,
      ].join("\n");

      console.log(
        boxen(info, {
          title: t("serverInfoTitle"),
          titleAlignment: "center",
          padding: 1,
          margin: { top: 1, bottom: 1, left: 2, right: 2 },
          borderStyle: "round",
          borderColor: "cyan",
        })
      );
    }
  } catch (err: any) {
    console.error(chalk.red(`\n${t("serverNotFound")} (${err?.message ?? err})`));
  }

  await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
}

async function handleWipeServer(client: Client, rl: readline.Interface): Promise<void> {
  printBanner(client);
  const pick = await pickServer(client, rl, t("wipeTitle"), true);
  if (!pick) return;

  if (!pick.guild) {
    console.error(chalk.red(`\n${t("targetNotFound")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  const targetGuild = pick.guild;
  const mode = await ask(rl, gradient(["#ff416c", "#ff4b2b"])(t("wipeModePrompt")));
  if (mode !== "1" && mode !== "2") {
    console.log(chalk.gray(`\n${t("wipeCancelled")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  if (mode === "2") {
    const hiddenItems = [...targetGuild.channels.cache.values()].filter((ch) =>
      ch.name.toLowerCase().includes("___hidden___")
    );
    if (hiddenItems.length === 0) {
      console.log(chalk.yellow(`\n${t("wipeNoHidden")}`));
      await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
      return;
    }

    const bar = new ProgressBar(hiddenItems.length, t("phaseClear"));
    let deleted = 0;
    let errors = 0;
    for (const ch of hiddenItems) {
      try {
        await executeWithRetry(() => ch.delete(), {
          retries: 2,
          label: `delete ${ch.name}`,
          debug: runtimeConfig.debug,
        });
        deleted++;
        await sleep(runtimeConfig.delayMs);
      } catch {
        errors++;
      }
      bar.tick(ch.name);
    }
    bar.finish();
    console.log("\n" + gradient(["#00f5d4", "#00bbf9"])(t("wipeDone")));
    console.log(chalk.white(`${t("wipeHiddenDeleted")}${chalk.green(String(deleted))}`));
    console.log(chalk.white(`${t("statErrors")}${errors > 0 ? chalk.yellow(String(errors)) : chalk.green("0")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  const confirm = await ask(
    rl,
    chalk.red.bold(`\n${t("wipeConfirmPrompt")}${targetGuild.name} » `)
  );
  if (confirm !== "YES") {
    console.log(chalk.gray(`\n${t("wipeCancelled")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  const logger = new SessionLogger(`wipe-${targetGuild.id}`);
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

  console.log("");
  const wipeMonitor = new RateLimitMonitor(client);
  try {
    await clearGuild(
      targetGuild,
      {
        delayMs: runtimeConfig.delayMs,
        debug: runtimeConfig.debug,
        onRateLimit: createRateLimitHandler(rl),
      },
      stats,
      logger,
      wipeMonitor
    );
  } finally {
    wipeMonitor.dispose();
  }

  console.log("\n" + gradient(["#00f5d4", "#00bbf9"])(t("wipeDone")));
  console.log(chalk.white(`${t("statErrors")}${stats.errors > 0 ? chalk.yellow(String(stats.errors)) : chalk.green("0")}`));
  console.log(chalk.gray(`${t("statLogFile")}${logger.filePath}`));
  await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
}

async function handleSmartResume(client: Client, rl: readline.Interface): Promise<void> {
  printBanner(client);
  const cp = loadCheckpoint();
  if (!cp) {
    console.log(chalk.yellow(`  ${t("resumeNoCheckpoint")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  const remainingSec = cp.rateLimitUntil ? Math.max(0, Math.ceil((cp.rateLimitUntil - Date.now()) / 1000)) : 0;
  const statusLine =
    remainingSec <= 0
      ? chalk.green.bold(t("resumeReadyNow"))
      : `${chalk.yellow.bold(t("resumeCooldownLeft"))} ${chalk.white.bold(formatDuration(remainingSec))}`;

  const summary = [
    `${chalk.cyan("Backup:")} ${chalk.white.bold(cp.sourceName)} (${cp.backupId})`,
    `${chalk.cyan("Target:")} ${chalk.white.bold(cp.targetGuildName)} (${cp.targetGuildId})`,
    `${chalk.cyan("Pending Phases:")} ${chalk.yellow.bold(cp.pendingPhases.join(", "))}`,
    statusLine,
  ].join("\n");

  console.log(
    boxen(summary, {
      title: t("resumeBannerTitle"),
      titleAlignment: "center",
      padding: 1,
      margin: { top: 0, bottom: 0, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: remainingSec <= 0 ? "green" : "yellow",
    })
  );

  const action = await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("resumePrompt")));
  if (action === "2") {
    clearCheckpoint();
    console.log(chalk.green(`\n${t("resumeCleared")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }
  if (action !== "1") return;

  await client.guilds.fetch().catch(() => {});
  const targetGuild = client.guilds.cache.get(cp.targetGuildId);
  if (!targetGuild) {
    console.error(chalk.red(`\n${t("targetNotFound")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  let data: BackupData;
  try {
    data = await backup.get(cp.backupId);
  } catch {
    console.error(chalk.red(`\n${t("backupNotFound")}`));
    await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
    return;
  }

  console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("startingRestore")}\n`));
  const stats = await backup.load(data, targetGuild, {
    clearGuildBeforeRestore: false,
    skipExisting: true,
    onlyPhases: cp.pendingPhases,
    delayMs: runtimeConfig.delayMs,
    ignoreTickets: runtimeConfig.ignoreTickets,
    ignoreHiddenChannels: runtimeConfig.ignoreHiddenChannels,
    debug: runtimeConfig.debug,
    onRateLimit: createRateLimitHandler(rl),
  });

  printStats(stats);
  if (stats.rateLimitedPhases && stats.rateLimitedPhases.length > 0) {
    handlePostRestoreCheckpoint(data, targetGuild, stats);
  } else {
    clearCheckpoint();
  }

  await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
}

async function handleAccountSwitcher(
  client: Client,
  rl: readline.Interface
): Promise<string | null> {
  while (true) {
    printBanner(client);
    const saved = listSavedAccounts();
    const lines = saved.map((acc, idx) => {
      const isActive = acc.userId === client.user?.id;
      const tag = isActive ? chalk.green.bold(` ${t("accCurrentTag")}`) : "";
      return `${chalk.cyan(`[${idx + 1}]`)} ${chalk.white.bold(acc.username)} ${chalk.gray(`(${acc.userId})`)}${tag}`;
    });

    if (lines.length === 0 && client.user) {
      lines.push(`${chalk.gray("•")} ${chalk.white.bold(client.user.tag)} ${chalk.green.bold(t("accCurrentTag"))}`);
    }

    console.log(
      boxen(lines.join("\n"), {
        title: t("accManagerTitle"),
        titleAlignment: "center",
        padding: 1,
        margin: { top: 0, bottom: 0, left: 2, right: 2 },
        borderStyle: "round",
        borderColor: "cyan",
      })
    );

    const pick = (await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("accManagerPrompt")))).toUpperCase();
    if (pick === "0" || pick === "") return null;

    if (pick === "N") {
      const newTok = await ask(rl, gradient(["#00f5d4", "#9b5de5"])(t("tokenPrompt")));
      if (!newTok) {
        console.error(chalk.red(t("tokenEmpty")));
        await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
        continue;
      }
      return newTok;
    }

    if (pick === "D") {
      if (saved.length === 0) continue;
      const delPick = await ask(rl, gradient(["#ff416c", "#ff4b2b"])(t("accDeletePrompt")));
      const idx = Number.parseInt(delPick, 10) - 1;
      if (!Number.isNaN(idx) && idx >= 0 && idx < saved.length) {
        removeSavedAccount(saved[idx].userId);
        console.log(chalk.green(`\n${t("accDeletedOk")}`));
        await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
      }
      continue;
    }

    const idx = Number.parseInt(pick, 10) - 1;
    if (!Number.isNaN(idx) && idx >= 0 && idx < saved.length) {
      const targetAcc = saved[idx];
      if (targetAcc.userId === client.user?.id) {
        console.log(chalk.yellow(`\n${t("accAlreadyActive")}`));
        await ask(rl, gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
        continue;
      }
      console.log(gradient(["#00f5d4", "#00bbf9"])(`\n${t("accSwitchingTo")}${targetAcc.username}`));
      return targetAcc.token;
    }
  }
}

export async function runMainMenu(client: Client, rl: readline.Interface): Promise<string | null> {
  while (true) {
    printBanner(client);
    const cp = loadCheckpoint();
    if (cp) {
      const isDifferentAccount = Boolean(
        cp.accountUserId && client.user?.id && cp.accountUserId !== client.user.id
      );
      const remSec = cp.rateLimitUntil ? Math.max(0, Math.ceil((cp.rateLimitUntil - Date.now()) / 1000)) : 0;
      const line = isDifferentAccount
        ? chalk.magenta.bold(t("resumeWrongAccount").replace("%USER%", cp.accountUsername || cp.accountUserId || ""))
        : remSec <= 0
        ? chalk.green.bold(t("resumeReadyNow"))
        : `${chalk.yellow.bold(t("resumeCooldownLeft"))} ${chalk.white.bold(formatDuration(remSec))}`;
      console.log(
        boxen(
          `${chalk.white(`${cp.sourceName} → ${cp.targetGuildName}`)} ${chalk.gray(`(${cp.pendingPhases.join(", ")})`)}\n${line}`,
          {
            title: t("resumeBannerTitle"),
            titleAlignment: "center",
            padding: { top: 0, bottom: 0, left: 2, right: 2 },
            margin: { top: 0, bottom: 1, left: 2, right: 2 },
            borderStyle: "round",
            borderColor: isDifferentAccount ? "magenta" : remSec <= 0 ? "green" : "yellow",
          }
        )
      );
    }
    console.log(
      boxen(gradient(["#00f5d4", "#00bbf9", "#9b5de5"])(t("menuText")), {
        title: t("menuTitle"),
        titleAlignment: "center",
        padding: 1,
        margin: { top: 0, bottom: 0, left: 2, right: 2 },
        borderStyle: "round",
        borderColor: "magenta",
      })
    );

    const choice = (await ask(rl, gradient(["#00f5d4", "#00bbf9"])(t("optionPrompt")))).toUpperCase();

    switch (choice) {
      case "1":
        await handleCloneFlow(client, rl, "existing");
        break;
      case "2":
        await handleCloneFlow(client, rl, "new");
        break;
      case "3":
        await handleCloneFlow(client, rl, "template");
        break;
      case "4":
        await handleBackupOnly(client, rl);
        break;
      case "5":
        await handleBackupManager(client, rl);
        break;
      case "6":
        await handleDryRunStandalone(client, rl);
        break;
      case "7":
        await handleAccountInfo(client, rl);
        break;
      case "8":
        await handleServerInfo(client, rl);
        break;
      case "9":
        await handleSettingsMenu(client, rl);
        break;
      case "R":
        await handleSmartResume(client, rl);
        break;
      case "W":
        await handleWipeServer(client, rl);
        break;
      case "A": {
        const nextToken = await handleAccountSwitcher(client, rl);
        if (nextToken) return nextToken;
        break;
      }
      case "L":
        toggleLang();
        break;
      case "0":
        console.log(gradient(["#00f5d4", "#9b5de5"])(`\n${t("goodbye")}\n`));
        return null;
      default:
        console.log(chalk.yellow(t("invalidOption")));
        break;
    }
  }
}
