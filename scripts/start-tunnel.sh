#!/usr/bin/env bash
mkdir -p .data
while true; do
  ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -R 80:127.0.0.1:3110 nokey@localhost.run 2>&1 | while IFS= read -r line; do
    echo "$line"
    url=$(echo "$line" | grep -o 'https://[a-zA-Z0-9.-]*\.lhr\.life' | head -n 1)
    if [ -n "$url" ]; then
      echo "$url" > .data/tunnel-url.txt
      echo "[TUNNEL-UPDATED] $url"
    fi
  done
  sleep 1
done
