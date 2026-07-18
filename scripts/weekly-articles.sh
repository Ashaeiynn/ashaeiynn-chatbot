#!/bin/bash
# Weekly Pathshala sync — a new article appears on ashaeiynn.com every Sunday, and
# before this ran automatically the guide quietly drifted behind the website.
# Run by chatbot-articles.timer (Sunday evening IST) AS ROOT; drops to the
# `chatbot` user for node/git because the GitHub deploy key belongs to them.
#
# Safe to run any time by hand:  /opt/chatbot/app/scripts/weekly-articles.sh
set -uo pipefail
cd /opt/chatbot/app || exit 0
NODE=/opt/chatbot/node/bin/node

# never fight a teach job — it rebuilds the very same files
if grep -q '"id":' data/teach-queue.json 2>/dev/null; then
  echo "articles: a teach job is running — skipping this week's sync"
  exit 0
fi

echo "articles: pulling from ashaeiynn.com…"
if ! sudo -u chatbot -H "$NODE" pipeline/4-articles.mjs; then
  echo "articles: pull FAILED — leaving knowledge untouched"
  exit 1
fi

# only pay the ~7min rebuild when something actually changed
if sudo -u chatbot git status --porcelain data/transcripts | grep -q .; then
  echo "articles: new/changed content — rebuilding knowledge…"
  if ! sudo -u chatbot -H "$NODE" pipeline/3-ingest.mjs; then
    echo "articles: ingest FAILED — restoring previous knowledge"
    sudo -u chatbot git checkout -- data/knowledge.db 2>/dev/null
    exit 1
  fi
  systemctl restart chatbot
  sudo -u chatbot git add data/transcripts data/knowledge.db
  sudo -u chatbot git -c user.name="Ashaeiynn Guide" -c user.email="guide@ashaeiynn.com" \
    commit -q -m "Knowledge: weekly Pathshala article sync"
  sudo -u chatbot git push -q || echo "articles: push failed (will catch up next sync)"
  echo "articles: done — guide updated and restarted"
else
  echo "articles: nothing new this week"
fi
