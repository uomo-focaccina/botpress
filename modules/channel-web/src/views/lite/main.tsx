import classnames from 'classnames'
import set from 'lodash/set'
import { observe } from 'mobx'
import { inject, observer } from 'mobx-react'
import queryString from 'query-string'
import React from 'react'
import { injectIntl } from 'react-intl'

import Container from './components/Container'
import Stylesheet from './components/Stylesheet'
import constants from './core/constants'
import BpSocket from './core/socket'
import ChatIcon from './icons/Chat'
import { RootStore, StoreDef } from './store'
import { Config, Message } from './typings'
import { checkLocationOrigin, initializeAnalytics, isIE, trackMessage, trackWebchatState } from './utils'

const _values = obj => Object.keys(obj).map(x => obj[x])

class Web extends React.Component<MainProps> {
  private config: Config
  private socket: BpSocket
  private parentClass: string
  private hasBeenInitialized: boolean = false

  state = {
    played: false
  }

  constructor(props) {
    super(props)

    checkLocationOrigin()
    initializeAnalytics()
  }

  async componentDidMount() {
    this.props.store.setIntlProvider(this.props.intl)
    window.store = this.props.store

    window.addEventListener('message', this.handleIframeApi)
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.props.hideChat()
        window.parent.document.getElementById('mainLayout').focus()
      }
    })

    await this.initialize()
    await this.initializeIfChatDisplayed()

    this.props.setLoadingCompleted()
  }

  componentWillUnmount() {
    window.removeEventListener('message', this.handleIframeApi)
  }

  componentDidUpdate() {
    // tslint:disable-next-line: no-floating-promises
    this.initializeIfChatDisplayed()
  }

  async initializeIfChatDisplayed() {
    if (this.hasBeenInitialized) {
      return
    }

    if (this.props.activeView === 'side' || this.props.isFullscreen) {
      this.hasBeenInitialized = true

      if (this.isLazySocket()) {
        await this.initializeSocket()
      }

      await this.props.initializeChat()
    }
  }

  async initialize() {
    this.config = this.extractConfig()

    if (this.config.exposeStore) {
      const storePath = this.config.chatId ? `${this.config.chatId}.webchat_store` : 'webchat_store'
      set(window.parent, storePath, this.props.store)
    }

    this.config.overrides && this.loadOverrides(this.config.overrides)

    this.config.containerWidth && this.postMessageToParent('setWidth', this.config.containerWidth)

    this.config.reference && this.props.setReference()

    await this.props.fetchBotInfo()

    if (!this.isLazySocket()) {
      await this.initializeSocket()
    }

    this.setupObserver()
  }

  postMessageToParent(type: string, value: any) {
    window.parent?.postMessage({ type, value, chatId: this.config.chatId }, '*')
  }

  extractConfig() {
    const { options, ref } = queryString.parse(location.search)
    const { config } = JSON.parse(decodeURIComponent(options || '{}'))

    const userConfig = Object.assign({}, constants.DEFAULT_CONFIG, config)
    userConfig.reference = config.ref || ref

    this.props.updateConfig(userConfig, this.props.bp)

    return userConfig
  }

  async initializeSocket() {
    this.socket = new BpSocket(this.props.bp, this.config)
    this.socket.onMessage = this.handleNewMessage
    this.socket.onTyping = this.handleTyping
    this.socket.onData = this.handleDataMessage
    this.socket.onUserIdChanged = this.props.setUserId

    this.config.userId && this.socket.changeUserId(this.config.userId)

    this.socket.setup()
    await this.socket.waitForUserId()
  }

  loadOverrides(overrides) {
    try {
      for (const override of _values(overrides)) {
        override.map(({ module }) => this.props.bp.loadModuleView(module, true))
      }
    } catch (err) {
      console.error('Error while loading overrides', err.message)
    }
  }

  setupObserver() {
    observe(this.props.config, 'userId', async data => {
      if (!data.oldValue || data.oldValue === data.newValue) {
        return
      }

      await this.socket.changeUserId(data.newValue)
      await this.socket.setup()
      await this.socket.waitForUserId()
      await this.props.initializeChat()
    })

    observe(this.props.config, 'overrides', data => {
      if (data.newValue && window.parent) {
        this.loadOverrides(data.newValue)
      }
    })

    observe(this.props.dimensions, 'container', data => {
      if (data.newValue && window.parent) {
        this.postMessageToParent('setWidth', data.newValue)
      }
    })
  }

  handleIframeApi = async ({ data: { action, payload } }) => {
    if (action === 'configure') {
      this.props.updateConfig(Object.assign({}, constants.DEFAULT_CONFIG, payload))
    } else if (action === 'mergeConfig') {
      this.props.mergeConfig(payload)
    } else if (action === 'event') {
      const { type, text } = payload

      if (type === 'show') {
        this.props.showChat()
        trackWebchatState('show')
      } else if (type === 'hide') {
        this.props.hideChat()
        trackWebchatState('hide')
      } else if (type === 'toggle') {
        this.props.displayWidgetView ? this.props.showChat() : this.props.hideChat()
        trackWebchatState('toggle')
      } else if (type === 'message') {
        trackMessage('sent')
        await this.props.sendMessage(text)
      } else if (type === 'toggleBotInfo') {
        this.props.toggleBotInfo()
      } else {
        await this.props.sendData({ type, payload })
      }
    }
  }

  handleNewMessage = async event => {
    if (event.payload?.type === 'visit' || event.message_type === 'visit') {
      // don't do anything, it's the system message
      return
    }

    if (this.props.config.conversationId && Number(this.props.config.conversationId) !== Number(event.conversationId)) {
      // don't do anything, it's a message from another conversation
      return
    }

    trackMessage('received')
    await this.props.addEventToConversation(event)

    // there's no focus on the actual conversation
    if ((document.hasFocus && !document.hasFocus()) || this.props.activeView !== 'side') {
      await this.playSound()
      this.props.incrementUnread()
    }

    this.handleResetUnreadCount()
  }

  handleTyping = async (event: Message) => {
    if (this.props.config.conversationId && Number(this.props.config.conversationId) !== Number(event.conversationId)) {
      // don't do anything, it's a message from another conversation
      return
    }

    await this.props.updateTyping(event)
  }

  handleDataMessage = event => {
    if (!event || !event.payload) {
      return
    }

    const { language } = event.payload
    if (!language) {
      return
    }

    this.props.updateBotUILanguage(language)
  }

  async playSound() {
    if (this.state.played) {
      return
    }

    const audio = new Audio(`${window.ROOT_PATH}/assets/modules/channel-web/notification.mp3`)
    await audio.play()

    this.setState({ played: true })

    setTimeout(() => {
      this.setState({ played: false })
    }, constants.MIN_TIME_BETWEEN_SOUNDS)
  }

  isLazySocket() {
    if (this.config.lazySocket !== undefined) {
      return this.config.lazySocket
    }
    return this.props.botInfo?.lazySocket
  }

  handleResetUnreadCount = () => {
    if (document.hasFocus?.() && this.props.activeView === 'side') {
      this.props.resetUnread()
    }
  }

  renderWidget() {
    if (!this.props.showWidgetButton) {
      return null
    }

    return (
      <button
        className={classnames('bpw-widget-btn', 'bpw-floating-button', {
          [`bpw-anim-${this.props.widgetTransition}` || 'none']: true
        })}
        aria-label={this.props.intl.formatMessage({ id: 'widget.toggle' })}
        onClick={this.props.showChat.bind(this)}
      >
        <ChatIcon />
        {this.props.hasUnreadMessages && <span className={'bpw-floating-button-unread'}>{this.props.unreadCount}</span>}
      </button>
    )
  }

  applyAndRenderStyle() {
    const emulatorClass = this.props.isEmulator ? ' emulator' : ''
    const parentClass = classnames(`bp-widget-web bp-widget-${this.props.activeView}${emulatorClass}`, {
      'bp-widget-hidden': !this.props.showWidgetButton && this.props.displayWidgetView,
      [this.props.config.className]: !!this.props.config.className
    })

    if (this.parentClass !== parentClass) {
      this.postMessageToParent('setClass', parentClass)
      this.parentClass = parentClass
    }

    const { isEmulator, stylesheet, extraStylesheet } = this.props.config
    return (
      <React.Fragment>
        {!!stylesheet?.length && <Stylesheet href={stylesheet} />}
        {!stylesheet && <Stylesheet href={`assets/modules/channel-web/default${isEmulator ? '-emulator' : ''}.css`} />}
        {!isIE && <Stylesheet href={'assets/modules/channel-web/font.css'} />}
        {!!extraStylesheet?.length && <Stylesheet href={extraStylesheet} />}
      </React.Fragment>
    )
  }

  render() {
    if (!this.props.isWebchatReady) {
      return null
    }

    return (
      <div onFocus={this.handleResetUnreadCount}>
        {this.applyAndRenderStyle()}
        <h1 id="tchat-label" className="sr-only" tabIndex={-1}>
          {this.props.intl.formatMessage({
            id: 'widget.title',
            defaultMessage: 'Chat window'
          })}
        </h1>
        {this.props.displayWidgetView ? this.renderWidget() : <Container />}
      </div>
    )
  }
}

