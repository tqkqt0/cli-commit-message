'use strict';

// テストから extension.js を素の Node で読むための足場。
//
// extension.js は 'vscode' を top-level で require する。拡張ホストの外では解決
// できないので、モジュール解決だけ差し替える。設定の既定値は package.json の
// スキーマから読むので、既定値を変えたらテストも自動で追従する。

const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const properties = pkg.contributes.configuration.properties;

/** テストごとに差し替える設定値。空なら package.json の既定値が使われる。 */
const overrides = new Map();

const fakeVscode = {
  workspace: {
    getConfiguration: (section) => ({
      get: (key) => {
        const full = `${section}.${key}`;
        if (overrides.has(full)) return overrides.get(full);
        const prop = properties[full];
        return prop ? prop.default : undefined;
      },
    }),
  },
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    showWarningMessage() {},
    showErrorMessage() {},
    showInformationMessage() {},
    setStatusBarMessage() {},
    withProgress: (_opts, task) => task(),
  },
  commands: { registerCommand() {}, executeCommand() {} },
  extensions: { getExtension: () => undefined },
  ProgressLocation: { SourceControl: 1 },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require(path.join(ROOT, 'extension.js'));

// trace() が書き込む OutputChannel は activate() で作られる。runCli のように
// ログを出す関数を直接呼べるよう、ここで一度だけ有効化する (vscode API は全てスタブ)。
extension.activate({ subscriptions: [] });

const { _internal } = extension;

/** 設定を差し替えて fn を走らせ、必ず元に戻す。 */
function withSettings(values, fn) {
  const keys = Object.keys(values);
  keys.forEach((key) => overrides.set(key, values[key]));
  try {
    return fn();
  } finally {
    keys.forEach((key) => overrides.delete(key));
  }
}

module.exports = { _internal, overrides, withSettings, properties, pkg };
