import boxen from "boxen";
import chalk from "chalk";
import Discord, { type Client } from "discord.js-selfbot-v13";
import dotenv from "dotenv";
import gradient from "gradient-string";
import readline from "readline";
import { printBanner, runMainMenu } from "./ui/menu";
import {
  getLastActiveAccount,
  isAccountSaved,
  listSavedAccounts,
  markAccountUsed,
  saveOrUpdateAccount,
} from "./utils/accounts";
import { setLang, t } from "./utils/i18n";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let activeClient: Client | null = null;

process.on("SIGINT", () => {
  rl.close();
  activeClient?.destroy();
  process.exit(0);
});

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => resolve(ans.trim()));
  });
}

function startSpinner(): NodeJS.Timeout {
  let dots = 0;
  return setInterval(() => {
    process.stdout.write(
      `\r\x1b[2K${gradient(["#00f5d4", "#9b5de5"])(`${t("connecting")}${".".repeat(dots)}`)}`
    );
    dots = (dots + 1) % 4;
  }, 400);
}

export async function createAndLoginClient(token: string): Promise<Client> {
  if (activeClient) {
    try {
      activeClient.destroy();
    } catch {
      // Ignore cleanup errors
    }
    activeClient = null;
  }

  const client = new Discord.Client({
    partials: [],
  });

  const spinner = startSpinner();

  return new Promise<Client>((resolve, reject) => {
    client.once("ready", () => {
      clearInterval(spinner);
      process.stdout.write("\r\x1b[2K");
      activeClient = client;

      const locale = String(client.settings?.locale ?? "").toLowerCase();
      if (locale.startsWith("ar")) {
        setLang("ar");
      }

      if (client.user) {
        if (isAccountSaved(client.user.id)) {
          markAccountUsed(client.user.id);
        }
      }
      resolve(client);
    });

    client.login(token.trim()).catch((error: any) => {
      clearInterval(spinner);
      process.stdout.write("\r\x1b[2K");
      try {
        client.destroy();
      } catch {
        // Ignore
      }
      reject(error);
    });
  });
}

async function promptForStartupToken(): Promise<{ token: string; isNew: boolean }> {
  const saved = listSavedAccounts();
  const envToken = process.env.TOKEN?.trim();

  if (saved.length > 0) {
    printBanner();
    const lines = saved.map((acc, idx) => {
      const badge = idx === 0 ? chalk.green(" [LAST USED]") : "";
      return `${chalk.cyan(`[${idx + 1}]`)} ${chalk.white.bold(acc.username)} ${chalk.gray(`(${acc.userId})`)}${badge}`;
    });
    lines.push(`${chalk.yellow("[N]")} ${chalk.white(t("accAddNewOption"))}`);
    if (envToken) {
      lines.push(`${chalk.magenta("[E]")} ${chalk.white(t("accUseEnvOption"))}`);
    }

    console.log(
      boxen(lines.join("\n"), {
        title: t("accPickerTitle"),
        titleAlignment: "center",
        padding: 1,
        margin: { top: 0, bottom: 1, left: 2, right: 2 },
        borderStyle: "round",
        borderColor: "cyan",
      })
    );

    const pick = await ask(gradient(["#00f5d4", "#00bbf9"])(t("accStartupPrompt")));
    if (pick === "" || pick === "1") {
      return { token: saved[0].token, isNew: false };
    }
    if (pick.toUpperCase() === "E" && envToken) {
      return { token: envToken, isNew: false };
    }
    const idx = Number.parseInt(pick, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= saved.length) {
      return { token: saved[idx - 1].token, isNew: false };
    }
  } else if (envToken) {
    return { token: envToken, isNew: true };
  }

  printBanner();
  const token = await ask(gradient(["#00f5d4", "#9b5de5"])(t("tokenPrompt")));
  if (!token) {
    console.error(gradient(["#ff416c", "#ff4b2b"])(t("tokenEmpty")));
    rl.close();
    process.exit(1);
  }
  return { token, isNew: true };
}

async function main(): Promise<void> {
  while (true) {
    const { token, isNew } = await promptForStartupToken();
    try {
      const client = await createAndLoginClient(token);

      if (isNew && client.user && !isAccountSaved(client.user.id)) {
        const saveAns = await ask(
          gradient(["#00f5d4", "#00bbf9"])(t("accAskSavePrompt")) +
            gradient(["#f7971e", "#ffd200"])(t("yesNoHint"))
        );
        if (saveAns === "1" || saveAns.toLowerCase() === "y" || saveAns.toLowerCase() === "yes") {
          saveOrUpdateAccount({
            userId: client.user.id,
            username: client.user.tag,
            token,
          });
          console.log(chalk.green(`${t("accSavedOk")}${client.user.tag}`));
        }
      }

      // Main menu returns a new token if the user requests a live account switch, or null on Exit
      let currentClient = client;
      while (true) {
        const nextToken = await runMainMenu(currentClient, rl);
        if (!nextToken) {
          rl.close();
          currentClient.destroy();
          process.exit(0);
        }
        try {
          currentClient = await createAndLoginClient(nextToken);
          if (currentClient.user && !isAccountSaved(currentClient.user.id)) {
            const saveAns = await ask(
              gradient(["#00f5d4", "#00bbf9"])(t("accAskSavePrompt")) +
                gradient(["#f7971e", "#ffd200"])(t("yesNoHint"))
            );
            if (saveAns === "1" || saveAns.toLowerCase() === "y" || saveAns.toLowerCase() === "yes") {
              saveOrUpdateAccount({
                userId: currentClient.user.id,
                username: currentClient.user.tag,
                token: nextToken,
              });
              console.log(chalk.green(`${t("accSavedOk")}${currentClient.user.tag}`));
            }
          }
        } catch (err: any) {
          console.error(
            gradient(["#ff416c", "#ff4b2b"])(
              err?.message === "An invalid token was provided."
                ? t("invalidToken")
                : `${t("loginError")}${err?.message ?? err}`
            )
          );
          const fallback = getLastActiveAccount();
          if (fallback) {
            currentClient = await createAndLoginClient(fallback.token);
          } else {
            break;
          }
        }
      }
    } catch (error: any) {
      console.clear();
      if (error?.message === "An invalid token was provided.") {
        console.error(gradient(["#ff416c", "#ff4b2b"])(t("invalidToken")));
      } else {
        console.error(
          gradient(["#ff416c", "#ff4b2b"])(`${t("loginError")}${error?.message ?? error}`)
        );
      }
      const retry = await ask(gradient(["#00bbf9", "#9b5de5"])(t("awaitEnter")));
      void retry;
    }
  }
}

main();
