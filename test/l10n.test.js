'use strict';

// ローカライズ資源の整合テスト。
//
// 表示は英語が既定で、日本語は差し替え。翻訳が 1 つ欠けると、その文言だけ英語のまま
// 出てしまい気づきにくいので、キーの過不足をここで固定する。
//
// 実行: npm test

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));

const source = read('extension.js');
const bundleJa = readJson('l10n/bundle.l10n.ja.json');
const pkg = readJson('package.json');
const nlsEn = readJson('package.nls.json');
const nlsJa = readJson('package.nls.ja.json');

/** extension.js が実際に vscode.l10n.t() へ渡している英語原文を集める。 */
function messagesInSource() {
  const found = new Set();
  const pattern = /vscode\.l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    // ソース上のエスケープを、実行時に t() が受け取る文字列へ戻す
    found.add(match[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"));
  }
  return found;
}

/** package.json の中で使われている %key% を集める。 */
function keysInManifest() {
  const found = new Set();
  JSON.stringify(pkg).replace(/%([A-Za-z0-9_.]+)%/g, (whole, key) => {
    found.add(key);
    return whole;
  });
  return found;
}

test('実行時メッセージに日本語訳の抜けがない', () => {
  const missing = [...messagesInSource()].filter((m) => !(m in bundleJa));

  assert.deepStrictEqual(missing, [], `未翻訳: ${JSON.stringify(missing)}`);
});

test('日本語バンドルに使われていない訳が残っていない', () => {
  const used = messagesInSource();
  const stale = Object.keys(bundleJa).filter((key) => !used.has(key));

  assert.deepStrictEqual(stale, [], `未使用の訳: ${JSON.stringify(stale)}`);
});

test('l10n のプレースホルダ数が英日で一致する', () => {
  const count = (text) => new Set(text.match(/\{\d+\}/g) || []).size;

  for (const [en, ja] of Object.entries(bundleJa)) {
    assert.strictEqual(count(ja), count(en), `プレースホルダ不一致: ${JSON.stringify(en)}`);
  }
});

test('package.json の %key% がすべて英語の nls に定義されている', () => {
  const missing = [...keysInManifest()].filter((key) => !(key in nlsEn));

  assert.deepStrictEqual(missing, [], `未定義: ${JSON.stringify(missing)}`);
});

test('設定画面の文言が英日で同じキーを持つ', () => {
  assert.deepStrictEqual(Object.keys(nlsEn).sort(), Object.keys(nlsJa).sort());
});

test('nls に使われていないキーが残っていない', () => {
  const used = keysInManifest();
  const stale = Object.keys(nlsEn).filter((key) => !used.has(key));

  assert.deepStrictEqual(stale, [], `未使用のキー: ${JSON.stringify(stale)}`);
});

test('l10n バンドルの置き場所が package.json の宣言と一致する', () => {
  assert.strictEqual(pkg.l10n, './l10n');
  assert.ok(fs.existsSync(path.join(ROOT, 'l10n', 'bundle.l10n.ja.json')));
});
