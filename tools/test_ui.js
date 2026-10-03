/* 用 jsdom 真实加载 index.html，模拟用户操作走完整流程。
 * 用法: NODE_PATH=<workspace>/node_modules node tools/test_ui.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sample = fs.readFileSync(path.join(root, 'testdata', 'raw_sub.txt'), 'utf8');

let bad = 0;
function ok(m) { console.log('  ✅ ' + m); }
function fail(m) { console.log('  ❌ ' + m); bad++; }
function check(cond, m) { cond ? ok(m) : fail(m); }

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://zhangw51.github.io/sub2clash-web/',
  virtualConsole: new (require('jsdom').VirtualConsole)()
    .on('jsdomError', function (e) { errors.push(String(e && e.message || e)); }),
});
const win = dom.window;
const doc = win.document;

// 补上 jsdom 可能缺的全局（引擎依赖）
if (!win.TextDecoder) win.TextDecoder = TextDecoder;
if (!win.TextEncoder) win.TextEncoder = TextEncoder;
if (!win.atob) win.atob = function (s) { return Buffer.from(s, 'base64').toString('binary'); };
if (!win.btoa) win.btoa = function (s) { return Buffer.from(s, 'binary').toString('base64'); };

function click(el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function main() {
  console.log('=== jsdom 端到端测试 ===');
  await wait(120);

  /* 1. 页面与引擎就绪 */
  check(errors.length === 0, '页面加载无脚本错误' + (errors.length ? '：' + errors[0] : ''));
  check(typeof win.Sub2Clash === 'object' && win.Sub2Clash !== null, '引擎已挂到 window');
  check(typeof win.Sub2Clash.convert === 'function', '引擎 convert() 可用');

  /* 2. 默认状态 */
  const goBtn = doc.getElementById('btnGo');
  const copyBtn = doc.getElementById('btnCopy');
  check(goBtn && goBtn.textContent.trim() === '开始转换', '转换按钮文案正常');
  check(copyBtn.disabled === true, '初始状态下「复制」「下载」为禁用');

  /* 3. 切到「粘贴内容」并转换 */
  click(doc.querySelector('#inputTabs button[data-tab="text"]'));
  check(!doc.querySelector('.pane[data-pane="text"]').classList.contains('hidden'),
    '点击后「粘贴内容」面板显示');
  check(doc.querySelector('.pane[data-pane="url"]').classList.contains('hidden'),
    '「订阅链接」面板已隐藏');

  doc.getElementById('subText').value = sample;
  click(goBtn);
  await wait(300);

  const stats = doc.getElementById('stats').textContent;
  const code = doc.getElementById('outCode').textContent;
  check(/节点\s*6/.test(stats), '统计显示 6 个节点 → ' + stats.trim());
  check(/ss 1/.test(stats) && /vless 5/.test(stats), '协议分布正确（1 SS + 5 VLESS）');
  check(code.indexOf('proxy-groups:') !== -1, '配置预览含 proxy-groups');
  check(code.indexOf('proxy-server-nameserver') !== -1, '配置含 DNS 修复项');
  check(code.indexOf('fallback:') === -1, '配置未残留 fallback（超时根因）');
  check(copyBtn.disabled === false, '转换后「复制」按钮已启用');
  check(/转换完成/.test(doc.getElementById('msg').textContent), '提示区显示转换成功');

  /* 4. 节点列表面板 */
  click(doc.querySelector('#outTabs button[data-tab="nodes"]'));
  await wait(50);
  const rows = doc.querySelectorAll('#nodeRows tr');
  check(rows.length === 6, '节点表格渲染出 6 行（实际 ' + rows.length + '）');
  check(!doc.querySelector('.panel[data-panel="nodes"]').classList.contains('hidden'),
    '「节点列表」面板已显示');

  /* 5. 切换输出格式：base64 */
  doc.getElementById('target').value = 'base64';
  click(goBtn);
  await wait(300);
  const b64 = doc.getElementById('outCode').textContent.trim();
  let decoded = '';
  try { decoded = Buffer.from(b64, 'base64').toString('utf8'); } catch (e) {}
  check(decoded.split('\n').filter(Boolean).length === 6,
    'base64 输出可解码回 6 行节点');
  check(/sub\.txt/.test(doc.getElementById('outName').textContent), '文件名切换为 sub.txt');

  /* 6. 切换输出格式：surge */
  doc.getElementById('target').value = 'surge';
  click(goBtn);
  await wait(300);
  const surge = doc.getElementById('outCode').textContent;
  check(surge.indexOf('[Proxy]') !== -1 && surge.indexOf('[Rule]') !== -1, 'Surge 输出含 [Proxy]/[Rule] 段');

  /* 7. include 筛选 */
  doc.getElementById('target').value = 'clash';
  doc.getElementById('include').value = 'c22s3';
  click(goBtn);
  await wait(300);
  check(/节点\s*1/.test(doc.getElementById('stats').textContent),
    'include=c22s3 后只剩 1 个节点 → ' + doc.getElementById('stats').textContent.trim());
  doc.getElementById('include').value = '';

  /* 8. provider 模式：没填链接时应给出明确错误 */
  doc.getElementById('target').value = 'provider';
  doc.getElementById('subUrl').value = '';
  click(goBtn);
  await wait(300);
  check(/provider 模式需要一个/.test(doc.getElementById('msg').textContent),
    'provider 模式缺少订阅链接时提示明确');

  /* 9. provider 模式：填了链接应成功且不含内嵌节点 */
  doc.getElementById('subUrl').value = 'https://example.com/sub?token=x';
  click(goBtn);
  await wait(300);
  const prov = doc.getElementById('outCode').textContent;
  check(prov.indexOf('proxy-providers:') !== -1, 'provider 配置含 proxy-providers');
  check(/^# sub2clash · provider 模式/.test(prov.trim()), 'provider 配置头部正确');
  check(prov.indexOf('\nproxies:') === -1, 'provider 配置不内嵌节点');
  doc.getElementById('subUrl').value = '';

  /* 10. 错误路径：空内容 */
  doc.getElementById('target').value = 'clash';
  doc.getElementById('subText').value = '';
  click(goBtn);
  await wait(300);
  check(/请先粘贴订阅内容/.test(doc.getElementById('msg').textContent), '空内容时给出友好提示');

  /* 11. 错误路径：内容不是订阅 */
  doc.getElementById('subText').value = '这不是订阅，只是一段普通文字';
  click(goBtn);
  await wait(300);
  check(/转换失败/.test(doc.getElementById('msg').textContent), '无效内容时报转换失败');

  /* 12. 全程无未捕获异常 */
  check(errors.length === 0, '全程无脚本异常' + (errors.length ? '：' + errors.slice(0, 2).join(' | ') : ''));

  console.log('');
  console.log(bad === 0 ? 'jsdom 端到端测试全部通过' : ('发现 ' + bad + ' 个问题'));
  process.exit(bad === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('测试自身异常:', e);
  process.exit(1);
});
