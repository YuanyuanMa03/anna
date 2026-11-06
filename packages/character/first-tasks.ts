/** Three bounded first tasks derived from directory metadata; no file contents or model call. */
export function firstTasks(files: string[], trusted: boolean): string[] {
  const visible = files.filter(name => !name.startsWith('.'))
  const text = visible.find(name => /^(?:readme|说明)/i.test(name)) ?? visible.find(name => /\.(?:md|txt)$/i.test(name))
  const project = visible.some(name => /^(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(name))
  return [
    '只读查看这个工作文件夹的顶层内容，告诉我有哪些文件、可以从哪里开始。',
    text ? `阅读文件 ${JSON.stringify(text)}，用三句话解释它讲了什么，不修改文件。` : '和我一起想一想这个工作文件夹可以用来做什么，先在对话里给出三个建议。',
    project ? '只读查看项目说明和入口文件，用通俗语言解释这个项目怎样运行。' : trusted ? '先给我看一份 hello-anna.md 的简短草稿，等我确认后再创建文件。' : '介绍一下你能怎样帮助我整理文件，先给方案，不运行命令、不修改文件。',
  ]
}
