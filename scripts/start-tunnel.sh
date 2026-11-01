#!/usr/bin/env bash
mkdir -p .data
while true; do
  ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -R 80:127.0.0.1:3110 nokey@localhost.run 2>&1 | while read -r line; do
    echo "$line"
    if [[ "$line" =~ (https://[a-zA-Z0-9.-]+\.lhr\.life) ]]; then
      echo "${BASH_REMATCH[1]}" > .data/tunnel-url.txt
    fi
  done
  sleep 1
done
