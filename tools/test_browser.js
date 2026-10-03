/* 真实 Chromium 渲染测试 + 截图。
 * 用法: NODE_PATH=<workspace>/node_modules node tools/test_browser.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe';
const root = path.join(__dirname, '..');
const pageUrl = 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/');
const sample = fs.readFileSync(path.join(root, 'testdata', 'raw_sub.txt'), 'utf8');

let bad = 0;
function ok(m) { console.log('  ✅ ' + m); }
function fail(m) { console.log('  ❌ ' + m); bad++; }
function check(c, m) { c ? ok(m) : fail(m); }

(async function main() {
  console.log('=== 真实浏览器测试 ===');
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });

  const consoleErrors = [];
  page.on('pageerror', function (e) { consoleErrors.push(String(e.message || e)); });
  page.on('console', function (m) { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  /* 1. 基础渲染 */
  check(await page.title() !== '', '页面标题：' + (await page.title()));
  check(await page.evaluate(function () { return typeof window.Sub2Clash === 'object'; }), '引擎在浏览器中可用');
  check(await page.isVisible('text=订阅转换'), '主标题可见');
  check(await page.isVisible('#btnGo'), '转换按钮可见');
  check(await page.isVisible('#inputTabs'), '输入模式切换可见');

  /* 2. 布局：宽屏应为两栏 */
  const twoCol = await page.evaluate(function () {
    var l = document.querySelector('.layout');
    return getComputedStyle(l).gridTemplateColumns.split(' ').length;
  });
  check(twoCol === 2, '宽屏下是两栏布局（列数 ' + twoCol + '）');

  /* 3. 真实交互：粘贴内容 → 转换 */
  await page.click('#inputTabs button[data-tab="text"]');
  await page.waitForTimeout(120);
  check(await page.isVisible('.pane[data-pane="text"]'), '「粘贴内容」面板可显示');

  await page.fill('#subText', sample);
  await page.click('#btnGo');
  await page.waitForFunction(function () {
    return document.querySelector('#stats .pill') !== null;
  }, { timeout: 8000 });

  const stats = (await page.textContent('#stats')).replace(/\s+/g, ' ').trim();
  check(/节点 6/.test(stats), '真实浏览器中转换出 6 个节点 → ' + stats);

  const codeLen = (await page.textContent('#outCode')).length;
  check(codeLen > 3000, '配置预览已渲染（' + codeLen + ' 字符）');
  check(await page.isVisible('.msg.ok'), '成功提示以绿色样式显示');

  /* 4. 切到节点列表 */
  await page.click('#outTabs button[data-tab="nodes"]');
  await page.waitForTimeout(150);
  const rowCount = await page.locator('#nodeRows tr').count();
  check(rowCount === 6, '节点表格渲染 6 行（实际 ' + rowCount + '）');
  check(await page.isVisible('table.nodes'), '节点表格可见');

  /* 5. 截图：结果态（节点列表） */
  await page.screenshot({ path: path.join(root, 'testdata', 'shot-result-nodes.png'), fullPage: true });

  /* 6. 切回配置视图并截图 */
  await page.click('#outTabs button[data-tab="code"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(root, 'testdata', 'shot-result-code.png'), fullPage: true });

  /* 7. 窄屏响应式 */
  await page.setViewportSize({ width: 420, height: 900 });
  await page.waitForTimeout(300);
  const narrowCols = await page.evaluate(function () {
    var l = document.querySelector('.layout');
    return getComputedStyle(l).gridTemplateColumns.split(' ').length;
  });
  check(narrowCols === 1, '窄屏下退化为单栏（列数 ' + narrowCols + '）');
  await page.screenshot({ path: path.join(root, 'testdata', 'shot-mobile.png'), fullPage: false });

  /* 8. 初始态截图 */
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, 'testdata', 'shot-initial.png'), fullPage: true });

  /* 9. 无未捕获异常 */
  check(consoleErrors.length === 0, '无控制台错误' + (consoleErrors.length ? '：' + consoleErrors.slice(0, 3).join(' | ') : ''));

  await browser.close();
  console.log('');
  console.log(bad === 0 ? '真实浏览器测试全部通过' : ('发现 ' + bad + ' 个问题'));
  process.exit(bad === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('测试自身异常:', e);
  process.exit(1);
});
