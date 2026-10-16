"""Seal local application code from the inside out with an ad-hoc signature."""
import json
import os
import plistlib
import subprocess
import sys
from pathlib import Path

app = Path(sys.argv[1]).resolve()
if app.suffix != '.app' or not (app / 'Contents/Info.plist').is_file():
    raise ValueError('Expected a complete macOS application bundle')
magic = {bytes.fromhex(x) for x in ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']}
files, bundles = [], [app]
for base, directories, names in os.walk(app, followlinks=False):
    directory = Path(base)
    directories[:] = [name for name in directories if not (directory / name).is_symlink()]
    if directory != app and directory.suffix in ['.app', '.framework', '.xpc']:
        bundles.append(directory)
    for name in names:
        path = directory / name
        if path.is_symlink():
            continue
        with path.open('rb') as stream:
            header = stream.read(4)
        if header in magic:
            kind = subprocess.check_output(['/usr/bin/file', '--brief', str(path)], text=True)
            if 'Mach-O' in kind:
                files.append(path)
for path in files + sorted(bundles, key=lambda p: -len(p.parts)):
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements,flags', str(path)], check=True, capture_output=True)
subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)], check=True)
print(json.dumps({'signing': 'ad-hoc', 'certificate': None, 'notarized': False, 'strict_verification': True, 'mach_o_files': len(files), 'bundles': len(bundles)}, indent=2))
