# Discord Server Cloner ULTRA v5.3

> **Educational & Research Purpose Only:** This repository is an open-source TypeScript project created strictly for **educational, archival, and technical research purposes** (demonstrating Discord guild structures, permission mapping, rate-limit handling, and CLI architecture). It is **not affiliated with, endorsed by, or connected to Discord Inc.**
>
> **Account Safety Warning:** **Do NOT use your main/primary Discord account.** Always test only on servers you own or have explicit permission to manage, using a dedicated secondary/alt account.

A fast, clean, and rate-limit-protected Discord Server Backup, Smart Sync, Multi-Account & Offline JSON Suite — zero telemetry, zero hidden network calls, and zero forced server requirements.

## Key Features

* **Multi-Account Switcher (`[A]`)** — Store local tokens in `accounts.json` (git-ignored), sign in with one keypress on startup, and switch accounts live without restarting.

* **Live Rate-Limit Interceptor** — Real-time detection across all phases (`clear`, `roles`, `channels`, `emojis`, `stickers`, `bans`). Instead of hanging on Discord cooldowns, it alerts you with the exact remaining time and lets you skip & save a checkpoint or wait.

* **Smart Resume (`[R]`)** — Automatically detects paused or rate-limited sessions on startup, tracks remaining cooldowns, verifies account ownership, and resumes only pending phases in Smart Sync mode without wiping.

* **Interactive Server Picker** — Select servers from a numbered list (with `[OWNER]` / `[ADMIN]` badges, member & channel counts) or paste any Server ID directly.

* **Pre-Flight Check & Dry-Run Tree (`[6]`)** — Preview the full server structure tree, estimated duration, and Boost Tier / Admin permission warnings before making any changes.

* **Smart Sync Mode (Diff Clone)** — Sync into an existing server without wiping it, automatically skipping roles, categories, channels, emojis, and stickers that already exist by name.

* **Standalone Clean / Wipe Tool (`[W]`)** — Perform a protected Full Wipe (requires uppercase `YES` confirmation) or remove only inaccessible `___hidden___` channels and categories.

* **Live Progress Bar + Real-Time ETA** — Clean visual progress tracking for every stage.

* **Stickers, System Channel & Hidden Channel Filtering** — Full support for server Stickers (respecting Boost Tier caps), System Channel restoration, and automatic skipping of `___hidden___` channels.

* **Offline Base64 Backup Mode & Backup Manager (`[5]`)** — Optionally embed icons, banners, emojis, and stickers directly into local JSON backups, then list, inspect, restore, or delete backups anytime.

* **Speed Presets & Persistent Config (`[9]`)** — One-click `Safe (600ms)`, `Balanced (350ms)`, `Turbo (150ms)`, or custom delay, saved automatically to `config.json`, plus timestamped session logs in `./logs/`.

## Requirements

* **Node.js v18+** ([nodejs.org](https://nodejs.org/))

## Quick Start

### Option 1: Run Locally (Windows / Linux / macOS)

1. Double-click `start.bat` on Windows, or run `./start.sh` on Linux/macOS.

2. Or run manually from a terminal:

   ```
   npm install
   npm start
   
   ```

3. Enter your test account token when prompted (you can save it locally to `accounts.json` for quick switching next time, or place it in `.env` as `TOKEN=your_token_here`).

### Option 2: Run in the Cloud via GitHub Codespaces (No Local Setup)

You do not need to install Node.js or run anything on your own PC:

1. **Fork** this repository to your GitHub account.

2. Open [GitHub Codespaces](https://github.com/codespaces) and click **New codespace**.

3. Select your forked repository and click **Create codespace**, then wait for the environment to finish setting up.

4. In the Codespaces terminal, run:

   ```
   npm install
   npm start
   
   ```

5. The CLI will start immediately in the cloud — enter your secondary/test account token and follow the menu.

## How to Get Your Discord User Token

1. Open Discord in your web browser and log in to your **secondary/test account**.

2. Copy and paste the following snippet into your browser's **address bar (URL bar)**:

   ```
   javascript:(function()%7Blocation.reload()%3Bvar%20i%20%3D%20document.createElement('iframe')%3Bdocument.body.appendChild(i)%3Bdocument.write(i.contentWindow.localStorage.token)%7D)()
   
   ```

3. Most browsers automatically strip `javascript:` when you paste into the address bar, so it will look like this:

   ```
   (function()%7Blocation.reload()%3Bvar%20i%20%3D%20document.createElement('iframe')%3Bdocument.body.appendChild(i)%3Bdocument.write(i.contentWindow.localStorage.token)%7D)()
   
   ```

4. Click at the very beginning of the address bar, manually type `javascript:` right before `(function()`, and press **Enter**.

5. Your token will appear on the page. Copy it (without the surrounding quotation marks) and paste it into the CLI.

> **Security Warning:** Never share your token with anyone, and **never commit `.env`, `accounts.json`, `backups/`, or `logs/`** to a public repository (all of them are already excluded in `.gitignore`). **Always use a dedicated alt/secondary account, never your main account.**

## How to Copy Any Server ID

1. Open Discord and click **User Settings** (gear icon) next to your username.

2. Scroll down in the left sidebar and click **Developer** (right above **Log Out**).

3. Toggle **Developer Mode** ON.

4. Right-click any server icon in your server list and select **Copy Server ID**.

## Legal Disclaimer & Responsible Use

* **Educational Purpose Only:** This software is provided solely for educational purposes, personal backup experimentation, and learning how Discord's API structures work.

* **No Affiliation:** This project is independent and is not affiliated with, sponsored by, or endorsed by Discord Inc.

* **Terms of Service Notice:** Automating user accounts (selfbots) is against Discord's Terms of Service and may lead to account warnings, rate limits, or permanent suspension. **Never use your primary/main Discord account.**

* **Authorized Use Only:** Do not use this tool for spam, harassment, scraping private user data, or unauthorized actions. Only test on servers you own or have explicit authorization to administer.

* **No Warranty & Liability:** This software is provided **"as is"**, without warranty of any kind. The author and contributors assume no responsibility or liability for any misuse, account action, or damages resulting from the use of this code. You are solely responsible for complying with all applicable laws and platform Terms of Service.

## License

Released under the **MIT License**.