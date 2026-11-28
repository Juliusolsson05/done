#!/bin/zsh
# The done iPhone/iPad App Store IPA for one commit, end to end, without uploading.
#
#   qa/ios-rc/release.sh <commit>        (run from the qa/ios-rc-1-0 worktree)
#
# 1. Points the "iOS release candidate" workflow (.github/workflows/ios-rc.yml)
#    at the commit and pushes this branch: a GitHub macOS runner builds the
#    unsigned App Store archive (build number = commits up to the commit), a
#    simulator build, and smoke-tests it on an iPhone and an iPad simulator.
# 2. Downloads the archive, signs and exports it here (finalize.py), with the
#    owner's Apple Development identity and Xcode's cloud-managed Apple
#    Distribution certificate, and inspects the IPA.
# 3. Runs `altool --validate-app` (never --upload-app).
# Output: ~/Documents/done App Store release/done-1.0-<build>.ipa and
# done-1.0-<build>-logs/. About 15-25 minutes, most of it the runner.
# DONE_RC_RUN=<run id> reuses a finished run of the same commit.
set -euo pipefail
here=${0:A:h}
repo=$(git -C "$here" rev-parse --show-toplevel)
cd "$repo"
[[ $(git branch --show-current) == qa/ios-rc-1-0 ]] || { echo "Run this from the qa/ios-rc-1-0 worktree"; exit 1; }
release="$HOME/Documents/done App Store release"
env_file="$HOME/Documents/Codex/2026-11-03/desktop-development-hop-wt-launch-readiness/work/notary-private/environment.sh"

disk() { # free GB on the home volume; stop below 5
  local free=$(df -g ~ | awk 'NR==2{print $4}')
  echo "free disk: ${free} GB ($1)"
  (( free >= 5 )) || { echo "Under 5 GB free: stopping"; exit 1; }
}

git fetch -q origin
sha=$(git rev-parse --verify "${1:?usage: release.sh <commit>}^{commit}")
if [[ -z ${DONE_RC_ALLOW_UNMERGED:-} ]] && ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "$sha is not on origin/main (DONE_RC_ALLOW_UNMERGED=1 to build it anyway)"; exit 1
fi
build=$(git rev-list --count "$sha")
(( build > 298 )) || { echo "Build number $build is not above 298"; exit 1; }
echo "commit $sha -> done 1.0 ($build)"
disk start
work=${DONE_RC_WORK:-/tmp/done-ios-rc}/$build
logs="$release/done-1.0-$build-logs"
rm -rf "$work"; mkdir -p "$work" "$logs"

# 1. The runner.
run=${DONE_RC_RUN:-}
if [[ -z $run ]]; then
  if [[ $(tr -d '[:space:]' < qa/ios-rc/SOURCE_SHA 2>/dev/null) != "$sha" ]]; then
    print -r -- "$sha" > qa/ios-rc/SOURCE_SHA
    git add qa/ios-rc/SOURCE_SHA
    git commit -q -m "rc: done 1.0 ($build) from ${sha:0:7}" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  else
    git commit -q --allow-empty -m "rc: rebuild done 1.0 ($build) from ${sha:0:7}" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  fi
  git push -q origin HEAD:qa/ios-rc-1-0
  head=$(git rev-parse HEAD)
  for i in {1..40}; do
    run=$(gh run list -b qa/ios-rc-1-0 -w ios-rc.yml -c "$head" -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
    [[ -n $run ]] && break; sleep 6
  done
  [[ -n $run ]] || { echo "No workflow run appeared for $head"; exit 1; }
fi
url="https://github.com/Juliusolsson05/done/actions/runs/$run"
echo "workflow run: $url"
gh run watch "$run" --interval 30 > "$work/watch.log" 2>&1 || true
gh run view "$run" --json jobs -q '.jobs[]|"\(.name): \(.conclusion)"' | tee "$logs/jobs.txt"
grep -q '^device: success$' "$logs/jobs.txt" || { echo "The archive job failed: $url"; exit 1; }
gh run download "$run" -n ios-device-archive -D "$work"
gh run download "$run" -n build-proof -D "$logs/build-proof"
for family in iPhone iPad; do gh run download "$run" -n "smoke-$family" -D "$logs/smoke-$family" 2>/dev/null || echo "no smoke-$family artifact"; done
grep -q "^source=$sha$" "$logs/build-proof/build-proof.txt" && grep -q "^build=$build$" "$logs/build-proof/build-proof.txt" \
  || { echo "The run built another commit or build number"; exit 1; }
disk "archive downloaded"

# 2. Sign, export, inspect.
python3 -I "$here/finalize.py" "$build" "$work" "$release" | tee "$logs/inspect.txt"
cp "$work/distribution.log" "$logs/"
ipa="$release/done-1.0-$build.ipa"

# 3. Apple's validation (no upload).
(
  source "$env_file" >/dev/null
  export API_PRIVATE_KEYS_DIR=${APPLE_API_KEY_PATH:h}
  xcrun altool --validate-app -f "$ipa" -t ios --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER" --output-format normal
) > "$logs/validate.log" 2>&1 && validated=yes || validated=no
grep -vE 'Running altool at path' "$logs/validate.log" | sed '/^$/d'

rm -rf "$work"
disk end
echo
echo "IPA:       $ipa"
echo "build:     $build (commit $sha)"
echo "sha256:    $(shasum -a 256 "$ipa" | cut -d' ' -f1)"
echo "run:       $url"
echo "validated: $validated"
echo "logs:      $logs"
grep -q 'smoke (iPhone): success' "$logs/jobs.txt" && grep -q 'smoke (iPad): success' "$logs/jobs.txt" || { echo "The simulator smoke test did not pass"; exit 1; }
[[ $validated == yes ]]
