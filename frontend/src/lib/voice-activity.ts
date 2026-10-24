// Do not count an unobserved main-thread stall as microphone silence. That can
// stop a recording through the last word when rendering is busy.
export class VoiceSilenceTimer {
  private previous: number;
  private silentFor = 0;
  constructor(private started: number) { this.previous = started; }
  update(now: number, hasVoice: boolean) {
    const observed = Math.max(0, Math.min(100, now - this.previous));
    this.previous = now;
    this.silentFor = hasVoice ? 0 : this.silentFor + observed;
    return now - this.started >= 45_000 || this.silentFor >= 850;
  }
}
