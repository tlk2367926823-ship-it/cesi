import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const xmlPath = resolve(__dirname, '..', 'dist', 'build', 'mp-xhs', 'pages', 'index', 'index.xhsml')
const jsPath = resolve(__dirname, '..', 'dist', 'build', 'mp-xhs', 'pages', 'index', 'index.js')

let js = readFileSync(jsPath, 'utf-8')

const debugHandlers = `
function __xhsPostNoteError(e) {
  console.error('[XHS_PostNote] binderror:', JSON.stringify(e));
  wx.showToast({ title: '跳转失败: ' + (e.detail?.errMsg || '未知错误'), icon: 'none' });
}
function __xhsPostNoteSuccess(e) {
  console.log('[XHS_PostNote] bindsuccess:', JSON.stringify(e));
  wx.showToast({ title: '正在打开小红书...', icon: 'none' });
}
`

if (!js.includes('__xhsPostNoteError')) {
  if (js.includes('Page(')) {
    js = js.replace('Page(', debugHandlers + '\nPage(')
  } else if (js.includes('Component(')) {
    js = js.replace('Component(', debugHandlers + '\nComponent(')
  } else {
    js += debugHandlers
  }
}

writeFileSync(jsPath, js)
console.log('[fix-mp-xhs] Done')
