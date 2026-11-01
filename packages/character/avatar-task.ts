/** Where a picture waits in the workspace while Anna turns it into a full avatar with Mesh Avatar Studio. */
export const avatarFolder = 'anna-avatar'
/** Studio moves fast; this is the commit its guide was read at. */
const studio = { url: 'https://github.com/shinshin86/mesh-avatar-studio.git', commit: '5e1be84' }

/** What the person asks of her when they hand over a picture. Everything in it happens as ordinary work, under her permissions. */
export const avatarTask = `请把 ${avatarFolder}/source.png 这张图做成我的 Anna 形象。

用 Mesh Avatar Studio：把 ${studio.url} 克隆到 ${avatarFolder}/studio，切到提交 ${studio.commit}，运行 npm install，然后严格按它的 docs/agent-guide.md 一步步做，项目名用 mine。

- 每一步的检查都要真的看过结果。过不了就如实告诉我卡在哪，不要跳过。
- 第 6 步的绘制差分会把图发给图像生成服务，先问我同不同意。我不同意，或者你生成不了图，就跳过这一步。
- 图和做出来的东西都留在这台电脑上，不要提交，也不要上传到别处。

全部通过后，在 studio 目录运行 npm run pack-avatar -- projects/mine --no-source -o ../mine.mavatar。最后告诉我文件在哪、还有哪里你没把握。我会在“创造我的 Anna”里选这个文件换上。`
