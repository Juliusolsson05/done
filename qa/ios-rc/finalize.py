"""Sign, export and inspect the App Store IPA from the runner's unsigned archive.

python3 -I finalize.py <build> <work dir> <output dir>

The work dir holds done-1.0-<build>.xcarchive.zip (from the ios-rc workflow).
Steps, as for build 298 (/tmp/done-asc-279/finalize.py):
1. check the unsigned archive (ids, version, build, iPhone and iPad, SQLite);
2. sign it with the owner's Apple Development identity and team profiles, so
   the archive carries its entitlements (an unsigned archive exports without
   them);
3. `xcodebuild -exportArchive` for App Store Connect, automatic signing: Xcode
   re-signs with the cloud-managed Apple Distribution certificate and the
   App Store profiles;
4. unzip the IPA and inspect it; write inspect.txt; copy the IPA to the
   output dir as done-1.0-<build>.ipa.
Nothing here prints a certificate, profile or key; only their names and kinds.
"""
import datetime, hashlib, plistlib, re, shutil, subprocess, sys
from pathlib import Path

TEAM = '99MUK5B6TA'
GROUP = ['group.app.thedone']
APP_ID, WIDGET_ID = 'app.thedone.ios', 'app.thedone.ios.widgets'
build, work, out_dir = sys.argv[1], Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve()
here = Path(__file__).resolve().parent
report = []


def say(*parts):
    line = ' '.join(str(p) for p in parts)
    print(line)
    report.append(line)


def run(args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kw).stdout


def plist(path):
    return plistlib.loads(Path(path).read_bytes())


def profile_of(path):
    return plistlib.loads(subprocess.check_output(['security', 'cms', '-D', '-i', str(path)], stderr=subprocess.DEVNULL))


# Distribution entitlements, as Apple signed build 298.
def expected(bundle):
    e = {'application-identifier': f'{TEAM}.{bundle}', 'beta-reports-active': True, 'com.apple.developer.team-identifier': TEAM,
         'com.apple.security.application-groups': GROUP, 'get-task-allow': False}
    if bundle == APP_ID:
        e['com.apple.developer.applesignin'] = ['Default']
    return e


def development(bundle):
    e = {k: v for k, v in expected(bundle).items() if k != 'beta-reports-active'}
    e['get-task-allow'] = True
    return e


def check_bundle(path, bundle):
    d = plist(path / 'Info.plist')
    assert d['CFBundleIdentifier'] == bundle, d['CFBundleIdentifier']
    assert d['CFBundleShortVersionString'] == '1.0', d['CFBundleShortVersionString']
    assert d['CFBundleVersion'] == build, d['CFBundleVersion']
    assert sorted(d['UIDeviceFamily']) == [1, 2], d['UIDeviceFamily']
    assert d['DTPlatformName'] == 'iphoneos' and d['DTSDKName'].startswith('iphoneos'), d['DTSDKName']
    assert d['MinimumOSVersion'] == '16.4', d['MinimumOSVersion']
    assert d.get('ITSAppUsesNonExemptEncryption') is False, d.get('ITSAppUsesNonExemptEncryption')
    return d


def check_binary(path):
    assert re.search(r'^_(?:f)?statfs$', run(['nm', '-u', str(path)]), re.M) is None, f'{path}: statfs (iOS 16 SQLite trap)'


# 1. The unsigned archive.
archive = work / 'done-app_iOS.xcarchive'
if not archive.exists():
    run(['ditto', '-x', '-k', str(work / f'done-1.0-{build}.xcarchive.zip'), str(work)])
app = Path('Products/Applications/done.app')
widget = app / 'PlugIns/done-widgets.appex'
check_bundle(archive / app, APP_ID)
check_bundle(archive / widget, WIDGET_ID)
check_binary(archive / app / 'done')
check_binary(archive / widget / 'done-widgets')
assert '/usr/lib/libsqlite3' in run(['otool', '-L', str(archive / app / 'done')])
assert 'C617.1' in str(plist(archive / app / 'PrivacyInfo.xcprivacy'))

