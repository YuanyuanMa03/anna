import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

/**
 * Where Anna keeps its data on each platform.
 * macOS keeps the location earlier releases used; Linux follows XDG; Windows uses %APPDATA%.
 */
export function dataDirectory(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, appData: string, home = homedir()) {
  if (env.ANNA_DATA_DIR)
    return env.ANNA_DATA_DIR
  // Join with the target platform's separator, not the host's.
  const { join } = platform === 'win32' ? win32 : posix
  if (platform === 'win32')
    return join(appData, 'Anna')
  if (platform === 'linux')
    return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'anna')
  return join(home, '.local', 'share', 'anna-dsh')
}
