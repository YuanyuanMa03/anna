"""Stop only the installed Anna and this project's development window."""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
installed = Path.home() / 'Applications/Anna.app/Contents/MacOS/Anna'
development = (root / 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron').resolve()
pids = []
for line in subprocess.check_output(['/bin/ps', '-axo', 'pid=,command='], text=True).splitlines():
    pid, command = line.strip().split(None, 1)
    if command == str(installed) or command.startswith(str(installed) + ' --') or command.startswith(str(development) + ' dist/host/apps/desktop/main.js'):
        pids.append(int(pid))
for pid in pids:
    os.kill(pid, signal.SIGTERM)
for pid in pids:
    deadline = time.monotonic() + 20
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        if time.monotonic() > deadline:
            raise RuntimeError(f'Anna process {pid} did not exit. Installation did not start.')
        time.sleep(0.1)
print(f'Confirmed shutdown of {len(pids)} Anna windows.')