# 2. Development signature: a valid Apple Development identity of the team and
# the team profiles in Xcode's folder that include its certificate.
identities = run(['security', 'find-identity', '-v', '-p', 'codesigning'])
valid = [(m.group(1), m.group(2)) for m in re.finditer(r'\d+\) ([0-9A-F]{40}) "(Apple Development: [^"]+)"(.*)', identities) if 'REVOKED' not in m.group(3)]
assert valid, 'No valid Apple Development identity in the keychain'
profiles_dir = Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles'
now = datetime.datetime.now(datetime.timezone.utc)
chosen = None
for fingerprint, name in valid:
    found = {}
    for f in sorted(profiles_dir.glob('*.mobileprovision')):
        p = profile_of(f)
        aid = p['Entitlements'].get('application-identifier')
        if p['Entitlements'].get('get-task-allow') is not True or p['ExpirationDate'].replace(tzinfo=datetime.timezone.utc) < now:
            continue
        if not any(hashlib.sha1(c).hexdigest().upper() == fingerprint for c in p['DeveloperCertificates']):
            continue
        for bundle in (APP_ID, WIDGET_ID):
            if aid == f'{TEAM}.{bundle}':
                found[bundle] = f
    if len(found) == 2:
        chosen = (fingerprint, name, found)
        break
assert chosen, 'No Apple Development identity with team profiles for both app.thedone.ios and app.thedone.ios.widgets'
fingerprint, identity_name, found = chosen
say('development signing:', identity_name.split('(')[0].strip(), '| profiles:', ', '.join(profile_of(found[b])['Name'] for b in (APP_ID, WIDGET_ID)))
for bundle, rel in [(WIDGET_ID, widget), (APP_ID, app)]:
    dest = archive / rel
    ents = work / f'dev-{bundle}.entitlements'
    ents.write_bytes(plistlib.dumps(development(bundle)))
    shutil.copyfile(found[bundle], dest / 'embedded.mobileprovision')
    run(['codesign', '--force', '--sign', fingerprint, '--timestamp=none', '--generate-entitlement-der', '--entitlements', str(ents), str(dest)])
run(['codesign', '--verify', '--deep', '--strict', str(archive / app)])
info = plist(archive / 'Info.plist')
info['ApplicationProperties']['Team'] = TEAM
info['ApplicationProperties']['SigningIdentity'] = identity_name.split(':')[0]
(archive / 'Info.plist').write_bytes(plistlib.dumps(info))

# 3. Export for App Store Connect.
export = work / 'distribution'
shutil.rmtree(export, ignore_errors=True)
with (work / 'distribution.log').open('w') as log:
    subprocess.run(['xcodebuild', '-exportArchive', '-archivePath', str(archive), '-exportPath', str(export),
                    '-exportOptionsPlist', str(here / 'StoreExportOptions.plist'), '-allowProvisioningUpdates'],
                   stdout=log, stderr=subprocess.STDOUT, check=True)
summary = plist(export / 'DistributionSummary.plist')['done.ipa'][0]
for item in [summary, *summary['embeddedBinaries']]:
    bundle = item['entitlements']['application-identifier'].split('.', 1)[1]
    assert item['entitlements'] == expected(bundle), (bundle, item['entitlements'])
    assert item['versionNumber'] == '1.0' and str(item['buildNumber']) == build
    say('export summary:', item['name'], '| certificate:', item['certificate']['type'], '| profile:', item['profile']['name'])