export default inject(({ store }: { store: RootStore }) => ({
  store,
  config: store.config,
  sendData: store.sendData,
  initializeChat: store.initializeChat,
  botInfo: store.botInfo,
  fetchBotInfo: store.fetchBotInfo,
  updateConfig: store.updateConfig,
  mergeConfig: store.mergeConfig,
  addEventToConversation: store.addEventToConversation,
  setUserId: store.setUserId,
  updateTyping: store.updateTyping,
  sendMessage: store.sendMessage,
  setReference: store.setReference,
  isEmulator: store.isEmulator,
  updateBotUILanguage: store.updateBotUILanguage,
  isWebchatReady: store.view.isWebchatReady,
  showWidgetButton: store.view.showWidgetButton,
  hasUnreadMessages: store.view.hasUnreadMessages,
  unreadCount: store.view.unreadCount,
  resetUnread: store.view.resetUnread,
  incrementUnread: store.view.incrementUnread,
  activeView: store.view.activeView,
  isFullscreen: store.view.isFullscreen,
  showChat: store.view.showChat,
  hideChat: store.view.hideChat,
  toggleBotInfo: store.view.toggleBotInfo,
  dimensions: store.view.dimensions,
  widgetTransition: store.view.widgetTransition,
  displayWidgetView: store.view.displayWidgetView,
  setLoadingCompleted: store.view.setLoadingCompleted,
  sendFeedback: store.sendFeedback
}))(injectIntl(observer(Web)))

type MainProps = { store: RootStore } & Pick<
  StoreDef,
  | 'bp'
  | 'config'
  | 'initializeChat'
  | 'botInfo'
  | 'fetchBotInfo'
  | 'sendMessage'
  | 'setUserId'
  | 'sendData'
  | 'intl'
  | 'isEmulator'
  | 'updateTyping'
  | 'setReference'
  | 'updateBotUILanguage'
  | 'hideChat'
  | 'showChat'
  | 'toggleBotInfo'
  | 'widgetTransition'
  | 'activeView'
  | 'isFullscreen'
  | 'unreadCount'
  | 'hasUnreadMessages'
  | 'showWidgetButton'
  | 'addEventToConversation'
  | 'updateConfig'
  | 'mergeConfig'
  | 'isWebchatReady'
  | 'incrementUnread'
  | 'displayWidgetView'
  | 'resetUnread'
  | 'setLoadingCompleted'
  | 'dimensions'
>
