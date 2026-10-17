import { readFile, rename, writeFile } from 'node:fs/promises'

/** Read Anna's own JSON state; a missing file is the fallback, any other failure is an error. */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return fallback
    throw error
  }
}

/** Replace the file atomically and keep it private to the user. */
export async function writeJson(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 1), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}
