"""Import local Live2D assets without network access or runtime code."""
import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]).expanduser().resolve()
models = source / 'packages/stage-ui/src/assets/live2d/models'
for character, archive in [('hiyori', 'hiyori_free_zh.zip'), ('haru', 'haru.zip'), ('mark', 'mark.zip')]:
    target = root / 'assets/characters' / character
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(models / archive) as entries:
        for entry in entries.infolist():
            if not (target / entry.filename).resolve().is_relative_to(target.resolve()):
                raise ValueError('Asset archive contains an invalid path')
        entries.extractall(target)
    shutil.copy2(models / f'{character}.jpg', target / 'portrait.jpg')
core = next((source / 'apps/stage-web/dist-anna/assets/js').rglob('live2dcubismcore.min.js'))
shutil.copy2(core, root / 'assets/live2dcubismcore.min.js')
shutil.copytree(source / 'apps/stage-web/dist-anna/licenses', root / 'assets/licenses', dirs_exist_ok=True)
expected = json.loads((root / 'docs/asset-inventory.json').read_text())
for entry in expected:
    path = root / entry['path']
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
        raise ValueError(f'Asset checksum differs: {entry["path"]}')
print('All local assets match the recorded SHA-256 inventory.')