# 4. Inspect the IPA itself.
ipa = export / 'done.ipa'
unpacked = work / 'verify-ipa'
shutil.rmtree(unpacked, ignore_errors=True)
run(['ditto', '-x', '-k', str(ipa), str(unpacked)])
root = unpacked / 'Payload/done.app'
say('codesign --verify --deep --strict:', subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(root)], capture_output=True, text=True, check=True).stderr.strip().replace('\n', ' | '))
for path, bundle in [(root, APP_ID), (root / 'PlugIns/done-widgets.appex', WIDGET_ID)]:
    d = check_bundle(path, bundle)
    say(f'{bundle}: CFBundleShortVersionString={d["CFBundleShortVersionString"]} CFBundleVersion={d["CFBundleVersion"]} MinimumOSVersion={d["MinimumOSVersion"]}'
        f' UIDeviceFamily={d["UIDeviceFamily"]} ITSAppUsesNonExemptEncryption={d["ITSAppUsesNonExemptEncryption"]} DTSDKName={d["DTSDKName"]} DTPlatformName={d["DTPlatformName"]}')
    ent = plistlib.loads(subprocess.check_output(['codesign', '-d', '--entitlements', ':-', str(path)], stderr=subprocess.DEVNULL))
    assert ent == expected(bundle), ent
    assert 'aps-environment' not in ent
    say(f'{bundle}: entitlements={ent}')
    detail = subprocess.run(['codesign', '-dvv', str(path)], capture_output=True, text=True).stderr
    authority = [l.split('=', 1)[1] for l in detail.splitlines() if l.startswith('Authority=')]
    team = [l.split('=', 1)[1] for l in detail.splitlines() if l.startswith('TeamIdentifier=')]
    assert authority and authority[0].startswith('Apple Distribution') and team == [TEAM], (authority, team)
    say(f'{bundle}: signed by {authority[0].split(":")[0]} (chain {" > ".join(a.split(":")[0] for a in authority)}), team {team[0]}')
    p = profile_of(path / 'embedded.mobileprovision')
    pe = p['Entitlements']
    store = 'ProvisionedDevices' not in p and not p.get('ProvisionsAllDevices') and pe.get('get-task-allow') is False and pe.get('beta-reports-active') is True
    assert store and p['TeamIdentifier'] == [TEAM] and pe['application-identifier'] == f'{TEAM}.{bundle}', p['Name']
    say(f'{bundle}: profile "{p["Name"]}" team {p["TeamIdentifier"][0]}, App Store (no device list, get-task-allow false, beta-reports-active true), expires {p["ExpirationDate"].date()}')
assert 'C617.1' in str(plist(root / 'PrivacyInfo.xcprivacy'))
say('PrivacyInfo.xcprivacy: present,', ', '.join(sorted({r for t in plist(root / 'PrivacyInfo.xcprivacy').get('NSPrivacyAccessedAPITypes', []) for r in t.get('NSPrivacyAccessedAPITypeReasons', [])})))
# Every Mach-O in the IPA: arm64 only, built for iOS devices (platform 2), not the simulator (7).
machos = [f for f in unpacked.rglob('*') if f.is_file() and not f.is_symlink() and f.read_bytes()[:4] in (b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe')]
for f in machos:
    archs = run(['lipo', '-archs', str(f)]).split()
    platforms = set(re.findall(r'platform (\d+)', run(['otool', '-l', str(f)])))
    assert archs == ['arm64'] and platforms <= {'2'}, (f, archs, platforms)
    say(f'slice: {f.relative_to(unpacked)} archs={archs} platform={sorted(platforms) or "n/a (no LC_BUILD_VERSION)"}')
check_binary(root / 'done')
check_binary(root / 'PlugIns/done-widgets.appex/done-widgets')
say('binary contains "thedone.app":', run(['/bin/sh', '-c', f'strings -a "{root}/done" | grep -c -F thedone.app || true']).strip(), 'times (Tauri embeds the interface brotli-compressed)')

out_dir.mkdir(parents=True, exist_ok=True)
out = out_dir / f'done-1.0-{build}.ipa'
if out.exists() and out.read_bytes() != ipa.read_bytes():
    old = out.with_suffix(f'.ipa.{datetime.datetime.now():%Y%m%d%H%M%S}.old')
    out.rename(old)
    say('previous IPA kept as', old)
shutil.copyfile(ipa, out)
say('ipa:', out, 'sha256', hashlib.sha256(out.read_bytes()).hexdigest(), out.stat().st_size, 'bytes')
(work / 'inspect.txt').write_text('\n'.join(report) + '\n')
