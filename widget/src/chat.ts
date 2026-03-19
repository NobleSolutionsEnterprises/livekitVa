import { WidgetAPI, ChatMessage } from './api'

export type ChatEventType = 'greeting' | 'message' | 'typing' | 'error' | 'ended'

export interface ChatEvent {
  type: ChatEventType
  message?: ChatMessage
  error?: string
}

export type ChatEventListener = (event: ChatEvent) => void

function getOrCreateVisitorId(): string {
  const key = 'va_widget_visitor_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    try { localStorage.setItem(key, id) } catch { /* private browsing */ }
  }
  return id
}

export class ChatManager {
  private api: WidgetAPI
  private businessId: string
  private visitorId: string
  private sessionId: string | null = null
  private listeners: ChatEventListener[] = []
  private messages: ChatMessage[] = []

  constructor(api: WidgetAPI, businessId: string) {
    this.api = api
    this.businessId = businessId
    this.visitorId = getOrCreateVisitorId()
  }

  on(listener: ChatEventListener): void {
    this.listeners.push(listener)
  }

  off(listener: ChatEventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  private emit(event: ChatEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  getMessages(): ChatMessage[] {
    return this.messages
  }

  isActive(): boolean {
    return this.sessionId !== null
  }

  async startSession(): Promise<void> {
    if (this.sessionId) return

    try {
      const result = await this.api.createChatSession(this.businessId, this.visitorId)
      this.sessionId = result.session_id

      const greetingMsg: ChatMessage = {
        role: 'assistant',
        content: result.greeting,
        created_at: new Date().toISOString(),
      }
      this.messages = [greetingMsg]

      this.emit({ type: 'greeting', message: greetingMsg })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start chat'
      this.emit({ type: 'error', error: errorMsg })
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.sessionId) {
      await this.startSession()
    }
    if (!this.sessionId) return

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    this.messages.push(userMsg)
    this.emit({ type: 'message', message: userMsg })
    this.emit({ type: 'typing' })

    try {
      const result = await this.api.sendMessage(this.sessionId, text)

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.response,
        created_at: new Date().toISOString(),
      }
      this.messages.push(assistantMsg)
      this.emit({ type: 'message', message: assistantMsg })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send message'
      this.emit({ type: 'error', error: errorMsg })
    }
  }

  async endSession(): Promise<void> {
    if (!this.sessionId) return

    const sid = this.sessionId
    this.sessionId = null
    this.messages = []

    try {
      await this.api.endSession(sid)
    } catch {
      // Best effort — don't throw on cleanup
    }

    this.emit({ type: 'ended' })
  }
}
