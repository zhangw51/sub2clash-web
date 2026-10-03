/* 静态自检：确认 index.html 里引用的 DOM id / 引擎 API 都真实存在，
 * 并确认两段内联脚本语法可编译。抓的是「打开了但按钮没反应」这类低级错误。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let bad = 0;

function fail(msg) { console.log('  ❌ ' + msg); bad++; }
function ok(msg) { console.log('  ✅ ' + msg); }

/* ---------- 1. 拆出两段内联脚本 ---------- */
const scripts = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) scripts.push(m[1]);
console.log('内联脚本段数:', scripts.length);

if (scripts.length !== 2) { fail('期望 2 段脚本，实际 ' + scripts.length); }

/* ---------- 2. 语法编译（在无 DOM 的上下文里只做编译，不执行） ---------- */
scripts.forEach(function (code, i) {
  try {
    new vm.Script(code, { filename: 'inline-' + i + '.js' });
    ok('第 ' + (i + 1) + ' 段脚本语法可编译');
  } catch (e) {
    fail('第 ' + (i + 1) + ' 段脚本语法错误: ' + e.message);
  }
});

/* ---------- 3. id 引用一致性 ---------- */
const ids = new Set();
for (const mm of html.matchAll(/\sid="([^"]+)"/g)) ids.add(mm[1]);

const uiCode = scripts[1] || '';
const usedIds = new Set();
for (const mm of uiCode.matchAll(/\$\('([^']+)'\)/g)) usedIds.add(mm[1]);

const missingIds = Array.from(usedIds).filter(function (x) { return !ids.has(x); });
console.log('HTML 定义的 id:', ids.size, '| UI 引用的 id:', usedIds.size);
if (missingIds.length) fail('引用了不存在的 id: ' + missingIds.join(', '));
else ok('所有引用的 id 都存在');

/* ---------- 4. 引擎 API 一致性 ---------- */
const S = require(path.join(root, 'engine.js'));
const apiKeys = new Set(Object.keys(S));
const usedApi = new Set();
for (const mm of uiCode.matchAll(/\bS\.([A-Za-z_]\w*)/g)) usedApi.add(mm[1]);

const missingApi = Array.from(usedApi).filter(function (x) { return !apiKeys.has(x); });
console.log('引擎导出 API:', apiKeys.size, '| UI 调用的 API:', usedApi.size,
  '(' + Array.from(usedApi).join(', ') + ')');
if (missingApi.length) fail('调用了不存在的引擎 API: ' + missingApi.join(', '));
else ok('所有调用的引擎 API 都存在');

/* ---------- 5. 选择器对应的元素是否有 ---------- */
const selectors = [];
for (const mm of uiCode.matchAll(/querySelectorAll\('([^']+)'\)/g)) selectors.push(mm[1]);
const selectorChecks = [
  { sel: '#inputTabs button', has: /id="inputTabs"[\s\S]*?<button/.test(html) },
  { sel: '#outTabs button', has: /id="outTabs"[\s\S]*?<button/.test(html) },
  { sel: '.pane[data-pane]', has: /class="pane[^"]*"[^>]*data-pane=/.test(html) },
  { sel: '.panel[data-panel]', has: /class="panel[^"]*"[^>]*data-panel=/.test(html) },
];
console.log('用到的选择器:', selectors.join(' / '));
selectorChecks.forEach(function (c) {
  if (c.has) ok('选择器可用: ' + c.sel);
  else fail('选择器命中不到元素: ' + c.sel);
});

/* ---------- 6. 关键属性/事件接线 ---------- */
[['btnGo', 'click'], ['btnFetch', 'click'], ['btnCopy', 'click'], ['btnDl', 'click'],
 ['fileInput', 'change'], ['drop', 'drop']].forEach(function (pair) {
  // 事件监听可能写成 $('x').addEventListener(...) 或先取变量 x 再绑定，
  // 所以只要求：元素存在 + 绑定调用出现在 UI 脚本里。
  const hasEl = new RegExp('id="' + pair[0] + '"').test(html);
  const hasBind = uiCode.indexOf(".addEventListener('" + pair[1] + "'") !== -1
    && uiCode.indexOf("$('" + pair[0] + "')") !== -1;
  if (hasEl && hasBind) ok('事件已接线: #' + pair[0] + ' → ' + pair[1]);
  else fail('事件未接线: #' + pair[0] + ' → ' + pair[1]);
});

/* ---------- 7. data-pane / data-panel 名称与 tab 一一对应 ---------- */
const panes = Array.from(html.matchAll(/data-pane="([^"]+)"/g)).map(function (x) { return x[1]; });
const panelTabs = Array.from(html.matchAll(/data-panel="([^"]+)"/g)).map(function (x) { return x[1]; });
const tabNames = Array.from(html.matchAll(/data-tab="([^"]+)"/g)).map(function (x) { return x[1]; });
console.log('data-pane:', panes.join(','));
console.log('data-panel:', panelTabs.join(','));
console.log('data-tab:', tabNames.join(','));
const known = new Set(tabNames);
const orphan = panes.concat(panelTabs).filter(function (p) { return !known.has(p); });
if (orphan.length) fail('没有对应 tab 的面板: ' + orphan.join(', '));
else ok('面板与 tab 名称一一对应');

console.log('');
console.log(bad === 0 ? '静态自检全部通过' : ('静态自检发现 ' + bad + ' 个问题'));
process.exit(bad === 0 ? 0 : 1);
