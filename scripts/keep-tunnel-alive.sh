#!/usr/bin/env bash
while true; do
  if [ -f .data/tunnel-url.txt ]; then
    URL=$(cat .data/tunnel-url.txt | tr -d ' \r\n')
    if [[ "$URL" =~ ^https:// ]]; then
      curl -s -m 5 -L "$URL/api/network-info" > /dev/null 2>&1
    fi
  fi
  sleep 15
done
