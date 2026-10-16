const dialog = document.querySelector('#support-dialog')
const tabs = [...document.querySelectorAll('[data-payment]')]
const image = document.querySelector('#payment-image')
const save = document.querySelector('#save-code')

function selectPayment(tab) {
  const isWechat = tab.dataset.payment === 'wechat'
  const label = isWechat ? '微信支付' : '支付宝'
  const path = `/media/${tab.dataset.payment}.webp`
  for (const item of tabs) {
    item.setAttribute('aria-selected', String(item === tab))
    item.tabIndex = item === tab ? 0 : -1
  }
  document.querySelector('#payment-panel').dataset.payment = tab.dataset.payment
  image.src = path
  image.alt = `${label}打赏收款二维码`
  save.href = path
  save.download = `Anna-${label}打赏码.webp`
  document.querySelector('#payment-panel').setAttribute('aria-labelledby', tab.id)
  document.querySelector('.scan-hint').innerHTML = `使用${isWechat ? '微信' : '支付宝'}扫一扫，或长按保存图片后识别。<br>打赏完全自愿，金额由你决定。`
}

document.querySelector('#support-open').addEventListener('click', () => dialog.showModal())
document.querySelector('#support-close').addEventListener('click', () => dialog.close())
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog)
    return
  const bounds = dialog.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)
    dialog.close()
})
for (const tab of tabs) {
  tab.addEventListener('click', () => selectPayment(tab))
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return
    event.preventDefault()
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(tab) + 1) % tabs.length]
    selectPayment(next)
    next.focus()
  })
}
