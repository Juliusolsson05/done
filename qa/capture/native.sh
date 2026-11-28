#!/bin/bash
set -euo pipefail
mkdir -p qa/output
(cd qa/capture/automation && xcodegen generate)
app=$(find crates/app/gen/apple/build -type d -name done.app -print -quit)
if [[ -z "$app" ]]; then app=$(find "$HOME/Library/Developer/Xcode/DerivedData" -type d -name done.app -print -quit); fi
test -n "$app"
ditto -c -k --keepParent "$app" qa/output/done-simulator.zip
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
  if xcodebuild -project qa/capture/automation/StoreQA.xcodeproj -scheme StoreQA -destination "id=$device" -parallel-testing-enabled NO -resultBundlePath "$RUNNER_TEMP/$family.xcresult" test > "$RUNNER_TEMP/$family.log" 2>&1; then
    mkdir -p "qa/output/$family"
    xcrun xcresulttool export attachments --path "$RUNNER_TEMP/$family.xcresult" --output-path "qa/output/$family"
  else
    tail -80 "$RUNNER_TEMP/$family.log"
    mkdir -p "qa/output/$family"
    xcrun xcresulttool export attachments --path "$RUNNER_TEMP/$family.xcresult" --output-path "qa/output/$family" || true
  fi
  xcrun simctl shutdown "$device"
done
