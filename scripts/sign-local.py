"""Sign the application from the inside out.

Uses the self-signed "Anna Local Signing" identity when it exists (scripts/create-signing-identity.sh), so every
release keeps the same designated requirement and macOS keeps folder permissions across updates. Keychain items still
ask once per new build: with no Apple team ID, their partition list pins each build's cdhash.
Falls back to an ad-hoc signature, which changes on every build.
Override with ANNA_SIGN_IDENTITY (a name or SHA-1 hash; "-" forces ad-hoc).
"""
import json
import os
import plistlib
import subprocess
import sys
from pathlib import Path

app = Path(sys.argv[1]).resolve()
NAME = 'Anna Local Signing'
identity = os.environ.get('ANNA_SIGN_IDENTITY')
if not identity:
    found = subprocess.run(['/usr/bin/security', 'find-identity', '-v', '-p', 'codesigning'], capture_output=True, text=True).stdout
    identity = NAME if f'"{NAME}"' in found else '-'
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
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', identity, '--timestamp=none', '--preserve-metadata=entitlements,flags', str(path)], check=True, capture_output=True)
subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)], check=True)
print(json.dumps({'signing': 'ad-hoc' if identity == '-' else 'self-signed', 'certificate': None if identity == '-' else identity, 'notarized': False, 'strict_verification': True, 'mach_o_files': len(files), 'bundles': len(bundles)}, indent=2))
