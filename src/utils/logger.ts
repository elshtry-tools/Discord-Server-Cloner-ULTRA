import chalk from "chalk";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { formatDuration } from "../core/rateLimit";

const LOGS_DIR = path.resolve(process.cwd(), "logs");

export class SessionLogger {
  public readonly filePath: string;

  constructor(prefix = "session") {
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.filePath = path.join(LOGS_DIR, `${prefix}-${stamp}.log`);
    this.write("INFO", `Session started at ${new Date().toLocaleString()}`);
  }

  public write(level: "INFO" | "OK" | "SKIP" | "WARN" | "ERROR", message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    try {
      appendFileSync(this.filePath, line, "utf-8");
    } catch {
      // Ignore write failures
    }
  }
}

export class ProgressBar {
  private current = 0;
  private readonly startTime = Date.now();

  constructor(private readonly total: number, private readonly label: string) {}

  public tick(itemName = ""): void {
    this.current = Math.min(this.current + 1, Math.max(1, this.total));
    this.render(itemName);
  }

  public render(itemName = ""): void {
    const safeTotal = Math.max(1, this.total);
    const ratio = Math.min(1, this.current / safeTotal);
    const width = 22;
    const filled = Math.round(ratio * width);
    const empty = width - filled;
    const bar = chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(empty));
    const pct = Math.round(ratio * 100).toString().padStart(3, " ");

    const elapsedSec = (Date.now() - this.startTime) / 1000;
    const rate = this.current > 0 ? elapsedSec / this.current : 0;
    const etaSec = Math.max(0, Math.round(rate * (safeTotal - this.current)));
    const shortName = itemName.length > 24 ? `${itemName.slice(0, 21)}...` : itemName;

    const line = `  ${chalk.white(this.label)} [${bar}] ${chalk.bold.white(`${pct}%`)} (${this.current}/${safeTotal}) ETA ${chalk.yellow(formatDuration(etaSec))} ${chalk.gray(shortName)}`;
    process.stdout.write(`\r\x1b[2K${line}`);
  }

  public finish(): void {
    if (this.total > 0) {
      this.current = this.total;
      this.render("Done");
      process.stdout.write("\n");
    }
  }
}
