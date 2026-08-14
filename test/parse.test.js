'use strict';

// Claude の出力からコミットメッセージ本体を取り出す部分のテスト。
//
// 守りたい退行 (2026-08-14 実際に起きた事故):
//   コミット 7f8bf09ba のメッセージが
//   「コミットメッセージが生成されました。以下がご要望に沿った形式です：」で始まり、
//   末尾に「このメッセージは以下の特徴を備えています：...」が付いた状態でコミットされた。
//   プロンプトで前置き・後書きを禁じていても、モデルが守る保証はない。
//
// 実行: node --test test/

const test = require('node:test');
const assert = require('node:assert');

const { _internal, withSettings } = require('./support.js');
const { extractMessage, buildPrompt, tidy } = _internal;

const BODY = [
  'feat: Gemini モデルを 3.7-flash へ更新',
  '',
  '- モデルバージョンを統一',
  '- E2E カセットを更新',
].join('\n');

test('タグの外側の前置きと後書きを捨てて本体だけを返す', () => {
  const raw = [
    'コミットメッセージが生成されました。以下がご要望に沿った形式です：',
    '',
    '<commit_message>',
    BODY,
    '</commit_message>',
    '',
    'このメッセージは以下の特徴を備えています：',
    '- **プレフィックス**: `feat`',
  ].join('\n');

  const result = extractMessage(raw);

  assert.strictEqual(result.message, BODY);
  assert.strictEqual(result.clean, true);
});

test('タグだけの素直な出力もそのまま通す', () => {
  const result = extractMessage(`<commit_message>\n${BODY}\n</commit_message>\n`);

  assert.strictEqual(result.message, BODY);
  assert.strictEqual(result.clean, true);
});

test('タグの中のコードフェンスは落とす', () => {
  const raw = ['<commit_message>', '```', BODY, '```', '</commit_message>'].join('\n');

  assert.strictEqual(extractMessage(raw).message, BODY);
});

test('中身が空のタグは飛ばして実体のあるタグを採る', () => {
  const raw = [
    '形式の例:',
    '<commit_message></commit_message>',
    '実際のメッセージ:',
    `<commit_message>${BODY}</commit_message>`,
  ].join('\n');

  const result = extractMessage(raw);

  assert.strictEqual(result.message, BODY);
  assert.strictEqual(result.clean, true);
});

test('タグが無い出力は全文を返しつつ clean=false で知らせる', () => {
  const raw = ['以下がコミットメッセージです：', '', BODY].join('\n');

  const result = extractMessage(raw);

  // 生成物を捨てるとユーザーが再実行するしかないので中身は渡す。ただし
  // 検証できていないことは呼び出し側へ伝え、黙って入力欄に入れない。
  assert.strictEqual(result.clean, false);
  assert.ok(result.message.includes(BODY));
  assert.ok(result.message.startsWith('以下がコミットメッセージです：'));
});

test('閉じタグが無い出力はタグ文字列だけ落として clean=false にする', () => {
  const raw = ['<commit_message>', BODY].join('\n');

  const result = extractMessage(raw);

  assert.strictEqual(result.clean, false);
  assert.strictEqual(result.message, BODY);
});

test('空出力は空文字を返す', () => {
  assert.strictEqual(extractMessage('   \n\n').message, '');
  assert.strictEqual(extractMessage('<commit_message>\n\n</commit_message>').message, '');
});

test('CRLF と行末空白を落とす', () => {
  assert.strictEqual(tidy('feat: x  \r\n\r\n- y\t\r\n'), 'feat: x\n\n- y');
});

test('promptTemplate を書き換えてもタグの約束はプロンプトに残る', () => {
  withSettings(
    { 'cliCommitMsg.promptTemplate': ['差分からコミットメッセージを書いて。'] },
    () => {
      const prompt = buildPrompt();

      assert.ok(prompt.includes('差分からコミットメッセージを書いて。'));
      assert.ok(prompt.includes('<commit_message>'));
      assert.ok(prompt.includes('</commit_message>'));
    }
  );
});

test('instructions は箇条書きとして ${instructions} の位置に入る', () => {
  withSettings(
    {
      'cliCommitMsg.promptTemplate': ['規約:', '${instructions}'],
      'cliCommitMsg.instructions': ['日本語で書く', 'Conventional Commits'],
    },
    () => {
      const prompt = buildPrompt();

      assert.ok(prompt.includes('規約:\n- 日本語で書く\n- Conventional Commits'));
    }
  );
});

test('既定のプロンプトは英語で、タグの約束と言語指定が入る', () => {
  const prompt = buildPrompt();

  assert.ok(prompt.includes('<commit_message>'));
  assert.ok(prompt.includes('Write the commit message in English.'));
  assert.ok(prompt.includes('Conventional Commits'));
});

test('language を変えると生成物の言語指定だけが変わる', () => {
  withSettings({ 'cliCommitMsg.language': '日本語' }, () => {
    const prompt = buildPrompt();

    assert.ok(prompt.includes('Write the commit message in 日本語.'));
    // 指示の本体 (英語) はそのまま。言語だけを差し替える設計
    assert.ok(prompt.includes('Conventional Commits'));
  });
});

test('language が空でも English にフォールバックする', () => {
  withSettings({ 'cliCommitMsg.language': '   ' }, () => {
    assert.ok(buildPrompt().includes('Write the commit message in English.'));
  });
});

test('promptTemplate を空にしても言語指定とタグの約束は残る', () => {
  withSettings({ 'cliCommitMsg.promptTemplate': [], 'cliCommitMsg.language': 'Français' }, () => {
    const prompt = buildPrompt();

    assert.ok(prompt.includes('Write the commit message in Français.'));
    assert.ok(prompt.includes('<commit_message>'));
  });
});
