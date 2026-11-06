import { realpath, stat } from 'node:fs/promises'

/** Leave native paths untouched: drive letters, spaces, Unicode and UNC shares belong to the OS. */
export async function resolveWorkspace(input: string, fs: { realpath: (path: string) => Promise<string>, stat: (path: string) => Promise<{ isDirectory: () => boolean }> } = { realpath, stat }): Promise<string> {
  try {
    const path = await fs.realpath(input)
    if (!(await fs.stat(path)).isDirectory())
      throw new Error('请选择一个工作文件夹，而不是文件')
    return path
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR')
      throw new Error('这个工作目录不存在或已经断开。请重新选择；网络目录请先连接对应的网络位置。')
    if (code === 'EACCES' || code === 'EPERM')
      throw new Error('没有权限访问这个目录。请在系统中授权，或选择其他文件夹。')
    if (['ENOTCONN', 'EHOSTUNREACH', 'ENETUNREACH', 'EIO'].includes(code ?? ''))
      throw new Error('这个目录当前不可用。网络目录请检查连接，外接磁盘请确认已经挂载。')
    throw error
  }
}
