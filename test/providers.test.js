'use strict';

// CLI ごとの引数組み立てとプロバイダ解決のテスト。
//
// 引数は 2026-08-14 に実機 (claude 2.1.232 / codex 0.147.0 / gemini 0.55.1) で
// 確認した形。CLI 側の仕様が変わったらここを直す。
//
// 実行: npm test

const test = require('node:test');
const assert = require('node:assert');

const { _internal, withSettings, properties } = require('./support.js');
const { PROVIDERS, resolveProvider } = _internal;

const PROMPT = 'プロンプト本文';

test('claude はモデルを --model で渡し、プロンプトを最後の引数にする', () => {
  const args = PROVIDERS.claude.buildArgs({ model: 'sonnet', prompt: PROMPT });

  assert.deepStrictEqual(args, ['-p', '--model', 'sonnet', PROMPT]);
});

test('モデル未指定なら --model を渡さず CLI の既定に任せる', () => {
  assert.deepStrictEqual(PROVIDERS.claude.buildArgs({ model: '', prompt: PROMPT }), [
    '-p',
    PROMPT,
  ]);
  assert.ok(!PROVIDERS.codex.buildArgs({ model: '', prompt: PROMPT }).includes('--model'));
  assert.ok(!PROVIDERS.gemini.buildArgs({ model: '', prompt: PROMPT }).includes('-m'));
});

test('codex は exec サブコマンドで、一時ディレクトリでも動く指定を付ける', () => {
  const args = PROVIDERS.codex.buildArgs({
    model: 'gpt-5.6-sol',
    prompt: PROMPT,
    lastMessageFile: '/tmp/x/last-message.txt',
  });

  assert.strictEqual(args[0], 'exec');
  assert.ok(args.includes('--skip-git-repo-check'));
  // 書き込みを伴う操作をさせない
  assert.deepStrictEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), [
    '--sandbox',
    'read-only',
  ]);
  assert.deepStrictEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), [
    '--model',
    'gpt-5.6-sol',
  ]);
  assert.strictEqual(args[args.length - 1], PROMPT);
});

test('codex の本文は stdout ではなく --output-last-message のファイルから取る', () => {
  // codex exec は受け取ったプロンプト全文を stdout にエコーする。エコーには
  // <commit_message> の字面も含まれるので、stdout を読むとエコー側のタグを
  // 本文と誤認する。
  assert.strictEqual(PROVIDERS.codex.usesLastMessageFile, true);

  const args = PROVIDERS.codex.buildArgs({
    model: '',
    prompt: PROMPT,
    lastMessageFile: '/tmp/x/last-message.txt',
  });
  const at = args.indexOf('--output-last-message');

  assert.notStrictEqual(at, -1);
  assert.strictEqual(args[at + 1], '/tmp/x/last-message.txt');
});

test('claude と gemini は stdout をそのまま読む', () => {
  assert.ok(!PROVIDERS.claude.usesLastMessageFile);
  assert.ok(!PROVIDERS.gemini.usesLastMessageFile);
});

test('gemini は --skip-trust 付きの非対話モードで動かす', () => {
  const args = PROVIDERS.gemini.buildArgs({ model: 'gemini-3-pro', prompt: PROMPT });

  // headless では信頼していないディレクトリで止まるため必須
  assert.ok(args.includes('--skip-trust'));
  assert.deepStrictEqual(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2), [
    '-m',
    'gemini-3-pro',
  ]);
  assert.deepStrictEqual(args.slice(-2), ['-p', PROMPT]);
});

test('プロバイダ未設定なら claude を使う', () => {
  assert.strictEqual(resolveProvider().name, 'claude');
});

test('設定したプロバイダを解決する', () => {
  for (const name of Object.keys(PROVIDERS)) {
    withSettings({ 'cliCommitMsg.provider': name }, () => {
      assert.strictEqual(resolveProvider().name, name);
    });
  }
});

test('未知のプロバイダは claude に落とさずエラーにする', () => {
  withSettings({ 'cliCommitMsg.provider': 'gpt4all' }, () => {
    // 黙って別の CLI を叩くと、選んだつもりのないモデルで課金が走る
    assert.throws(() => resolveProvider(), /gpt4all/);
  });
});

test('各プロバイダのモデル設定とパス設定が package.json に存在する', () => {
  for (const [name, spec] of Object.entries(PROVIDERS)) {
    assert.ok(
      properties[`cliCommitMsg.${spec.modelSetting}`],
      `${name} の modelSetting (${spec.modelSetting}) が設定スキーマにない`
    );
    assert.ok(
      properties[`cliCommitMsg.${spec.pathSetting}`],
      `${name} の pathSetting (${spec.pathSetting}) が設定スキーマにない`
    );
  }
});

test('provider の選択肢が PROVIDERS と一致する', () => {
  assert.deepStrictEqual(
    [...properties['cliCommitMsg.provider'].enum].sort(),
    Object.keys(PROVIDERS).sort()
  );
});
