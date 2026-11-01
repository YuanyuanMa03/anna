# Anna 专属 Live2D 模型

这是由生成原画制作、经 Anna 自带 Cubism Core 验证的第一版模型。人物为成年女性，沿用用户选定的半写实画风、托腮姿态和圆领长袖针织衫。房间与人物独立渲染。

- `anna.cmo3`：可在 Cubism Editor 中继续编辑的工程。
- `anna.psd2live`：包含素材与绑定历史的 PSD2Live 工程。
- `source/anna.png`：透明人物素材。
- `source/expressions.png`：与人物配准的闭眼、张口素材。
- 运行用模型在 `assets/anna-room/`，包含真实 `.moc3`、`.model3.json`、纹理和参数显示信息。

当前是固定构图的轻量绑定：人物网格、两个眼睑层、一个口型层，配合六层局部网格变形器。头部、身体、发丝、眉眼与嘴型支持小幅参数变化。眼睑和口型含表情层混合，不是分别拆出眼白、瞳孔、上下唇的精细绑定；不支持大幅侧身或手离开脸的动作。这个边界不能被“真实 Live2D 文件”替代成更高的美术质量承诺。

构建工具使用独立的 [PSD2Live](https://github.com/tsunehimatoi/psd2live) 3.6.7（GPL-3.0），工具本体不进入 Anna 仓库或运行依赖，仅保留由本项目原画生成的模型。下载包 SHA-256：`505e05346a91ad058525c84fcdd49d004c944cb880dce9cf43132a655476ca30`。Cubism Core 使用本仓库既有版本，遵循根目录 NOTICE.md 中已有授权说明。

原画处理使用会话内 ImageGen：从已有长袖原画分别生成透明人物、同位置闭眼张口变体、去人物的房间底图；没有使用第三方角色原画或示例模型的网格。生成后只做确定性的图层裁切、边缘羽化与纹理打包。

重建：安装 JDK 21；将两张 source PNG 复制到 `artifacts/live2d-authoring/`，运行 `java scripts/live2d/PrepareArtwork.java artifacts/live2d-authoring`（表情图名为 `expressions.png`）；启动单独的 PSD2Live headless MCP 服务，将 `PSD2LIVE_CHECKOUT` 指向其源码目录，并在本机环境设置 `PSD2LIVE_MCP_ENDPOINT`、`PSD2LIVE_MCP_TOKEN`；运行 `python3 scripts/live2d/build-model.py`。授权令牌不应写入项目文件。完成后运行 `node tests/room-model.mjs` 验证实际二进制控制效果。

接入只涉及桌面 renderer：`room-stage.vue`、`room.css`、`app.vue` 和样式入口。Host、kernel、RPC、权限、会话、记忆、工具和模型请求代码保持原样。当前用户选定的角色身份和声音继续生效；主动选择其他原有角色时切回其原有模型，也可通过顶部按钮返回房间外观。
