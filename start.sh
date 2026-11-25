#!/usr/bin/env bash
set -e

echo "=================================================="
echo "     Discord Server Cloner ULTRA v5.3"
echo "=================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed. Please install Node.js v18+ from https://nodejs.org/"
  exit 1
fi

echo "[OK] Node.js detected: $(node -v)"

if [ ! -d "node_modules" ]; then
  echo "[INFO] Installing dependencies..."
  npm install
fi

echo "[INFO] Launching Discord Server Cloner ULTRA v5.3..."
echo ""
npx tsx src/index.ts
