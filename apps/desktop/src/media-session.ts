/** Explicitly requested media only. A late permission grant cannot resurrect a stopped capture. */
export class MediaSession {
  private revision = 0
  private stream?: MediaStream
  constructor(private devices: Pick<MediaDevices, 'getUserMedia'> & Partial<Pick<MediaDevices, 'getDisplayMedia'>>, private ended: () => void = () => {}) {}
  stop() {
    this.revision++
    const stream = this.stream
    this.stream = undefined
    stream?.getTracks().forEach(track => track.stop())
  }

  async open(kind: 'microphone' | 'camera' | 'screen') {
    this.stop()
    const revision = this.revision
    let stream: MediaStream
    if (kind === 'screen') {
      if (!this.devices.getDisplayMedia)
        throw new Error('当前系统不支持屏幕共享')
      stream = await this.devices.getDisplayMedia({ video: true, audio: false })
    }
    else {
      stream = await this.devices.getUserMedia(kind === 'microphone'
        ? { audio: { echoCancellation: true, noiseSuppression: true }, video: false }
        : { audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
    }
    if (revision !== this.revision) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error('设备开启已取消')
    }
    this.stream = stream
    stream.getTracks().forEach(track => track.addEventListener('ended', () => {
      if (this.stream !== stream)
        return
      this.stop()
      this.ended()
    }, { once: true }))
    return stream
  }
}

/** One user-requested frame, bounded before any model call. */
export function cameraFrame(video: HTMLVideoElement) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    throw new Error('画面尚未就绪，请稍后再试')
  const ratio = Math.min(1280 / video.videoWidth, 720 / video.videoHeight, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * ratio))
  canvas.height = Math.max(1, Math.round(video.videoHeight * ratio))
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('无法读取画面')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}
