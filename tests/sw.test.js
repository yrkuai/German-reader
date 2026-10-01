import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const listed = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);

function filesIn(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
}

test('離線快取清單包含所有 JS 與圖示檔案', () => {
  for (const file of [...filesIn('js'), ...filesIn('icons')]) {
    assert.ok(listed.includes(file), `sw.js 的 APP_FILES 少了 ${file}`);
  }
});

test('離線快取清單裡的檔案都存在', () => {
  for (const file of listed) {
    assert.ok(existsSync(join(root, file)), `sw.js 列了不存在的檔案 ${file}`);
  }
});
