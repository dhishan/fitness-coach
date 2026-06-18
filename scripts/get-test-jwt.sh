#!/usr/bin/env bash
# get-test-jwt.sh
#
# Walks you through getting a test JWT for Maestro UI flows.
# The token lets 00-login.yaml sign in without Google OAuth.
#
# Usage: bash scripts/get-test-jwt.sh

set -euo pipefail

WEB_URL="https://ui.fitness-tracker.blueelephants.org"
JWT_FILE="$HOME/.fitness-test-jwt"

echo ""
echo "=== Fitness Tracker — Maestro test JWT setup ==="
echo ""
echo "Step 1: Open the web app in your browser:"
echo "  $WEB_URL"
echo ""
echo "Step 2: Sign in with Google (your own account is fine — the JWT is yours)."
echo ""
echo "Step 3: Open DevTools (F12 / Cmd+Option+I)."
echo ""
echo "Step 4: Go to the Network tab, make any request to the API (e.g. refresh the page)."
echo ""
echo "Step 5: Click on any request to api.fitness-tracker.blueelephants.org,"
echo "        look at the Request Headers, copy the value after 'Authorization: Bearer '."
echo ""
echo "Paste the token here (it will be saved to $JWT_FILE):"
read -r token

if [ -z "$token" ]; then
  echo "No token entered. Aborting."
  exit 1
fi

# Basic sanity check — JWTs have three dot-separated parts
parts=$(echo "$token" | tr -cd '.' | wc -c | tr -d ' ')
if [ "$parts" -ne 2 ]; then
  echo "Warning: this doesn't look like a JWT (expected 2 dots, found $parts). Saving anyway."
fi

echo "$token" > "$JWT_FILE"
chmod 600 "$JWT_FILE"

echo ""
echo "Saved to $JWT_FILE"
echo ""
echo "To run all Maestro flows:"
echo "  make e2e-mobile"
echo ""
echo "Note: Firebase ID tokens expire after 1 hour. Re-run this script to refresh."
