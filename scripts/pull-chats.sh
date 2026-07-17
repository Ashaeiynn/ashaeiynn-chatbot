#!/bin/bash
# Mirror the LIVE seekers' chat log (guide.ashaeiynn.com) onto this machine.
# Merges the server's data/questions.log into the local one — union of both,
# sorted by timestamp, duplicates dropped — so the local admin shows the same
# conversations as the live one. Local-only test entries are preserved.
#
#   bash scripts/pull-chats.sh
#
# Asks for the VPS password unless an SSH ControlMaster socket (~/.ssh/vps.sock)
# is already open. PRIVACY: questions.log is gitignored — user chats sync only
# over SSH between our own machines, never through GitHub.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"
VPS=root@200.97.172.186
SOCK="$HOME/.ssh/vps.sock"
OPTS=()
if ssh -o ControlPath="$SOCK" -O check "$VPS" 2>/dev/null; then
  OPTS=(-o ControlPath="$SOCK")
fi
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
scp -q "${OPTS[@]}" "$VPS:/opt/chatbot/app/data/questions.log" "$TMP"
node - "$TMP" data/questions.log <<'EOF'
const fs = require("fs");
const [live, local] = process.argv.slice(2);
const read = (f) => { try { return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean); } catch { return []; } };
const seen = new Set(), all = [];
for (const l of [...read(local), ...read(live)]) if (!seen.has(l)) { seen.add(l); all.push(l); }
const at = (l) => { try { return JSON.parse(l).at || ""; } catch { return ""; } };
all.sort((a, b) => (at(a) < at(b) ? -1 : 1));
fs.writeFileSync(local, all.length ? all.join("\n") + "\n" : "");
console.log(`✓ merged ${all.length} chat entries — newest: ${at(all[all.length - 1]) || "none"}`);
EOF
