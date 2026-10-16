"""Replace the installed Anna only after strict verification of the new bundle."""
import json
import plistlib
import shutil
import subprocess
import uuid
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = root / 'dist/macos/Anna.app'
target = Path.home() / 'Applications/Anna.app'
expected = 'com.yuanyuanma.anna'
replaced = target.exists()
for app in [source, target]:
    if app.exists():
        identity = plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleIdentifier']
        if identity != expected or app.is_symlink():
            raise ValueError(f'Application identity does not match Anna: {app}')
subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(source)], check=True)
subprocess.run(['/usr/bin/python3', str(root / 'scripts/stop-mac.py')], check=True)
target.parent.mkdir(parents=True, exist_ok=True)
staged = target.parent / f'.anna-install-{uuid.uuid4().hex}.app'
previous = target.parent / f'.anna-replaced-{uuid.uuid4().hex}.app'
try:
    subprocess.run(['/usr/bin/ditto', str(source), str(staged)], check=True)
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(staged)], check=True)
    if target.exists():
        target.rename(previous)
    try:
        staged.rename(target)
    except BaseException:
        if previous.exists():
            previous.rename(target)
        raise
    if previous.exists():
        shutil.rmtree(previous)
finally:
    if staged.exists():
        shutil.rmtree(staged)
print(json.dumps({'installed': str(target), 'previous_app_removed': replaced, 'user_data': 'preserved'}, indent=2))
