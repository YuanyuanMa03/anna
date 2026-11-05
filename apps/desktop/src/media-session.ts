/** Explicit microphone capture. A late permission grant cannot resurrect a stopped recording. */
export class MediaSession {
  private revision = 0
  private stream?: MediaStream
  constructor(private devices: Pick<MediaDevices, 'getUserMedia'>, private ended: () => void = () => {}) {}
  stop() {
    this.revision++
    const stream = this.stream
    this.stream = undefined
    stream?.getTracks().forEach(track => track.stop())
  }

  async open() {
    this.stop()
    const revision = this.revision
    const stream = await this.devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
    if (revision !== this.revision) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error('麦克风开启已取消')
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
