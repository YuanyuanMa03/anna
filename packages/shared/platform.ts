import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

/**
 * Where Anna keeps its data on each platform: the platform's own place for app data on macOS and Windows
 * (~/Library/Application Support, %APPDATA%), and XDG on Linux.
 */
export function dataDirectory(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, appData: string, home = homedir()) {
  if (env.ANNA_DATA_DIR)
    return env.ANNA_DATA_DIR
  // Join with the target platform's separator, not the host's.
  const { join } = platform === 'win32' ? win32 : posix
  if (platform === 'linux')
    return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'anna')
  return join(appData, 'Anna')
}

/** Where releases up to 0.5 kept the data on macOS, the one platform where the place has changed. */
export function earlierDataDirectory(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home = homedir()) {
  return platform === 'darwin' && !env.ANNA_DATA_DIR ? posix.join(home, '.local', 'share', 'anna-dsh') : undefined
}
