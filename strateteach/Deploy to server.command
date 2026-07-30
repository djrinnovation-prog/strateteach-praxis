#!/bin/bash
# Double-click to deploy the latest code to the live server (app.strateteach.com).
# It connects over SSH and runs: git pull + docker rebuild. You'll be asked for
# the server password once.
echo "==> Deploying ALGO770 to the live server..."
echo "    (enter your server password when prompted)"
echo ""
ssh -t root@167.233.52.116 'cd /opt/algo770 && git pull && docker compose up -d --build && echo "" && echo "==> DONE. Live containers:" && docker compose ps'
echo ""
echo "Finished. You can close this window. Refresh app.strateteach.com to see the changes."
