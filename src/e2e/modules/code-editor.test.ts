import { clickOn, fillField } from '../expectPuppeteer'
import {
  autoAnswerDialog,
  clickOnTreeNode,
  CONFIRM_DIALOG,
  expectBotApiCallSuccess,
  gotoStudio,
  triggerKeyboardShortcut,
  waitForBotApiResponse
} from '../utils'

const waitForFilesToLoad = async () =>
  page.waitForFunction('document.querySelectorAll(".bp3-icon-document").length > 0')

describe('Module - Code Editor', () => {
  beforeAll(async () => {
    if (!page.url().includes('studio')) {
      await gotoStudio()
    }
  })

  it('Load Code Editor', async () => {
    await clickOn('#bp-menu_code-editor')
    await expectBotApiCallSuccess('mod/code-editor/files')
  })

  it('Create new action', async () => {
    await clickOn('#btn-add-action')
    await fillField('#input-name', 'hello')
    await clickOn('#btn-submit')

    await page.focus('#monaco-editor')
    await page.mouse.click(469, 297)
    await page.waitFor(500) // Required so the editor is correctly focused at the right place
    await page.keyboard.type("const lol = 'hi' //")

    await Promise.all([
      expectBotApiCallSuccess('mod/code-editor/save', 'POST'),
      expectBotApiCallSuccess('mod/code-editor/files', 'GET'),
      triggerKeyboardShortcut('KeyS', true)
    ])
  })

  it('Duplicate action', async () => {
    await waitForFilesToLoad()
    await clickOnTreeNode('hello.js', 'right')
    await clickOn('#btn-duplicate')

    await expectBotApiCallSuccess('mod/code-editor/save', 'POST')
  })

  it('Disable file', async () => {
    await waitForFilesToLoad()
    await clickOnTreeNode('hello_copy.js', 'right')
    await clickOn('#btn-disable')

    await expectBotApiCallSuccess('mod/code-editor/rename', 'POST')
    const response = await waitForBotApiResponse('mod/code-editor/files')
    const disabledFile = response['bot.actions'].find(x => x.name === '.hello_copy.js')
    expect(disabledFile).toBeDefined()
  })

  it('Delete file', async () => {
    await waitForFilesToLoad()
    await clickOnTreeNode('.hello_copy.js', 'right')
    await clickOn('#btn-delete')
    await clickOn(CONFIRM_DIALOG.ACCEPT)

    await expectBotApiCallSuccess('mod/code-editor/remove', 'POST')
    const response = await waitForBotApiResponse('mod/code-editor/files')
    expect(response['bot.actions'].find(x => x.name === '.hello_copy.js')).toBeUndefined()
  })
})
