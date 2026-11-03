/** A short-lived, single-use selection made from the current native source list. */
export class ScreenGrant<T extends { id: string }> {
  private sources: T[] = []
  private until = 0
  private selected?: T
  private selectedUntil = 0
  constructor(private clock: () => number = Date.now) {}
  offer(sources: T[]) { this.clear(); this.sources = sources; this.until = this.clock() + 60000 }
  select(id: string) {
    this.selected = this.clock() < this.until ? this.sources.find(source => source.id === id) : undefined
    this.selectedUntil = this.clock() + 15000
    return Boolean(this.selected)
  }

  get ready() { return Boolean(this.selected && this.clock() < this.selectedUntil) }
  consume(validRequest: boolean) {
    const selected = validRequest && this.ready ? this.selected : undefined
    this.clear()
    return selected
  }

  clear() { this.sources = []; this.selected = undefined; this.until = this.selectedUntil = 0 }
}
