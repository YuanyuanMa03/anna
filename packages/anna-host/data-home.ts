import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultSettings } from './settings'

/**
 * Sets the brain that was on aside, so she starts with no model chosen, the way a new install does. What was saved stays
 * in `before-0.6/` (Anna's own data, out of every tool's reach) rather than being deleted.
 */
function startBrainAfresh(data: string) {
  const path = join(data, 'settings.json')
  const raw = readFileSync(path, 'utf8')
  let saved: Record<string, unknown>
  try { saved = JSON.parse(raw) }
  // Left as it is: the host reports a settings file it cannot read.
  catch { return }
  if (!saved || typeof saved !== 'object')
    return
  const aside = join(data, 'before-0.6')
  mkdirSync(aside, { recursive: true, mode: 0o700 })
  writeFileSync(join(aside, 'settings.json'), raw, { mode: 0o600 })
  if (existsSync(join(data, 'credential.bin')))
    renameSync(join(data, 'credential.bin'), join(aside, 'credential.bin'))
  const { modelVerified: _verified, sessionFile: _session, ...kept } = saved
  const { kernel, model } = defaultSettings()
  writeFileSync(path, JSON.stringify({ ...kept, kernel, model }, null, 2), { mode: 0o600 })
}

/**
 * Brings the data of an earlier release to where this one keeps it, once. Her memory, sessions and agent backups come along;
 * her brain starts afresh. A link stays behind, because other programs saved paths into the old folder (an agent's config
 * under global routing) and it also marks the move as done. Runs before anything opens the data.
 */
export function moveDataHome(from: string, to: string) {
  if (existsSync(to) || !existsSync(join(from, 'settings.json')))
    return false
  mkdirSync(dirname(to), { recursive: true })
  // A link the person made themselves (their data on another disk): the data stays where they put it, and the new place links there too.
  if (lstatSync(from).isSymbolicLink()) {
    symlinkSync(realpathSync(from), to)
    startBrainAfresh(to)
    return true
  }
  try {
    renameSync(from, to)
    // Only a convenience: the move is done without it, and the old folder is gone either way.
    try { symlinkSync(to, from) }
    catch {}
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV')
      throw error
    // A folder linked to another disk: copy instead, and the earlier folder simply stays. A copy that stops halfway must
    // not pass for the new home, so it only takes the name once it is whole.
    const moving = `${to}.moving`
    rmSync(moving, { recursive: true, force: true })
    cpSync(from, moving, { recursive: true })
    renameSync(moving, to)
  }
  startBrainAfresh(to)
  return true
}
