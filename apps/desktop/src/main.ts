import { createApp } from 'vue'
import App from './app.vue'
import './style.css'

async function main() {
  if (import.meta.env.VITE_ANNA_WEB)
    await (await import('../../web/bridge')).installWebBridge()
  createApp(App).mount('#app')
}
void main().catch((error: Error) => { document.querySelector('#app')!.textContent = error.message || 'Anna 在线体验暂时无法连接。请稍后刷新页面。' })
