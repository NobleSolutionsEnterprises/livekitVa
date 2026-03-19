export function getStyles(accentColor: string): string {
  return `
    :host {
      --va-accent: ${accentColor};
      --va-accent-hover: color-mix(in srgb, ${accentColor} 85%, black);
      --va-bg: #ffffff;
      --va-bg-secondary: #f3f4f6;
      --va-text: #111827;
      --va-text-secondary: #6b7280;
      --va-border: #e5e7eb;
      --va-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
      --va-radius: 12px;
      --va-radius-sm: 8px;

      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      font-size: 14px;
      color: var(--va-text);
      line-height: 1.5;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Floating button */
    .va-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--va-accent);
      color: #ffffff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--va-shadow);
      transition: transform 0.2s ease, background 0.2s ease;
      z-index: 2147483646;
    }

    .va-fab:hover {
      transform: scale(1.08);
      background: var(--va-accent-hover);
    }

    .va-fab svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }

    /* Panel */
    .va-panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      width: 380px;
      height: 550px;
      background: var(--va-bg);
      border-radius: var(--va-radius);
      box-shadow: var(--va-shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483646;
      animation: va-slide-up 0.25s ease-out;
    }

    @keyframes va-slide-up {
      from {
        opacity: 0;
        transform: translateY(16px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Header */
    .va-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: var(--va-accent);
      color: #ffffff;
      flex-shrink: 0;
    }

    .va-header-title {
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .va-close-btn {
      background: none;
      border: none;
      color: #ffffff;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background 0.15s;
    }

    .va-close-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .va-close-btn svg {
      width: 18px;
      height: 18px;
    }

    /* Tabs */
    .va-tabs {
      display: flex;
      border-bottom: 1px solid var(--va-border);
      flex-shrink: 0;
    }

    .va-tab {
      flex: 1;
      padding: 10px 0;
      text-align: center;
      font-size: 13px;
      font-weight: 500;
      color: var(--va-text-secondary);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }

    .va-tab:hover {
      color: var(--va-text);
    }

    .va-tab.active {
      color: var(--va-accent);
      border-bottom-color: var(--va-accent);
    }

    /* Chat area */
    .va-chat-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .va-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .va-messages::-webkit-scrollbar {
      width: 4px;
    }

    .va-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .va-messages::-webkit-scrollbar-thumb {
      background: var(--va-border);
      border-radius: 2px;
    }

    .va-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.45;
      word-wrap: break-word;
    }

    .va-msg.assistant {
      align-self: flex-start;
      background: var(--va-bg-secondary);
      color: var(--va-text);
      border-bottom-left-radius: 4px;
    }

    .va-msg.user {
      align-self: flex-end;
      background: var(--va-accent);
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }

    /* Typing indicator */
    .va-typing {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 14px;
      background: var(--va-bg-secondary);
      border-radius: 16px;
      border-bottom-left-radius: 4px;
    }

    .va-typing-dot {
      width: 6px;
      height: 6px;
      background: var(--va-text-secondary);
      border-radius: 50%;
      animation: va-bounce 1.4s infinite ease-in-out;
    }

    .va-typing-dot:nth-child(1) { animation-delay: 0s; }
    .va-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .va-typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes va-bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    /* Input area */
    .va-input-area {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--va-border);
      flex-shrink: 0;
    }

    .va-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--va-border);
      border-radius: 20px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
      color: var(--va-text);
      background: var(--va-bg);
    }

    .va-input::placeholder {
      color: var(--va-text-secondary);
    }

    .va-input:focus {
      border-color: var(--va-accent);
    }

    .va-send-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--va-accent);
      color: #ffffff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, opacity 0.15s;
      flex-shrink: 0;
    }

    .va-send-btn:hover {
      background: var(--va-accent-hover);
    }

    .va-send-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .va-send-btn svg {
      width: 16px;
      height: 16px;
    }

    /* Call area */
    .va-call-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      padding: 24px;
    }

    .va-call-status {
      font-size: 15px;
      font-weight: 500;
      color: var(--va-text-secondary);
    }

    .va-call-timer {
      font-size: 32px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--va-text);
    }

    .va-call-actions {
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .va-call-btn {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s, background 0.15s;
    }

    .va-call-btn:hover {
      transform: scale(1.08);
    }

    .va-call-btn svg {
      width: 24px;
      height: 24px;
    }

    .va-call-start {
      background: #16a34a;
      color: #ffffff;
    }

    .va-call-start:hover {
      background: #15803d;
    }

    .va-call-end {
      background: #dc2626;
      color: #ffffff;
    }

    .va-call-end:hover {
      background: #b91c1c;
    }

    .va-call-mute {
      background: var(--va-bg-secondary);
      color: var(--va-text);
      border: 1px solid var(--va-border);
    }

    .va-call-mute.muted {
      background: #fef2f2;
      color: #dc2626;
      border-color: #fecaca;
    }

    .va-call-connecting {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .va-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--va-border);
      border-top-color: var(--va-accent);
      border-radius: 50%;
      animation: va-spin 0.8s linear infinite;
    }

    @keyframes va-spin {
      to { transform: rotate(360deg); }
    }

    /* Mobile responsive */
    @media (max-width: 480px) {
      .va-panel {
        bottom: 0;
        right: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 0;
      }

      .va-fab {
        bottom: 16px;
        right: 16px;
      }
    }
  `
}
