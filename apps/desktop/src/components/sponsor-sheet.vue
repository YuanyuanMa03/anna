<script setup lang="ts">
import { ref } from 'vue'
import alipay from '../../../../website/public/media/alipay.webp'
import wechat from '../../../../website/public/media/wechat.webp'

const emit = defineEmits<{ close: [] }>()
const codes = { wechat: { label: '微信', image: wechat }, alipay: { label: '支付宝', image: alipay } }
const payment = ref<keyof typeof codes>('wechat')
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section class="sheet sponsor-sheet" role="dialog" aria-modal="true" aria-label="赞助 Anna">
      <div class="sheet-heading"><div><span class="eyebrow">SUPPORT ANNA</span><h2>赞助 Anna</h2></div><button class="icon-button" aria-label="关闭赞助" @click="emit('close')">×</button></div>
      <p>Anna 由一个人利用业余时间开发。模型调用、测试设备，还有每个版本背后的时间，都是实打实的成本。独立开发不易，如果 Anna 陪伴了你，或者帮你省了事，欢迎随手赞助，多少都是支持。谢谢你 ♥</p>
      <div class="payment-tabs" role="tablist">
        <button v-for="(code, id) in codes" :key="id" role="tab" :aria-selected="payment === id" @click="payment = id">{{ code.label }}</button>
      </div>
      <img class="sponsor-qr" :src="codes[payment].image" :alt="`${codes[payment].label}收款码`">
      <p class="small muted">用{{ codes[payment].label }}扫一扫。赞助完全自愿，不会解锁或限制任何功能。</p>
      <p class="small muted">个人和非商业使用免费。拿 Anna 去卖、做成收费产品或在公司里使用，需要商业授权：yym290552@gmail.com</p>
    </section>
  </div>
</template>
