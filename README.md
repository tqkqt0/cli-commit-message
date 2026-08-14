# CLI Commit Message

手元の CLI エージェントでコミットメッセージを生成し、ソース管理の入力欄に直接書き込む
VS Code 拡張。Claude Code / OpenAI Codex / Gemini CLI から選べる。

Copilot の「Generate Commit Message」(✨) が
[microsoft/vscode#316204](https://github.com/microsoft/vscode/issues/316204)
の `promptFiltered` (422) で使えなくなったための代替。上流は未修正・回避策なし。

## 前提

- 使う CLI がインストール済みで、**ログインまで済んでいる**こと
  （`claude` / `codex` / `gemini`。`command -v <名前>` で確認）
- macOS / Linux（`git diff --no-index -- /dev/null <file>` を使うため）

拡張は API キーを持たない。認証は各 CLI に任せているので、先に一度ターミナルで
動かしてログイン状態を作っておく。

### Gemini を使う場合の注意

2026-08 時点で、Google アカウントの OAuth（Gemini Code Assist 個人無料枠）では
`gemini` CLI が `IneligibleTierError: This client is no longer supported` を返す。
使うには `GEMINI_API_KEY` を環境変数に置く（AI Studio のキー）。

VS Code を Dock から起動するとシェルの設定が読まれず環境変数が届かないことがある。
その場合はターミナルから `code` で起動するか、拡張ホストに届く形で設定する。

## 使い方

ソース管理ビューのタイトルバーにある ✦ アイコンを押す。生成中は ⏹ に変わり、押すと中止できる。

コマンドパレットからは `CLI Commit: コミットメッセージを生成`。

対象にする差分:

| リポジトリの状態 | 送る差分 |
| --- | --- |
| ステージ済みがある | `git diff --cached` のみ（未追跡は無視） |
| ステージ済みがない | `git diff` 全体 ＋ 未追跡ファイルの内容 |

部分コミットしたいときは先に `git add` する。

## 設定

すべて設定 UI から変更できる（設定を開いて `cliCommitMsg` で検索）。

| キー | 既定値 | 用途 |
| --- | --- | --- |
| `cliCommitMsg.provider` | `claude` | `claude` / `codex` / `gemini` |
| `cliCommitMsg.model` | `sonnet` | Claude 用。`haiku` / `sonnet` / `opus` |
| `cliCommitMsg.codexModel` | 空 | Codex 用。空なら CLI の既定モデル |
| `cliCommitMsg.geminiModel` | 空 | Gemini 用。空なら CLI の既定モデル |
| `cliCommitMsg.instructions` | 日本語 + Conventional Commits | メッセージの規約。1 項目 1 行 |
| `cliCommitMsg.promptTemplate` | 下記参照 | プロンプト全文。`${instructions}` が置換される |
| `cliCommitMsg.diffScope` | `stagedOrAll` | `stagedOnly` にすると常にステージ済みのみ |
| `cliCommitMsg.includeUntracked` | `true` | 未追跡ファイルの内容も渡す |
| `cliCommitMsg.maxDiffBytes` | `400000` | 超過分は末尾を切り捨て。`0` で無制限 |
| `cliCommitMsg.onExistingMessage` | `replace` | `append` / `keep` も選べる |
| `cliCommitMsg.claudePath` | `claude` | `command not found` なら絶対パスを指定 |
| `cliCommitMsg.codexPath` | `codex` | 同上 |
| `cliCommitMsg.geminiPath` | `gemini` | 同上 |
| `cliCommitMsg.runInNeutralCwd` | `true` | 一時ディレクトリで CLI を実行する |

モデル設定とパス設定は、選んだ `provider` に対応するものだけが使われる。
`provider` に未知の値を入れた場合は claude に落とさずエラーにする（選んだつもりのない
CLI とモデルで課金が走らないようにするため）。

`runInNeutralCwd` を切るとリポジトリ直下で CLI が動き、`CLAUDE.md` / `AGENTS.md` /
`GEMINI.md` / `.claude` のフックが効く。プロジェクトの指示によってはサブエージェントが
起動して大幅に遅くなるため、既定でオンにしている（＝一時ディレクトリで実行）。

## CLI ごとの違い

差分は常に標準入力で渡す。違うのは引数と、本文をどこから読むかだけ。

| provider | 実行するコマンド | 本文の取り出し |
| --- | --- | --- |
| `claude` | `claude -p [--model M] <prompt>` | 標準出力 |
| `codex` | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never [--model M] --output-last-message <file> <prompt>` | 一時ファイル |
| `gemini` | `gemini --skip-trust [-m M] -p <prompt>` | 標準出力 |

`codex exec` は実行環境の要約・受け取ったプロンプト全文・トークン数まで標準出力に出す。
そのエコーには `<commit_message>` の字面も含まれるため、標準出力を読むとエコー側のタグを
本文と誤認する。だから Codex だけ `--output-last-message` のファイルから読む。

`--sandbox read-only`（Codex）は、コミットメッセージ生成にファイル変更が要らないため。
`--skip-git-repo-check`（Codex）と `--skip-trust`（Gemini）は、一時ディレクトリでも
止まらずに動かすために常に付ける。

## 出力の取り出し方

どの CLI にも本体を `<commit_message>` タグで囲んで返すよう指示し、拡張はタグの中身だけを
入力欄に入れる。この指示は `promptTemplate` とは別に拡張が必ず末尾へ足すので、テンプレートを
書き換えても外れない。

「前置きを付けるな」という指示だけに頼っていた頃は、モデルがそれを破ると
「コミットメッセージが生成されました。以下がご要望に沿った形式です：」のような前置きと
末尾の講評ごと入力欄に入り、そのままコミットされることがあった。

タグが取れなかった場合は出力全体を書き込んだうえで警告を出す。生成物を捨てるより
中身を見せたほうが早いが、検証できていないことは必ず知らせる。警告が出たときは
入力欄に余計な文章が混ざっていないか確認する。

`promptTemplate` の「出力形式」の 2 行も保険として残しておくと安定する。

## ログ

出力パネルの `CLI Commit Message`。コマンドパレットの
`CLI Commit: ログを表示` でも開く。対象範囲・差分の統計・所要時間・エラーが出る。

## ビルドとインストール

npm も vsce も使わない。`.vsix` は ZIP なので Python の標準ライブラリで作る。

```sh
python3 build-vsix.py
code --install-extension cli-commit-message-0.1.1.vsix --force
```

インストール後は VS Code で `Developer: Reload Window`。

コードを直したら同じ 2 コマンドを流し直す。`package.json` の `version` を上げないと
VS Code がキャッシュを掴んだままになることがあるので、挙動が変わらないときは上げる。

VS Code のプロファイルを使っている場合、拡張はプロファイルごとに有効・無効が分かれる。
インストール後に拡張ビューで有効になっているか確認する。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `package.json` | マニフェスト。コマンド / メニュー / 設定スキーマ |
| `extension.js` | 実装。素の CommonJS、依存なし |
| `build-vsix.py` | `.vsix` パッケージャ |
| `icon.png` | 拡張ビューに出すアイコン（256x256 PNG） |
| `test/support.js` | テストから `extension.js` を読むための足場（`vscode` スタブ） |
| `test/parse.test.js` | 出力の取り出しとプロンプト組み立てのテスト |
| `test/providers.test.js` | CLI ごとの引数組み立てとプロバイダ解決のテスト |

## テスト

依存パッケージなし。Node 標準のテストランナーで動く（`.vsix` には入らない）。

```sh
npm test          # = node --test test/*.test.js
```

`vscode` モジュールはテスト側でスタブしているので、VS Code を起動せずに走る。

## 制限

- ボタンは入力欄の中ではなくタイトルバーに出る。入力欄内 (`scm/inputBox`) は
  proposed API (`contribSourceControlInputBoxMenu`) で、Copilot が組み込み拡張だから
  使えていた。同じ位置に出すには `~/.vscode/argv.json` に
  `"enable-proposed-api": ["takato.cli-commit-message"]` を足して VS Code を完全再起動する
- 実行のたびに選んだ CLI の利用枠を消費する。差分が大きいほど増えるので `git add` で絞ると有利
