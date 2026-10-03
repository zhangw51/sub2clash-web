/* 把 engine.js 内联进 ui.html，产出单文件 index.html。
 * 用法: node tools/build.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'engine.js'), 'utf8');
const tpl = fs.readFileSync(path.join(root, 'ui.html'), 'utf8');

if (tpl.indexOf('/* __ENGINE__ */') === -1) {
  console.error('模板里找不到 /* __ENGINE__ */ 占位符');
  process.exit(1);
}
if (engine.indexOf('</scr' + 'ipt>') !== -1) {
  console.error('引擎代码里出现了 </script>，会截断 HTML，请先处理');
  process.exit(1);
}

const out = tpl.replace('/* __ENGINE__ */', function () { return engine; });
const dest = path.join(root, 'index.html');
fs.writeFileSync(dest, out, 'utf8');

console.log('已生成 ' + dest);
console.log('  大小: ' + (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1) + ' KB');
console.log('  行数: ' + out.split('\n').length);
