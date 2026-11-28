#!/bin/bash
set -euo pipefail
mkdir -p qa/output
app=$(find crates/app/gen/apple/build "$HOME/Library/Developer/Xcode/DerivedData" -type d -name done.app -print 2>/dev/null | head -1)
test -n "$app"
/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist"
for family in iPhone iPad; do
  device=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; f=sys.argv[1]; ds=[d for k,ds in sorted(json.load(sys.stdin)["devices"].items(),reverse=True) if "iOS" in k for d in ds if d["isAvailable"] and (("Pro Max" in d["name"]) if f=="iPhone" else ("iPad Pro 13-inch" in d["name"]))]; print(ds[0]["udid"])' "$family")
  xcrun simctl boot "$device"
  xcrun simctl bootstatus "$device" -b
  xcrun simctl status_bar "$device" override --time '9:41' --batteryState charged --batteryLevel 100 --dataNetwork wifi
  xcrun simctl ui "$device" appearance light
  xcrun simctl install "$device" "$app"
  xcrun simctl launch "$device" app.thedone.ios
  container=$(xcrun simctl get_app_container "$device" app.thedone.ios data)
  db="$container/Library/Application Support/done/done.db"
  for i in {1..30}; do test -f "$db" && break; sleep 1; done
  test -f "$db"
  xcrun simctl terminate "$device" app.thedone.ios
  sqlite3 "$db" < qa/capture/sample.sql
  xcrun simctl launch "$device" app.thedone.ios
  sleep 6
  xcrun simctl io "$device" screenshot "qa/output/$family-today.png"
  xcrun simctl shutdown "$device"
done
