<script setup lang="ts">
import type { FaceMarks, Point } from '../../../../packages/character/make-avatar'
import type { MyAvatar, Picture } from '../my-avatar'
import { computed, onBeforeUnmount, ref } from 'vue'
import { avatarFromArchive, makeAvatar, openPicture } from '../my-avatar'

const props = defineProps<{ name: string, canAsk: boolean }>()
const emit = defineEmits<{ close: [], made: [avatar: MyAvatar], ask: [image: string] }>()
const steps = ['左边那只眼睛', '右边那只眼睛', '嘴巴中间', '下巴尖', '头顶（连头发）']
const picture = ref<Picture>()
const points = ref<Point[]>([])
const image = ref<HTMLImageElement>()
const working = ref(false)
const failure = ref('')
const next = computed(() => steps[points.value.length])

function start() {
  if (picture.value)
    URL.revokeObjectURL(picture.value.url)
  picture.value = undefined
  points.value = []
  failure.value = ''
}
async function attempt(work: () => Promise<void>) {
  working.value = true
  failure.value = ''
  try { await work() }
  catch (cause) { failure.value = cause instanceof Error ? cause.message : String(cause) }
  finally { working.value = false }
}
function pick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  start()
  void attempt(async () => {
    if (/\.mavatar$/i.test(file.name))
      emit('made', await avatarFromArchive(file))
    else
      picture.value = await openPicture(file)
  })
}
function mark(event: MouseEvent) {
  const box = image.value?.getBoundingClientRect()
  if (!box || !picture.value || !next.value)
    return
  points.value = [...points.value, { x: (event.clientX - box.left) * picture.value.width / box.width, y: (event.clientY - box.top) * picture.value.height / box.height }]
}
function make() {
  const [eyeA, eyeB, mouth, chin, top] = points.value
  const marks: FaceMarks = { eyeA: eyeA!, eyeB: eyeB!, mouth: mouth!, chin: chin!, top: top! }
  void attempt(async () => emit('made', await makeAvatar(picture.value!, marks)))
}
/** The picture goes to her workspace as a PNG, for the full tools to work from. */
function ask() {
  void attempt(async () => {
    const bytes = new Uint8Array(await (await fetch(picture.value!.url)).arrayBuffer())
    let binary = ''
    for (let at = 0; at < bytes.length; at += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
    emit('ask', btoa(binary))
  })
}
onBeforeUnmount(() => {
  if (picture.value)
    URL.revokeObjectURL(picture.value.url)
})
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section class="sheet avatar-maker" role="dialog" aria-modal="true" :aria-label="`创造你的 ${props.name}`">
      <div class="sheet-heading"><div><span class="eyebrow">MAKE YOUR OWN</span><h2>创造你的 {{ props.name }}</h2></div><button class="icon-button" aria-label="关闭创造" @click="emit('close')">×</button></div>
      <template v-if="!picture">
        <p>给我一张人物图，我就用它的样子站到你面前。最好是正面、看得清五官的半身像，背景透明或是纯色。也可以直接给我做好的 <code>.mavatar</code>。</p>
        <label class="primary file-button">选择素材<input type="file" accept="image/png,image/jpeg,image/webp,.mavatar" aria-label="选择素材" :disabled="working" @change="pick"></label>
        <p class="small muted">素材只留在这台电脑上。这里不用联网，也不用模型。</p>
      </template>
      <template v-else>
        <p v-if="next" role="status">在图上点一下<strong>{{ next }}</strong>（{{ points.length + 1 }}/{{ steps.length }}）</p>
        <p v-else role="status">标好了。可以做成你的 {{ props.name }} 了。</p>
        <div class="mark-area"><img ref="image" :src="picture.url" alt="你选的素材" :class="{ marking: next }" @click="mark"><i v-for="(point, index) in points" :key="index" :style="{ left: `${point.x / picture.width * 100}%`, top: `${point.y / picture.height * 100}%` }">{{ index + 1 }}</i></div>
        <div class="card-actions">
          <button :disabled="working" @click="start">换一张</button>
          <button :disabled="working || !points.length" @click="points = points.slice(0, -1)">退一步</button>
          <button class="primary" :disabled="working || Boolean(next)" @click="make">{{ working ? '正在做…' : `做成我的 ${props.name}` }}</button>
        </div>
        <p class="small muted">这样做出来的她会呼吸、转头、眨眼、看着你、张嘴说话；头发不会飘，表情也比较简单。<template v-if="picture.cleared">图的纯色背景已经去掉了。</template></p>
        <div class="plugin-row"><div><h3>让 {{ props.name }} 用完整工具精修</h3><p>她会下载 Mesh Avatar Studio，一步步绑定头发和五官，每一步都看过结果再继续，通常要几十分钟，途中可能要你确认。需要能看图的大脑，比如 Claude Code 或 Codex。做好后在这里选她给你的 <code>.mavatar</code>。</p></div><button :disabled="working || !props.canAsk" @click="ask">交给 {{ props.name }}</button></div>
      </template>
      <p v-if="failure" class="error" role="alert">{{ failure }}</p>
    </section>
  </div>
</template>
