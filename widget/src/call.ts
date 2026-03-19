import { WidgetAPI } from './api'
import type { Room as RoomType } from 'livekit-client'

export type CallState = 'idle' | 'connecting' | 'connected' | 'ended'

export type CallEventType = 'state-change' | 'duration' | 'mute-change' | 'error'

export interface CallEvent {
  type: CallEventType
  state?: CallState
  duration?: number
  muted?: boolean
  error?: string
}

export type CallEventListener = (event: CallEvent) => void

/** Plays a North American phone ringtone (440+480Hz, 2s on / 4s off) until stopped. */
class Ringtone {
  private ctx: AudioContext | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private oscs: OscillatorNode[] = []

  start(): void {
    try {
      this.ctx = new AudioContext()
      this.playRing()
      // NA ring cadence: 2s ring, 4s silence = 6s cycle
      this.interval = setInterval(() => this.playRing(), 6000)
    } catch { /* Audio not available */ }
  }

  private playRing(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    // Two-tone ring (440+480 Hz) for 2 seconds
    for (const freq of [440, 480]) {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.1, now)
      gain.gain.setValueAtTime(0.1, now + 1.9)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2)
      osc.connect(gain).connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 2)
      this.oscs.push(osc)
    }
  }

  stop(): void {
    for (const osc of this.oscs) {
      try { osc.stop() } catch { /* already stopped */ }
    }
    this.oscs = []
    if (this.interval) { clearInterval(this.interval); this.interval = null }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null }
  }
}

export class CallManager {
  private api: WidgetAPI
  private businessId: string
  private room: RoomType | null = null
  private state: CallState = 'idle'
  private muted = false
  private durationSeconds = 0
  private durationInterval: ReturnType<typeof setInterval> | null = null
  private listeners: CallEventListener[] = []
  private ringtone = new Ringtone()

  constructor(api: WidgetAPI, businessId: string) {
    this.api = api
    this.businessId = businessId
  }

  on(listener: CallEventListener): void {
    this.listeners.push(listener)
  }

  off(listener: CallEventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  private emit(event: CallEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private setState(state: CallState): void {
    this.state = state
    this.emit({ type: 'state-change', state })
  }

  getState(): CallState {
    return this.state
  }

  isMuted(): boolean {
    return this.muted
  }

  getDuration(): number {
    return this.durationSeconds
  }

  async startCall(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') return

    this.setState('connecting')
    this.durationSeconds = 0
    this.muted = false
    this.ringtone.start()

    try {
      const tokenData = await this.api.getCallToken(this.businessId)

      const { Room, RoomEvent } = await import('livekit-client')

      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
      })

      this.room.on(RoomEvent.Disconnected, () => {
        this.handleDisconnect()
      })

      // Attach remote audio tracks (agent TTS) to the DOM so the browser plays them
      this.room.on(RoomEvent.TrackSubscribed, (track, _publication, _participant) => {
        if (track.kind === 'audio') {
          // Agent audio arrived — stop ringtone and show connected state
          this.ringtone.stop()
          if (this.state === 'connecting') {
            this.setState('connected')
            this.startDurationTimer()
          }
          const el = track.attach()
          el.id = 'va-remote-audio'
          el.style.display = 'none'
          document.body.appendChild(el)
        }
      })

      this.room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove())
      })

      await this.room.connect(tokenData.livekit_url, tokenData.token)
      await this.room.localParticipant.setMicrophoneEnabled(true)

      // Don't setState('connected') here — wait for agent audio track above
    } catch (err) {
      this.ringtone.stop()
      const errorMsg = err instanceof Error ? err.message : 'Failed to start call'
      this.emit({ type: 'error', error: errorMsg })
      this.setState('idle')
    }
  }

  async endCall(): Promise<void> {
    this.stopDurationTimer()

    if (this.room) {
      try {
        await this.room.disconnect(true)
      } catch {
        // Best effort disconnect
      }
      this.room = null
    }

    this.setState('ended')

    // Reset to idle after a brief moment so UI can show "ended" state
    setTimeout(() => {
      if (this.state === 'ended') {
        this.setState('idle')
      }
    }, 2000)
  }

  async toggleMute(): Promise<void> {
    if (!this.room || this.state !== 'connected') return

    this.muted = !this.muted

    try {
      await this.room.localParticipant.setMicrophoneEnabled(!this.muted)
    } catch {
      // Revert if the operation fails
      this.muted = !this.muted
    }

    this.emit({ type: 'mute-change', muted: this.muted })
  }

  private handleDisconnect(): void {
    this.ringtone.stop()
    this.stopDurationTimer()
    this.room = null

    if (this.state === 'connected' || this.state === 'connecting') {
      this.setState('ended')
      setTimeout(() => {
        if (this.state === 'ended') {
          this.setState('idle')
        }
      }, 2000)
    }
  }

  private startDurationTimer(): void {
    this.stopDurationTimer()
    this.durationInterval = setInterval(() => {
      this.durationSeconds++
      this.emit({ type: 'duration', duration: this.durationSeconds })
    }, 1000)
  }

  private stopDurationTimer(): void {
    if (this.durationInterval) {
      clearInterval(this.durationInterval)
      this.durationInterval = null
    }
  }

  destroy(): void {
    this.stopDurationTimer()
    if (this.room) {
      this.room.disconnect(true).catch(() => {})
      this.room = null
    }
    // Clean up any attached audio elements
    document.querySelectorAll('#va-remote-audio').forEach((el) => el.remove())
    this.listeners = []
  }
}
