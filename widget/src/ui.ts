import { getStyles } from './styles'
import { ChatManager, ChatEvent } from './chat'
import { CallManager, CallEvent, CallState } from './call'
import { ChatMessage } from './api'

type PanelMode = 'chat' | 'call'

const ICONS = {
  chat: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>`,
  send: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="currentColor"/></svg>`,
  phoneEnd: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.18-.29-.43-.29-.71 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" fill="currentColor"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="currentColor"/></svg>`,
  micOff: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" fill="currentColor"/></svg>`,
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export class WidgetUI {
  private shadow: ShadowRoot
  private chatManager: ChatManager
  private callManager: CallManager
  private accentColor: string
  private businessName: string

  private panelOpen = false
  private activeMode: PanelMode = 'chat'
  private isTyping = false
  private chatSessionStarted = false

  // DOM references
  private fab!: HTMLButtonElement
  private panel!: HTMLDivElement
  private messagesContainer!: HTMLDivElement
  private chatInput!: HTMLInputElement
  private sendBtn!: HTMLButtonElement
  private chatTab!: HTMLButtonElement
  private callTab!: HTMLButtonElement
  private chatBody!: HTMLDivElement
  private callBody!: HTMLDivElement
  private typingIndicator!: HTMLDivElement

  constructor(
    shadow: ShadowRoot,
    chatManager: ChatManager,
    callManager: CallManager,
    accentColor: string,
    businessName: string
  ) {
    this.shadow = shadow
    this.chatManager = chatManager
    this.callManager = callManager
    this.accentColor = accentColor
    this.businessName = businessName

    this.injectStyles()
    this.renderFab()
    this.renderPanel()
    this.bindEvents()
    this.bindManagerEvents()
  }

  private injectStyles(): void {
    const style = document.createElement('style')
    style.textContent = getStyles(this.accentColor)
    this.shadow.appendChild(style)
  }

  private renderFab(): void {
    this.fab = document.createElement('button')
    this.fab.className = 'va-fab'
    this.fab.innerHTML = ICONS.chat
    this.fab.setAttribute('aria-label', 'Open chat')
    this.shadow.appendChild(this.fab)
  }

  private renderPanel(): void {
    this.panel = document.createElement('div')
    this.panel.className = 'va-panel'
    this.panel.style.display = 'none'

    // Header
    const header = document.createElement('div')
    header.className = 'va-header'

    const title = document.createElement('span')
    title.className = 'va-header-title'
    title.textContent = this.businessName

    const closeBtn = document.createElement('button')
    closeBtn.className = 'va-close-btn'
    closeBtn.innerHTML = ICONS.close
    closeBtn.setAttribute('aria-label', 'Close')

    header.appendChild(title)
    header.appendChild(closeBtn)

    // Tabs
    const tabs = document.createElement('div')
    tabs.className = 'va-tabs'

    this.chatTab = document.createElement('button')
    this.chatTab.className = 'va-tab active'
    this.chatTab.textContent = 'Chat'

    this.callTab = document.createElement('button')
    this.callTab.className = 'va-tab'
    this.callTab.textContent = 'Call'

    tabs.appendChild(this.chatTab)
    tabs.appendChild(this.callTab)

    // Chat body
    this.chatBody = document.createElement('div')
    this.chatBody.className = 'va-chat-body'

    this.messagesContainer = document.createElement('div')
    this.messagesContainer.className = 'va-messages'

    this.typingIndicator = document.createElement('div')
    this.typingIndicator.className = 'va-typing'
    this.typingIndicator.style.display = 'none'
    this.typingIndicator.innerHTML = `
      <span class="va-typing-dot"></span>
      <span class="va-typing-dot"></span>
      <span class="va-typing-dot"></span>
    `

    const inputArea = document.createElement('div')
    inputArea.className = 'va-input-area'

    this.chatInput = document.createElement('input')
    this.chatInput.className = 'va-input'
    this.chatInput.type = 'text'
    this.chatInput.placeholder = 'Type a message...'

    this.sendBtn = document.createElement('button')
    this.sendBtn.className = 'va-send-btn'
    this.sendBtn.innerHTML = ICONS.send
    this.sendBtn.setAttribute('aria-label', 'Send')

    inputArea.appendChild(this.chatInput)
    inputArea.appendChild(this.sendBtn)

    this.chatBody.appendChild(this.messagesContainer)
    this.chatBody.appendChild(inputArea)

    // Call body
    this.callBody = document.createElement('div')
    this.callBody.className = 'va-call-body'
    this.callBody.style.display = 'none'
    this.renderCallIdle()

    // Assemble panel
    this.panel.appendChild(header)
    this.panel.appendChild(tabs)
    this.panel.appendChild(this.chatBody)
    this.panel.appendChild(this.callBody)

    this.shadow.appendChild(this.panel)

    // Store close btn reference for event binding
    closeBtn.addEventListener('click', () => this.closePanel())
  }

  private bindEvents(): void {
    this.fab.addEventListener('click', () => this.togglePanel())

    this.chatTab.addEventListener('click', () => this.switchMode('chat'))
    this.callTab.addEventListener('click', () => this.switchMode('call'))

    this.sendBtn.addEventListener('click', () => this.handleSend())
    this.chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.handleSend()
      }
    })

    window.addEventListener('beforeunload', () => {
      this.cleanup()
    })
  }

  private bindManagerEvents(): void {
    this.chatManager.on((event: ChatEvent) => {
      switch (event.type) {
        case 'greeting':
        case 'message':
          this.isTyping = false
          this.updateTypingIndicator()
          if (event.message) {
            this.appendMessage(event.message)
          }
          break
        case 'typing':
          this.isTyping = true
          this.updateTypingIndicator()
          break
        case 'error':
          this.isTyping = false
          this.updateTypingIndicator()
          this.appendErrorMessage(event.error || 'Something went wrong')
          break
        case 'ended':
          this.chatSessionStarted = false
          break
      }
    })

    this.callManager.on((event: CallEvent) => {
      switch (event.type) {
        case 'state-change':
          this.renderCallState(event.state!)
          break
        case 'duration':
          this.updateCallTimer(event.duration!)
          break
        case 'mute-change':
          this.updateMuteButton(event.muted!)
          break
        case 'error':
          this.renderCallError(event.error || 'Call failed')
          break
      }
    })
  }

  private togglePanel(): void {
    if (this.panelOpen) {
      this.closePanel()
    } else {
      this.openPanel()
    }
  }

  private openPanel(): void {
    this.panelOpen = true
    this.panel.style.display = 'flex'
    this.fab.innerHTML = ICONS.close

    if (this.activeMode === 'chat' && !this.chatSessionStarted) {
      this.chatSessionStarted = true
      this.chatManager.startSession()
    }

    // Focus input after panel animation
    setTimeout(() => {
      if (this.activeMode === 'chat') {
        this.chatInput.focus()
      }
    }, 300)
  }

  private closePanel(): void {
    this.panelOpen = false
    this.panel.style.display = 'none'
    this.fab.innerHTML = ICONS.chat
  }

  private switchMode(mode: PanelMode): void {
    this.activeMode = mode

    this.chatTab.classList.toggle('active', mode === 'chat')
    this.callTab.classList.toggle('active', mode === 'call')

    this.chatBody.style.display = mode === 'chat' ? 'flex' : 'none'
    this.callBody.style.display = mode === 'call' ? 'flex' : 'none'

    if (mode === 'chat') {
      if (!this.chatSessionStarted) {
        this.chatSessionStarted = true
        this.chatManager.startSession()
      }
      setTimeout(() => this.chatInput.focus(), 50)
    }
  }

  private handleSend(): void {
    const text = this.chatInput.value.trim()
    if (!text) return

    this.chatInput.value = ''
    this.chatManager.sendMessage(text)
  }

  private appendMessage(msg: ChatMessage): void {
    const el = document.createElement('div')
    el.className = `va-msg ${msg.role}`
    el.textContent = msg.content
    this.messagesContainer.appendChild(el)
    this.scrollToBottom()
  }

  private appendErrorMessage(error: string): void {
    const el = document.createElement('div')
    el.className = 'va-msg assistant'
    el.style.color = '#dc2626'
    el.textContent = `Error: ${error}`
    this.messagesContainer.appendChild(el)
    this.scrollToBottom()
  }

  private updateTypingIndicator(): void {
    if (this.isTyping) {
      // Move typing indicator to end of messages
      if (this.typingIndicator.parentNode) {
        this.typingIndicator.parentNode.removeChild(this.typingIndicator)
      }
      this.messagesContainer.appendChild(this.typingIndicator)
      this.typingIndicator.style.display = 'flex'
      this.scrollToBottom()
    } else {
      this.typingIndicator.style.display = 'none'
    }
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight
    })
  }

  // ---- Call UI rendering ----

  private renderCallState(state: CallState): void {
    switch (state) {
      case 'idle':
        this.renderCallIdle()
        break
      case 'connecting':
        this.renderCallConnecting()
        break
      case 'connected':
        this.renderCallConnected()
        break
      case 'ended':
        this.renderCallEnded()
        break
    }
  }

  private renderCallIdle(): void {
    this.callBody.innerHTML = ''

    const status = document.createElement('div')
    status.className = 'va-call-status'
    status.textContent = 'Talk to our AI assistant'

    const actions = document.createElement('div')
    actions.className = 'va-call-actions'

    const startBtn = document.createElement('button')
    startBtn.className = 'va-call-btn va-call-start'
    startBtn.innerHTML = ICONS.phone
    startBtn.setAttribute('aria-label', 'Start call')
    startBtn.addEventListener('click', () => this.callManager.startCall())

    actions.appendChild(startBtn)
    this.callBody.appendChild(status)
    this.callBody.appendChild(actions)
  }

  private renderCallConnecting(): void {
    this.callBody.innerHTML = ''

    const connecting = document.createElement('div')
    connecting.className = 'va-call-connecting'

    const spinner = document.createElement('div')
    spinner.className = 'va-spinner'

    const status = document.createElement('div')
    status.className = 'va-call-status'
    status.textContent = 'Connecting...'

    connecting.appendChild(spinner)
    connecting.appendChild(status)
    this.callBody.appendChild(connecting)
  }

  private renderCallConnected(): void {
    this.callBody.innerHTML = ''

    const status = document.createElement('div')
    status.className = 'va-call-status'
    status.textContent = 'Connected'

    const timer = document.createElement('div')
    timer.className = 'va-call-timer'
    timer.id = 'va-call-timer'
    timer.textContent = '00:00'

    const actions = document.createElement('div')
    actions.className = 'va-call-actions'

    const muteBtn = document.createElement('button')
    muteBtn.className = 'va-call-btn va-call-mute'
    muteBtn.id = 'va-mute-btn'
    muteBtn.innerHTML = ICONS.mic
    muteBtn.setAttribute('aria-label', 'Toggle mute')
    muteBtn.addEventListener('click', () => this.callManager.toggleMute())

    const endBtn = document.createElement('button')
    endBtn.className = 'va-call-btn va-call-end'
    endBtn.innerHTML = ICONS.phoneEnd
    endBtn.setAttribute('aria-label', 'End call')
    endBtn.addEventListener('click', () => this.callManager.endCall())

    actions.appendChild(muteBtn)
    actions.appendChild(endBtn)

    this.callBody.appendChild(status)
    this.callBody.appendChild(timer)
    this.callBody.appendChild(actions)
  }

  private renderCallEnded(): void {
    this.callBody.innerHTML = ''

    const status = document.createElement('div')
    status.className = 'va-call-status'
    status.textContent = 'Call ended'

    this.callBody.appendChild(status)
  }

  private renderCallError(error: string): void {
    const status = this.callBody.querySelector('.va-call-status')
    if (status) {
      status.textContent = error
      ;(status as HTMLElement).style.color = '#dc2626'
    }
  }

  private updateCallTimer(duration: number): void {
    const timer = this.shadow.getElementById('va-call-timer')
    if (timer) {
      timer.textContent = formatDuration(duration)
    }
  }

  private updateMuteButton(muted: boolean): void {
    const muteBtn = this.shadow.getElementById('va-mute-btn')
    if (muteBtn) {
      muteBtn.classList.toggle('muted', muted)
      muteBtn.innerHTML = muted ? ICONS.micOff : ICONS.mic
    }
  }

  cleanup(): void {
    this.chatManager.endSession()
    this.callManager.destroy()
  }
}
