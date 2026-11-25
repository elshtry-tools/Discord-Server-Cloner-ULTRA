import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { ClonerRuntimeConfig, SpeedPreset } from "../types";

const CONFIG_PATH = path.resolve(process.cwd(), "config.json");

export const SPEED_PRESET_DELAYS: Record<Exclude<SpeedPreset, "custom">, number> = {
  safe: 600,
  balanced: 350,
  turbo: 150,
};

export function createDefaultConfig(): ClonerRuntimeConfig {
  return {
    maxMessagesPerChannel: 0,
    jsonSave: true,
    jsonBeautify: true,
    saveImagesBase64: false,
    doNotBackup: ["bans"],
    ignoreTickets: false,
    ignoreHiddenChannels: true,
    speedPreset: "balanced",
    delayMs: 350,
    clearGuildBeforeRestore: true,
    skipExisting: true,
    debug: false,
  };
}

function loadSavedConfig(): ClonerRuntimeConfig {
  const defaults = createDefaultConfig();
  if (!existsSync(CONFIG_PATH)) return defaults;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ClonerRuntimeConfig>;
    return {
      ...defaults,
      ...parsed,
      doNotBackup: Array.isArray(parsed.doNotBackup) ? parsed.doNotBackup : defaults.doNotBackup,
    };
  } catch {
    return defaults;
  }
}

export const runtimeConfig: ClonerRuntimeConfig = loadSavedConfig();

export function saveConfig(): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(runtimeConfig, null, 2), "utf-8");
  } catch {
    // Non-fatal if directory is read-only
  }
}

export function resetConfig(): void {
  Object.assign(runtimeConfig, createDefaultConfig());
  saveConfig();
}

export function applySpeedPreset(preset: Exclude<SpeedPreset, "custom">): void {
  runtimeConfig.speedPreset = preset;
  runtimeConfig.delayMs = SPEED_PRESET_DELAYS[preset];
  saveConfig();
}
