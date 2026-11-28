"""Prepare Xcode's Rust workspace without changing other platforms' SQLite."""
import re
import shutil
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[3]
mirror = Path(sys.argv[1]).resolve()
mirror.mkdir(parents=True, exist_ok=True)


def link(source, destination):
    if destination.is_symlink() and destination.resolve() == source.resolve():
        return
    destination.symlink_to(source, target_is_directory=source.is_dir())


shutil.copyfile(root / 'Cargo.toml', mirror / 'Cargo.toml')
shutil.copyfile(Path(__file__).with_name('Cargo.lock'), mirror / 'Cargo.lock')
link(root / 'ui', mirror / 'ui')
for name in ['core', 'mcp', 'app', 'server']:
    source = root / 'crates' / name
    dest = mirror / 'crates' / name
    dest.mkdir(parents=True, exist_ok=True)
    manifest = (source / 'Cargo.toml').read_text()
    if name == 'core':
        # An independent lockfile permits the bindings that support iOS 15's
        # SQLite. All other platforms continue to bundle current SQLite.
        manifest, changes = re.subn(r'^rusqlite = .+$', 'rusqlite = "=0.40.2"', manifest, flags=re.MULTILINE)
        if changes != 1:
            raise RuntimeError('Expected one rusqlite dependency in done-core')
    (dest / 'Cargo.toml').write_text(manifest)
    for child in source.iterdir():
        if child.name not in {'Cargo.toml', 'ios-rust', 'target'}:
            link(child, dest / child.name)
