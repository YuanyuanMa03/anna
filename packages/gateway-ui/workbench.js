const app = document.querySelector('#app')
const dialog = document.querySelector('#dialog')
let token = ''
let snapshot
let tab = 'overview'
let currentPage = 1
let kind = 'speech'
let selectedModel = ''
let deviceKey = ''
let requestController
let audioURL
let lastResult = ''
const titles = { overview: '总览', services: '服务接入', devices: '设备密钥', usage: '用量额度', deployment: '部署连接', playground: '试用 Anna 的能力' }
const names = { llm: '文字思考', asr: '听见声音', tts: '说出回应' }
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[char])
const count = value => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN').format(value) : '未知'
const time = value => value ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false }) : '尚无记录'
const brand = '<div class="brand"><img src="/anna.svg" alt="Anna"><div><b>Anna</b><small>SERVICE WORKBENCH</small></div></div>'
const enabled = () => snapshot.services.items.filter(service => service.status === 1)
const models = () => [...new Set(enabled().flatMap(service => service.models.split(',')).filter(Boolean))]
function endpoint() {
  const d = snapshot.deployment
  const host = ['0.0.0.0', '::'].includes(d.host) ? d.addresses[0] : d.host
  const inferred = d.access === 'network' && host ? `http://${host.includes(':') ? `[${host}]` : host}:${new URL(d.dataAddress).port}/v1` : d.dataAddress
  const value = d.publicURL || inferred
  return `${value.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/v1`
}
function notice(message, error = false) {
  const element = document.querySelector('#toast')
  element.textContent = message
  element.className = error ? 'error' : ''
  element.hidden = false
}
async function api(path, body, method) {
  const response = await fetch(path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const value = await response.json()
  if (!response.ok) {
    if (response.status === 401 && path !== '/manage/login') { token = ''; loginView() }
    throw new Error(value.error || '操作未完成。')
  }
  return value
}
async function refresh(renderPage = true) {
  try { snapshot = await api(`/manage/snapshot?page=${currentPage}`) }
  catch (error) {
    const status = document.querySelector('.online')
    if (status)
      status.textContent = '连接失败，当前显示上次成功数据'
    throw error
  }
  if (renderPage)
    render()
}
function loginView() {
  app.innerHTML = `<div class="login-wrap"><div class="login-art"><span class="eyebrow">A LITTLE CLOSER, EVERYWHERE.</span><h1>让 Anna 的能力，<br>陪你去更多地方。</h1><p>连接思考、听觉与声音，<br>把熟悉的陪伴带到每一台设备。</p><img src="/anna.svg" alt="抱着笔记本的 Anna"></div><section class="panel login">${brand}<h2>欢迎回到服务工作台</h2><p class="help">使用已有网关账号登录。你的设备密钥与额度会保留。</p><form data-form="login"><label>用户名<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p class="login-error" role="alert"></p><button class="primary" type="submit">进入工作台 →</button></form><p class="help">首次部署请先初始化 New API 后端。本页只在本机开放；其他设备使用独立的 API 地址和设备 Key。</p></section></div>`
}
function addressCard() {
  return `<div class="endpoint"><code>${esc(endpoint())}</code><button data-action="copy-address">复制</button></div><p class="help">一个地址，按设备分配权限。仅网关 Key 会交给客户端，上游 API Key 留在服务端。</p>`
}
function metrics() {
  return `<div class="grid">${['llm', 'asr', 'tts'].map((kind) => {
    const services = enabled().filter(service => service.kind === kind)
    return `<section class="metric"><div class="status"><span class="dot ${services.length ? '' : 'off'}"></span>${names[kind]}</div><strong>${services.length ? `${count(services.length)} 个已启用` : '等待接通'}</strong><small>${services.length ? esc(services.map(service => service.name).join(' · ')) : kind === 'llm' ? '可接云端 API 或其他算力节点' : '接入本机或远端语音服务'}</small></section>`
  }).join('')}</div>`
}
function serviceCards() {
  if (!snapshot.services.items.length)
    return '<div class="empty">还没有接入服务。先为 Anna 连接一种能力。</div>'
  return snapshot.services.items.map(service => `<article class="service"><div class="row"><div><span class="eyebrow">${service.kind.toUpperCase()} · ${service.local ? '后端本机服务' : '远端服务'}</span><h3>${esc(service.name)}</h3></div><span class="pill ${service.status === 1 ? '' : 'off'}">${service.status === 1 ? '已启用' : '已停用'}</span></div><p>${esc(service.baseURL || '提供商默认地址')}</p><div class="models">${service.models.split(',').map(model => `<span class="pill off">${esc(model)}</span>`).join('')}</div><div class="service-footer"><small>${service.testedAt ? `后端验证记录：${esc(time(service.testedAt))}` : '尚无后端验证记录；启用不等于调用已验证'}</small><div class="actions"><button data-action="try-service" data-id="${service.id}" ${service.status !== 1 ? 'disabled' : ''}>试用</button>${snapshot.user.admin ? `<button data-action="service-status" data-id="${service.id}">${service.status === 1 ? '停用' : '启用'}</button>` : ''}</div></div></article>`).join('')
}
function overview() {
  return `<section class="hero"><div class="copy"><div class="hello">● 我在这里，一起接通新的可能。</div><h1>把 Anna 的能力，<br>带到每一台设备。</h1><p>在这里连接模型、分配设备密钥，照看每一次真实调用。</p><div class="actions"><button class="primary" data-tab="playground">试用一下 →</button><button data-action="new-device">连接一台设备</button></div></div><img src="/anna.svg" alt="Anna 正陪你整理服务"></section>${metrics()}<div class="columns"><section class="panel"><div class="heading"><h2>已经接通的能力</h2><button class="quiet" data-tab="services">管理服务 ↗</button></div>${serviceCards()}</section><aside class="panel"><h2>让下一台 Anna 醒来</h2><div class="guide"><div class="guide-item"><span class="number">1</span><div><b>接通一种能力</b><span class="muted">使用官方 API、其他托管服务，或已经启动的模型节点。</span></div></div><div class="guide-item"><span class="number">2</span><div><b>给设备一把自己的钥匙</b><span class="muted">选择模型和额度，随时撤销，不共享管理员身份。</span></div></div><div class="guide-item"><span class="number">3</span><div><b>复制地址，在 Anna 中使用</b><span class="muted">同一局域网即可连接，Tailscale 只是可选项。</span></div></div></div>${addressCard()}<button data-tab="deployment">查看连接方式 ↗</button><div class="notice">${snapshot.deployment.allowLocalLLM ? '允许连接已启动的本机模型；网关不会替你启动它。' : '当前节点不启用本机语言模型。云端模型与语音服务可以照常接入。'}</div></aside></div>`
}
function pagination(total) {
  return `<div class="pagination"><span>共 ${count(total)} 项 · 第 ${currentPage} 页</span><button data-action="previous" ${currentPage === 1 ? 'disabled' : ''}>上一页</button><button data-action="next" ${currentPage * 20 >= total ? 'disabled' : ''}>下一页</button></div>`
}
function devices() {
  return `<section class="panel">${addressCard()}<div class="table-wrap"><table><thead><tr><th>设备</th><th>可用点数</th><th>已使用</th><th>状态与有效期</th><th>操作</th></tr></thead><tbody>${snapshot.devices.items.map(device => `<tr><td>${esc(device.name)}<span class="sub">${esc(device.models || '所有授权模型')} · 最近 ${esc(time(device.accessedAt))}</span></td><td>${device.unlimited ? '不限额' : count(device.remaining)}</td><td>${count(device.used)}</td><td>${device.status === 1 ? '已启用' : '已停用/失效'}<span class="sub">${device.expires === -1 ? '长期有效' : esc(time(device.expires))}</span></td><td><button data-action="device-quota" data-id="${device.id}">设置额度</button> <button class="danger" data-action="device-revoke" data-id="${device.id}" ${device.status !== 1 ? 'disabled' : ''}>撤销</button></td></tr>`).join('')}</tbody></table></div>${snapshot.devices.items.length ? pagination(snapshot.devices.total) : '<div class="empty">还没有设备。为你的下一台电脑创建一个 Key。</div>'}<p class="help">这里是网关内部额度，不是人民币或厂商余额。额度操作设置新的可用余额，不是付款或原子充值；后端保留操作审计与调用记录。已创建 Key 不在页面重复显示。</p></section>`
}
function usage() {
  const speechModels = snapshot.services.items.filter(service => service.kind !== 'llm').flatMap(service => service.models.split(','))
  return `<div class="grid"><section class="metric"><span class="muted">账户可用内部点数</span><strong>${count(snapshot.user.remaining)}</strong><small>不代表模型厂商余额</small></section><section class="metric"><span class="muted">后端累计使用点数</span><strong>${count(snapshot.user.used)}</strong><small>由后端账本报告</small></section><section class="metric"><span class="muted">后端累计请求数</span><strong>${count(snapshot.user.requests)}</strong><small>更新时间 ${esc(new Date(snapshot.updatedAt).toLocaleTimeString())}</small></section></div><section class="panel spacer"><h2>实际工作记录</h2><p class="help">输入 / 输出为后端记录，可能包含上游估算。语音的估算 token 不当作语言模型实际 token；音频时长仅在试用结果可确认时展示。未知值不填零。</p><div class="table-wrap"><table><thead><tr><th>时间 / 设备</th><th>模型</th><th>类型</th><th>输入 / 输出</th><th>耗时</th><th>内部点数</th></tr></thead><tbody>${snapshot.usage.items.map(log => `<tr><td>${esc(time(log.at))}<span class="sub">${esc(log.device || '未提供设备名')}</span></td><td>${esc(log.model || '—')}<span class="sub">${esc(log.requestId)}</span></td><td>${({ 1: '额度记录', 2: '模型调用', 3: '配置操作', 4: '系统记录', 5: '请求失败', 6: '退回' })[log.type] || '工作记录'}</td><td>${speechModels.includes(log.model) ? '语音 · 不换算 token' : `${count(log.input)} / ${count(log.output)}`}</td><td>${count(log.seconds)} 秒</td><td>${count(log.points)}</td></tr>`).join('')}</tbody></table></div>${snapshot.usage.items.length ? pagination(snapshot.usage.total) : '<div class="empty">还没有调用记录。完成第一次试用后，它会出现在这里。</div>'}</section>`
}
function deployment() {
  const d = snapshot.deployment
  return `<div class="columns"><section class="panel"><h2>把服务带到另一台设备</h2><form data-form="deployment"><label>监听范围<select name="access" aria-label="监听范围"><option value="local" ${d.access === 'local' ? 'selected' : ''}>仅本机（默认）</option><option value="network" ${d.access === 'network' ? 'selected' : ''}>局域网 / 外部代理入口</option></select></label><div class="form-grid"><label>监听 IP<input name="host" value="${esc(d.host)}" required placeholder="127.0.0.1 或 0.0.0.0"></label><label>数据端口<input name="port" type="number" min="1" max="65535" value="${d.port}" required></label></div><label>发给设备的地址（可选）<input name="publicURL" value="${esc(d.publicURL)}" placeholder="https://你的域名/v1 或 http://局域网IP:端口/v1"></label><p class="help">填对外地址不会替你部署代理。管理端仍仅在本机开放；应用配置会重启数据入口，进行中的调用会中断，失败时恢复旧配置。</p><button class="primary" type="submit" ${!snapshot.user.admin ? 'disabled' : ''}>保存并应用连接方式</button></form></section><aside class="panel"><h2>选择适合你的连接</h2><div class="guide"><div class="guide-item"><span class="number">1</span><div><b>同一台电脑</b><p class="muted">直接使用本机地址，无需联网工具。</p></div></div><div class="guide-item"><span class="number">2</span><div><b>同一局域网</b><p class="muted">选择 network，监听 0.0.0.0 或网卡 IP，检查防火墙。当前网卡：${esc(d.addresses.join('、') || '未发现')}</p></div></div><div class="guide-item"><span class="number">3</span><div><b>Tailscale（可选）</b><p class="muted">已有 Tailnet 时，把 Serve 指向数据入口；客户端需在同一 Tailnet。</p></div></div><div class="guide-item"><span class="number">4</span><div><b>公共 HTTPS</b><p class="muted">使用现有域名、反向代理或隧道。客户端无需安装 Tailscale。只发布数据端口，不发布控制与管理端口。</p></div></div></div><div class="notice">HTTP 不加密。不要在不受控网络明文传递 Key。监听成功不代表外部设备可达，需要另一台真实设备验证。</div>${addressCard()}</aside></div>`
}
function playground() {
  const serviceKind = { chat: 'llm', speech: 'tts', transcribe: 'asr' }[kind]
  const options = [...new Set(enabled().filter(service => service.kind === serviceKind).flatMap(service => service.models.split(',')))]
  return `<div class="columns"><section class="panel"><div class="tabs">${[['chat', '文字'], ['speech', '语音合成'], ['transcribe', '语音识别']].map(([value, name]) => `<button data-kind="${value}" class="${kind === value ? 'active' : ''}">${name}</button>`).join('')}</div><form data-form="try"><label>设备 API Key<input name="deviceKey" type="password" value="${esc(deviceKey)}" autocomplete="off" required placeholder="粘贴设备 Key；只留在当前页面内存"></label><label>模型<select name="model" aria-label="模型" required>${options.map(model => `<option ${model === selectedModel ? 'selected' : ''}>${esc(model)}</option>`).join('')}</select></label>${kind === 'transcribe' ? '<label>音频文件<input name="file" type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" required></label>' : `<label>${kind === 'chat' ? '想对 Anna 说什么' : '让 Anna 说一句话'}<textarea name="input" aria-label="${kind === 'chat' ? '想对 Anna 说什么' : '让 Anna 说一句话'}" maxlength="${kind === 'chat' ? 2000 : 300}" required>${kind === 'chat' ? '你好，用一句话介绍你能怎样帮助我。' : '你好，我是 Anna。很高兴和你一起工作。'}</textarea></label>`}${kind === 'speech' ? '<label>音色<input name="voice" value="anna" required></label>' : ''}<div class="notice">点击会发送内容到所选服务，并可能消耗少量额度。此处不开放文件修改或命令执行。音频不会自动播放。</div><div class="actions"><button class="primary" type="submit" ${!options.length ? 'disabled' : ''}>${kind === 'chat' ? '发送一次短请求' : kind === 'speech' ? '生成音频（静音）' : '开始识别'}</button><button type="button" data-action="cancel-test">取消请求</button></div>${!options.length ? '<p class="help">还没有启用这类模型。到服务接入中连接云端或已有模型节点。</p>' : ''}</form><div id="test-result" class="result" role="status">${esc(lastResult)}</div><div id="audio-result"></div></section><aside class="panel"><h2>这一次，真实试一试</h2><img src="/anna.svg" alt="Anna" width="140"><p class="help">先创建设备，再试用。每次请求都使用设备自己的权限与额度。离开页面会丢弃输入的 Key。</p><button data-action="new-device">创建设备 Key</button><p class="help">生成的音频可以下载后继续测试语音识别；工作室电脑不需要发出声音。</p><p class="help">文字请求只生成最多 128 个输出 token。语音采用现有节点，网关不会启动本机语言模型。</p></aside></div>`
}
function render() {
  app.innerHTML = `<div class="layout"><aside class="sidebar">${brand}<nav class="nav" aria-label="工作台导航">${Object.keys(titles).map((item, index) => `<button data-tab="${item}" class="${tab === item ? 'active' : ''}"><i>${['◌', '◇', '⌑', '▤', '↗', '▷'][index]}</i>${titles[item]}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="online"><span class="dot"></span>工作台已连接后端</div><small>让能力有来处，让每次相遇有回应。</small><button class="quiet" data-action="logout">退出当前账号</button></div></aside><main class="main"><div class="topbar"><span class="crumb">Anna / 服务工作台 / ${titles[tab]}</span><div class="user"><button class="quiet" data-action="refresh">刷新 ↻</button><span class="avatar-circle">${esc(snapshot.user.name?.slice(0, 1) || 'A')}</span><span class="user-name">${esc(snapshot.user.name)}</span><button class="quiet" data-action="logout" aria-label="退出登录">↪</button></div></div>${tab === 'overview' ? overview() : `<div class="heading"><div class="page-title"><h1>${titles[tab]}</h1><p>${({ services: '连接模型与语音节点，把能力交给 Anna。', devices: '每台设备一把钥匙，权限和额度各自清楚。', usage: '只呈现后端真实记录，不把未知当作零。', deployment: '从本机到局域网，再到你选择的网络。', playground: '一次小小的问候，确认她真的听得见、说得出。' })[tab]}</p></div>${tab === 'services' && snapshot.user.admin ? '<button class="primary" data-action="new-service">接入服务 ＋</button>' : tab === 'devices' ? '<button class="primary" data-action="new-device">创建设备 ＋</button>' : ''}</div>${tab === 'services' ? serviceCards() + pagination(snapshot.services.total) : tab === 'devices' ? devices() : tab === 'usage' ? usage() : tab === 'deployment' ? deployment() : playground()}`}</main></div>`
}
function modal(title, contents) {
  dialog.innerHTML = `<div class="heading"><h2>${esc(title)}</h2><button data-action="close-dialog" aria-label="关闭">×</button></div>${contents}`
  if (!dialog.open)
    dialog.showModal()
}
function deviceForm() {
  modal('让一台新设备认识 Anna', `<form data-form="device"><label>设备名称<input name="name" required maxlength="40" placeholder="例如：我的 MacBook Air"></label><div class="form-grid"><label>初始内部点数<input name="remaining" type="number" min="0" max="1000000000" value="100000" required></label><label>有效天数（0 为长期）<input name="days" type="number" min="0" max="3650" value="30" required></label></div><fieldset><legend>允许使用的模型</legend>${models().map(model => `<label><input type="checkbox" name="models" value="${esc(model)}" checked>${esc(model)}</label>`).join('') || '<p class="help">先启用一个服务，再创建设备。</p>'}</fieldset><p class="help">Key 只在创建后展示一次，不能登录工作台。长名称会按后端的 50 字节限制截短，并附加唯一短 ID。</p><button class="primary" type="submit" ${!models().length ? 'disabled' : ''}>创建设备密钥</button></form>`)
}
function serviceForm() {
  modal('为 Anna 接通一种能力', `<form data-form="service"><label>能力类型<select name="kind" aria-label="能力类型"><option value="llm">文字思考 · LLM</option><option value="asr">听见声音 · ASR</option><option value="tts">说出回应 · TTS</option></select></label><label>服务名称<input name="name" required maxlength="40" placeholder="例如：我的云端语言模型"></label><label>API 根地址<input name="baseURL" type="url" required placeholder="https://厂商 API 地址"></label><label>模型 ID<input name="models" required placeholder="填写控制台中的模型 ID；多个用英文逗号分隔"></label><label>提供商 API Key<input name="key" type="password" autocomplete="off" placeholder="无鉴权的本机/私网节点可留空"></label><p class="help">提供商是提供模型的服务商，模型 ID 指定所用模型，API Key 用来授权调用。请从服务商官方控制台获取；第三方转发地址单独命名。本页支持 OpenAI 兼容协议，保存不代表已经通过调用验证。</p><p class="help">当前节点的本机语言模型受限。云端及其他算力节点可接入；私网 HTTP 会明文传输，请仅在可信网络使用。保存不会安装或启动模型。新模型可能还需在后端配置计价规则。</p><button class="primary" type="submit">接入并启用</button></form>`)
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button')
  if (!button)
    return
  try {
    if (button.dataset.tab) { requestController?.abort(); tab = button.dataset.tab; currentPage = 1; await refresh(); return }
    if (button.dataset.kind) { requestController?.abort(); kind = button.dataset.kind; lastResult = ''; render(); return }
    const action = button.dataset.action
    if (action === 'close-dialog')
      dialog.close()
    if (action === 'refresh') { await refresh(); notice('已更新真实状态。') }
    if (action === 'logout') { await api('/manage/logout', {}); token = ''; deviceKey = ''; snapshot = undefined; loginView() }
    if (action === 'copy-address') { await navigator.clipboard.writeText(endpoint()); notice('已复制 API 地址。') }
    if (action === 'copy-config') { await navigator.clipboard.writeText(JSON.stringify({ baseURL: endpoint(), apiKey: deviceKey, model: button.dataset.model }, null, 2)); notice('已复制客户端配置，里面包含此设备的 Key。') }
    if (action === 'copy-key') { await navigator.clipboard.writeText(deviceKey); notice('已复制设备 Key。请只交给这台设备使用。') }
    if (action === 'new-device')
      deviceForm()
    if (action === 'new-service')
      serviceForm()
    if (action === 'cancel-test') { requestController?.abort(); notice('已请求取消；底层模型何时停止由节点决定。') }
    if (action === 'previous' || action === 'next') { currentPage += action === 'next' ? 1 : -1; await refresh() }
    if (action === 'try-service') {
      const service = snapshot.services.items.find(item => item.id === Number(button.dataset.id))
      kind = { llm: 'chat', asr: 'transcribe', tts: 'speech' }[service.kind]
      selectedModel = service.models.split(',')[0]
      tab = 'playground'; lastResult = ''; render()
    }
    if (action === 'service-status') {
      const service = snapshot.services.items.find(item => item.id === Number(button.dataset.id))
      await api(`/manage/services/${service.id}/status`, { status: service.status === 1 ? 2 : 1 })
      await refresh(); notice('服务状态已更新。')
    }
    if (action === 'device-revoke') {
      const id = Number(button.dataset.id)
      modal('撤销这台设备的密钥？', `<p class="help">撤销后新请求会被拒绝。已经开始的底层推理可能仍在完成。</p><form data-form="revoke"><input type="hidden" name="id" value="${id}"><button class="danger" type="submit">确认撤销</button></form>`)
    }
    if (action === 'device-quota') {
      const device = snapshot.devices.items.find(item => item.id === Number(button.dataset.id))
      modal('设置设备可用额度', `<form data-form="quota"><input type="hidden" name="id" value="${device.id}"><p class="help">${esc(device.name)} · 当前可用 ${count(device.remaining)} 点。设置一个新的可用余额；不是付款或增量充值。</p><label>新的可用内部点数<input name="remaining" type="number" min="0" max="1000000000" value="${device.remaining}" required></label><p class="help">这会关闭“不限额”，保留原模型范围、有效期和其他限制。建议在该设备没有运行任务时调整。</p><button class="primary" type="submit">确认设置</button></form>`)
    }
    if (action === 'test-with-key') { dialog.close(); tab = 'playground'; render() }
  }
  catch (error) { notice(error.message, true) }
})
document.addEventListener('change', (event) => {
  if (event.target.name === 'access') {
    const host = event.target.form.elements.host
    if (event.target.value === 'network' && host.value === '127.0.0.1')
      host.value = '0.0.0.0'
    if (event.target.value === 'local')
      host.value = '127.0.0.1'
  }
})
document.addEventListener('input', (event) => {
  if (event.target.name === 'deviceKey')
    deviceKey = event.target.value
})
document.addEventListener('submit', async (event) => {
  const form = event.target
  if (!form.dataset.form)
    return
  event.preventDefault()
  const button = form.querySelector('[type="submit"]')
  if (button.disabled)
    return
  button.disabled = true
  const values = new FormData(form)
  const body = Object.fromEntries(values)
  try {
    if (form.dataset.form === 'login') {
      const value = await api('/manage/login', body)
      token = value.token
      await refresh()
    }
    if (form.dataset.form === 'device') {
      const value = await api('/manage/devices', { name: body.name, remaining: Number(body.remaining), days: Number(body.days), models: values.getAll('models') })
      deviceKey = value.key
      await refresh()
      modal('设备已准备好，收好这把钥匙', `<p class="help">${esc(value.device.name)} · 密钥只在本次展示，关闭后不再显示。</p><div class="key-box">${esc(deviceKey)}</div><div class="actions"><button data-action="copy-key">复制设备 Key</button><button data-action="copy-config" data-model="${esc(value.device.models.split(',')[0])}">复制客户端配置</button><button class="primary" data-action="test-with-key">带着它去试用 →</button></div>${addressCard()}<p class="help">Base URL 填上方地址，API Key 填这把设备钥匙，模型填所授权的实际模型 ID。</p>`)
    }
    if (form.dataset.form === 'service') { const value = await api('/manage/services', body); dialog.close(); await refresh(); notice(value.message) }
    if (form.dataset.form === 'quota') { await api(`/manage/devices/${body.id}/quota`, { remaining: Number(body.remaining) }); dialog.close(); await refresh(); notice('可用额度已设置，原模型范围与有效期已保留。') }
    if (form.dataset.form === 'revoke') { await api(`/manage/devices/${body.id}/revoke`, {}); dialog.close(); await refresh(); notice('设备 Key 已撤销。') }
    if (form.dataset.form === 'deployment') { await api('/manage/deployment', { ...body, port: Number(body.port) }); await refresh(); notice('连接配置已应用。管理端仍仅本机开放。') }
    if (form.dataset.form === 'try') {
      requestController?.abort()
      requestController = new AbortController()
      deviceKey = body.deviceKey
      selectedModel = body.model
      const started = performance.now()
      const headers = { 'authorization': `Bearer ${token}`, 'x-anna-device-key': deviceKey }
      let payload
      if (kind === 'transcribe') { payload = new FormData(); payload.set('file', values.get('file')); payload.set('model', body.model) }
      else {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(kind === 'chat' ? { model: body.model, messages: [{ role: 'user', content: body.input }], max_tokens: 128, stream: false } : { model: body.model, input: body.input, voice: body.voice, response_format: 'wav' })
      }
      const result = document.querySelector('#test-result')
      result.textContent = 'Anna 正在等候服务回应…'
      const response = await fetch(`/manage/try/${kind}`, { method: 'POST', headers, body: payload, signal: requestController.signal })
      if (!form.isConnected)
        return
      if (!response.ok) {
        let message = '调用失败，请检查 Key、模型、额度与后端状态。'
        try { const value = await response.json(); message = value.error?.message || value.error || message }
        catch {}
        throw new Error(message)
      }
      if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = undefined }
      document.querySelector('#audio-result').replaceChildren()
      if (kind === 'speech') {
        const blob = await response.blob()
        if (!form.isConnected)
          return
        if (!blob.type.startsWith('audio/'))
          throw new Error('服务没有返回音频，请检查模型与协议。')
        audioURL = URL.createObjectURL(blob)
        const audio = document.createElement('audio')
        audio.controls = true; audio.preload = 'none'; audio.src = audioURL
        const download = document.createElement('a')
        download.href = audioURL; download.download = 'anna-voice.wav'; download.textContent = '下载音频，再用于语音识别测试 ↗'
        document.querySelector('#audio-result').append(audio, download)
        lastResult = `已生成 ${count(blob.size)} 字节音频，保持静音。你可以主动播放或下载。`
      }
      else {
        const value = await response.json()
        if (!form.isConnected)
          return
        lastResult = kind === 'chat' ? value.choices?.[0]?.message?.content || JSON.stringify(value) : value.text || JSON.stringify(value)
      }
      lastResult += `\n\n耗时 ${((performance.now() - started) / 1000).toFixed(2)} 秒 · 请求 ${response.headers.get('x-request-id') || '未报告'}`
      result.textContent = lastResult
      notice('真实调用已完成。到用量额度中查看后端记录。')
    }
  }
  catch (error) {
    const message = error.name === 'AbortError' ? '请求已取消。' : error.message
    notice(message, true)
    if (form.dataset.form === 'login')
      form.querySelector('.login-error').textContent = message
    if (form.dataset.form === 'try' && form.isConnected)
      document.querySelector('#test-result').textContent = message
  }
  finally { button.disabled = false }
})
app.innerHTML = '<div class="loading">Anna 正在打开工作台…</div>'
const code = new URLSearchParams(location.hash.slice(1)).get('open')
history.replaceState(null, '', location.pathname)
async function start() {
  if (code) {
    try { const value = await api('/manage/redeem', { code }); token = value.token; await refresh() }
    catch (error) { loginView(); notice(error.message, true) }
  }
  else {
    try {
      const value = await api('/manage/session')
      if (value.loggedIn) { token = value.token; await refresh() }
      else {
        loginView()
      }
    }
    catch (error) { loginView(); notice(error.message, true) }
  }
}
void start()
window.addEventListener('pagehide', () => {
  requestController?.abort(); if (audioURL)
    URL.revokeObjectURL(audioURL)
})
