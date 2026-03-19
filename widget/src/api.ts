export interface ChatSession {
  session_id: string
  greeting: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ChatResponse {
  response: string
}

export interface TokenResponse {
  token: string
  room_name: string
  livekit_url: string
}

export class WidgetAPI {
  private baseUrl: string

  constructor(apiUrl: string) {
    if (apiUrl) {
      // User-provided URL is the full base (e.g. https://va.example.com/v1)
      this.baseUrl = apiUrl.replace(/\/+$/, '')
    } else {
      // Default: same origin
      this.baseUrl = window.location.origin
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
    }
    if (body) {
      options.body = JSON.stringify(body)
    }

    const res = await fetch(url, options)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Widget API error ${res.status}: ${text}`)
    }

    return res.json() as Promise<T>
  }

  async createChatSession(businessId: string, visitorId: string): Promise<ChatSession> {
    return this.request<ChatSession>('POST', '/api/widget/chat/sessions', {
      business_id: businessId,
      visitor_id: visitorId,
    })
  }

  async sendMessage(sessionId: string, message: string): Promise<ChatResponse> {
    return this.request<ChatResponse>(
      'POST',
      `/api/widget/chat/sessions/${sessionId}/messages`,
      { message }
    )
  }

  async getMessages(sessionId: string): Promise<{ messages: ChatMessage[] }> {
    return this.request<{ messages: ChatMessage[] }>(
      'GET',
      `/api/widget/chat/sessions/${sessionId}/messages`
    )
  }

  async endSession(sessionId: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(
      'POST',
      `/api/widget/chat/sessions/${sessionId}/end`
    )
  }

  async getCallToken(businessId: string): Promise<TokenResponse> {
    return this.request<TokenResponse>('POST', '/api/widget/token', {
      business_id: businessId,
    })
  }
}
