import { Config } from '../typings'

export default class BpSocket {
  private events: any
  private userId: string
  private userIdScope: string
  private chatId: string | undefined

  public onMessage: (event: any) => void
  public onTyping: (event: any) => void
  public onData: (event: any) => void
  public onUserIdChanged: (userId: string) => void

  constructor(bp, config: Config) {
    this.events = bp?.events
    this.userIdScope = config.userIdScope
    this.chatId = config.chatId
  }

  public setup() {
    if (!this.events) {
      return
    }

    // Connect the Botpress Web Socket to the server
    this.events.setup(this.userIdScope)

    this.events.on('guest.webchat.message', this.onMessage)
    this.events.on('guest.webchat.typing', this.onTyping)
    this.events.on('guest.webchat.data', this.onData)

    // firehose events to parent page
    this.events.onAny(this.postToParent)
  }

  public postToParent = (type: string, payload: any) => {
    // we could filter on event type if necessary
    window.parent?.postMessage({ ...payload, chatId: this.chatId }, '*')
  }

  public changeUserId(newId: string) {
    this.events.updateVisitorId(newId, this.userIdScope)
  }

  /** Waits until the VISITOR ID is set  */
  public waitForUserId(): Promise<void> {
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (window.__BP_VISITOR_ID) {
          clearInterval(interval)

          this.userId = window.__BP_VISITOR_ID
          this.onUserIdChanged(this.userId)
          this.postToParent('', { userId: this.userId })
          resolve()
        }
      }, 250)

      setTimeout(() => {
        clearInterval(interval)
        reject()
      }, 300000)
    })
  }
}
