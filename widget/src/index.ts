import { WidgetAPI } from './api'
import { ChatManager } from './chat'
import { CallManager } from './call'
import { WidgetUI } from './ui'

;(function initVAWidget() {
  const script = document.currentScript as HTMLScriptElement | null
  if (!script) {
    console.error('[va-widget] Could not find script tag. Make sure the widget is loaded via a <script> tag.')
    return
  }

  const businessId = script.getAttribute('data-business-id') || ''
  const apiUrl = script.getAttribute('data-api-url') || ''
  const accentColor = script.getAttribute('data-accent-color') || '#2563eb'
  const businessName = script.getAttribute('data-business-name') || 'Chat with us'

  if (!businessId) {
    console.error('[va-widget] Missing required attribute: data-business-id')
    return
  }

  // Create host element
  const host = document.createElement('div')
  host.id = 'va-widget-host'
  document.body.appendChild(host)

  // Attach shadow DOM
  const shadow = host.attachShadow({ mode: 'closed' })

  // Initialize services
  const api = new WidgetAPI(apiUrl)
  const chatManager = new ChatManager(api, businessId)
  const callManager = new CallManager(api, businessId)

  // Initialize UI
  const ui = new WidgetUI(shadow, chatManager, callManager, accentColor, businessName)

  // Expose cleanup for programmatic removal
  ;(window as unknown as Record<string, unknown>).__vaWidgetCleanup = () => {
    ui.cleanup()
    host.remove()
  }
})()
