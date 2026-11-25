import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

const RESUME_PATH = path.resolve(process.cwd(), "resume-state.json");

export interface ResumeCheckpoint {
  backupId: string;
  sourceName: string;
  targetGuildId: string;
  targetGuildName: string;
  pendingPhases: string[];
  rateLimitUntil?: number;
  accountUserId?: string;
  accountUsername?: string;
  createdAt: number;
}

export function saveCheckpoint(cp: ResumeCheckpoint): void {
  try {
    writeFileSync(RESUME_PATH, JSON.stringify(cp, null, 2), "utf-8");
  } catch {
    // Ignore write failures
  }
}

export function loadCheckpoint(): ResumeCheckpoint | null {
  if (!existsSync(RESUME_PATH)) return null;
  try {
    const raw = readFileSync(RESUME_PATH, "utf-8");
    const parsed = JSON.parse(raw) as ResumeCheckpoint;
    if (!parsed.backupId || !parsed.targetGuildId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCheckpoint(): void {
  try {
    if (existsSync(RESUME_PATH)) {
      unlinkSync(RESUME_PATH);
    }
  } catch {
    // Ignore
  }
}
