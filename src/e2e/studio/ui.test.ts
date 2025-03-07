import { bpConfig } from '../../../jest-puppeteer.config'
import { clickOn, expectMatch } from '../expectPuppeteer'
import { expectBotApiCallSuccess, gotoAndExpect, triggerKeyboardShortcut } from '../utils'

describe('Studio - UI', () => {
  it('Open Studio', async () => {
    await gotoAndExpect(`${bpConfig.host}/studio/${bpConfig.botId}`)
  })

  it('Emulator window toggle properly', async () => {
    await page.waitFor(1000)
    await page.focus('#mainLayout')
    await page.type('#mainLayout', 'e')
    await page.keyboard.type('Much automated!')
    await Promise.all([expectBotApiCallSuccess('mod/channel-web/messages/'), page.keyboard.press('Enter')])
    await page.keyboard.press('Escape')
  })

  if (process.platform === 'darwin') {
    // TODO (1): Skip this test using native Jest features once https://github.com/facebook/jest/issues/8604 is resolved
    // TODO (2): Activate this test once Puppeteer supports native shortcuts (e.g. `⌘ J`) on OS X
    it.skip('Toggle Logs (SKIPPED ON MAC)', async () => {})
  } else {
    it('Toggle Logs', async () => {
      await page.focus('#mainLayout')
      await triggerKeyboardShortcut('KeyJ', true)
      const bottomPanel = await page.$('div[data-tab-id="bt-panel-logs"]')
      expect(await bottomPanel.isIntersectingViewport()).toBe(true)
      await triggerKeyboardShortcut('KeyJ', true)
    })
  }

  // Uncomment once the analytics v2 is enabled by default
  /*it('Load Analytics', async () => {
    await clickOn('#bp-menu_analytics-v2')
    await expectBotApiCallSuccess('mod/analytics-v2/channel/all')
    await expectMatch(/Dashboard/)
    await expectMatch(/Agent Usage/)
    await expectMatch(/Engagement & Retention/)
    await expectMatch(/Understanding/)
  })*/
})
