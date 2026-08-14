# CLI Commit Message

Write git commit messages with the CLI agent you already have, straight into the Source Control
input box. Pick between **Claude Code**, **OpenAI Codex** and **Gemini CLI**.

[日本語版はこちら](#cli-commit-message-日本語)

It exists because Copilot's "Generate Commit Message" (✨) stopped working behind
[microsoft/vscode#316204](https://github.com/microsoft/vscode/issues/316204)
(`promptFiltered`, 422). Upstream is still unfixed with no workaround.

## Requirements

- The CLI you want to use is installed **and already logged in**
  (`claude` / `codex` / `gemini`; check with `command -v <name>`)
- macOS / Linux (it uses `git diff --no-index -- /dev/null <file>`)

The extension holds no API key of its own. Authentication is left to each CLI, so run it once in a
terminal first and complete the login there.

### Note for Gemini

As of 2026-08, Google account OAuth (the free Gemini Code Assist tier for individuals) makes the
`gemini` CLI fail with `IneligibleTierError: This client is no longer supported`. Set a
`GEMINI_API_KEY` environment variable (an AI Studio key) to use it.

Launching VS Code from the Dock may skip your shell configuration, in which case the variable never
reaches the extension host. Start VS Code with `code` from a terminal, or set the variable somewhere
the extension host can see.

## Usage

Press the ✦ icon in the Source Control view title bar. It turns into ⏹ while generating; press that
to cancel.

From the Command Palette: `CLI Commit: Generate Commit Message`.

Which diff gets sent:

| Repository state | Diff sent |
| --- | --- |
| Something is staged | `git diff --cached` only (untracked files ignored) |
| Nothing is staged | the whole `git diff` plus the contents of untracked files |

Stage first with `git add` when you want a partial commit.

## Settings

Everything is editable from the Settings UI (open Settings and search for `cliCommitMsg`).

| Key | Default | Purpose |
| --- | --- | --- |
| `cliCommitMsg.provider` | `claude` | `claude` / `codex` / `gemini` |
| `cliCommitMsg.language` | `English` | Language of the generated message |
| `cliCommitMsg.model` | `sonnet` | For Claude. `haiku` / `sonnet` / `opus` |
| `cliCommitMsg.codexModel` | empty | For Codex. Empty means the CLI default |
| `cliCommitMsg.geminiModel` | empty | For Gemini. Empty means the CLI default |
| `cliCommitMsg.instructions` | Conventional Commits | Rules for the message, one per line |
| `cliCommitMsg.promptTemplate` | see below | The full prompt. `${instructions}` is substituted |
| `cliCommitMsg.diffScope` | `stagedOrAll` | `stagedOnly` always uses staged changes only |
| `cliCommitMsg.includeUntracked` | `true` | Also send the contents of untracked files |
| `cliCommitMsg.maxDiffBytes` | `400000` | Truncated from the end beyond this. `0` disables the limit |
| `cliCommitMsg.onExistingMessage` | `replace` | `append` / `keep` are also available |
| `cliCommitMsg.claudePath` | `claude` | Use an absolute path if you get `command not found` |
| `cliCommitMsg.codexPath` | `codex` | Same |
| `cliCommitMsg.geminiPath` | `gemini` | Same |
| `cliCommitMsg.runInNeutralCwd` | `true` | Run the CLI in a temporary directory |

Only the model and path settings of the selected `provider` are used. An unknown `provider` value is
an error rather than a silent fallback to `claude`, so you never get billed for a CLI and model you
did not choose.

Turning `runInNeutralCwd` off runs the CLI inside the repository, which makes `CLAUDE.md` /
`AGENTS.md` / `GEMINI.md` / `.claude` hooks apply. It is on by default because those instructions can
spawn subagents and make generation dramatically slower.

### Language

The UI follows your VS Code display language: English by default, Japanese when VS Code is in
Japanese.

The commit message language is separate, and controlled by `cliCommitMsg.language`. The extension
always appends that instruction to the prompt, so you can switch output language without rewriting
`instructions` — and it keeps working even if you replace `promptTemplate` entirely.

## How each CLI is invoked

The diff always goes in through stdin. Only the arguments and where the body is read from differ.

| provider | Command | Where the body comes from |
| --- | --- | --- |
| `claude` | `claude -p [--model M] <prompt>` | stdout |
| `codex` | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never [--model M] --output-last-message <file> <prompt>` | a temporary file |
| `gemini` | `gemini --skip-trust [-m M] -p <prompt>` | stdout |

`codex exec` prints a summary of its environment, the whole prompt it received and a token count to
stdout. That echo contains the literal `<commit_message>` text, so reading stdout would mistake the
echoed tag for the real body. That is why Codex alone reads from `--output-last-message`.

`--sandbox read-only` (Codex) is there because generating a commit message never needs to write
files. `--skip-git-repo-check` (Codex) and `--skip-trust` (Gemini) are always passed so the CLI still
runs inside a temporary directory.

## How the output is extracted

Every CLI is asked to wrap the body in a `<commit_message>` tag, and the extension inserts only what
is inside the tag. That instruction is appended by the extension itself, separately from
`promptTemplate`, so rewriting the template cannot drop it.

Back when the only defence was telling the model "do not add a preamble", a model that ignored it
produced a message that went into the input box — and got committed — together with a preamble like
"Here is the commit message you asked for:" and a trailing review of its own work.

When no tag can be found the whole output is written anyway, with a warning. Showing you the content
beats throwing it away, but you are always told that it could not be verified. Check the input box
for stray text when that warning appears.

Keeping the two "Output format" lines in `promptTemplate` makes results more stable.

## Log

The `CLI Commit Message` output channel, also reachable via `CLI Commit: Show Log`. It records the
scope, diff stats, elapsed time and errors.

## Build and install

No npm, no vsce. A `.vsix` is just a ZIP, so the Python standard library is enough.

```sh
python3 build-vsix.py
code --install-extension cli-commit-message-0.2.0.vsix --force
```

Then run `Developer: Reload Window` in VS Code.

Run the same two commands again after changing the code. Bump `version` in `package.json` when
behaviour does not seem to change — VS Code can hold on to a cached copy otherwise.

If you use VS Code profiles, extensions are enabled per profile. Install into the profile you
actually use (`code --profile <name> --install-extension ...`) and confirm in the Extensions view.

## Tests

No dependencies. It runs on the Node standard test runner (and is excluded from the `.vsix`).

```sh
npm test          # = node --test test/*.test.js
```

The `vscode` module is stubbed in the tests, so VS Code does not need to be running.

## File layout

| File | Role |
| --- | --- |
| `package.json` | Manifest: commands / menus / configuration schema |
| `extension.js` | Implementation. Plain CommonJS, no dependencies |
| `package.nls.json` / `package.nls.ja.json` | Settings UI strings (English default, Japanese override) |
| `l10n/bundle.l10n.ja.json` | Runtime message translations |
| `build-vsix.py` | The `.vsix` packager |
| `icon.png` | Extension icon (256x256 PNG) |
| `test/support.js` | Test harness that loads `extension.js` with a `vscode` stub |
| `test/parse.test.js` | Output extraction and prompt assembly |
| `test/providers.test.js` | Per-CLI argument assembly and provider resolution |
| `test/l10n.test.js` | Localisation resources stay in sync |

## Limitations

- The button lives in the title bar, not inside the input box. `scm/inputBox` is a proposed API
  (`contribSourceControlInputBoxMenu`) that Copilot could use because it ships with VS Code. To put
  it there, add `"enable-proposed-api": ["takato.cli-commit-message"]` to `~/.vscode/argv.json` and
  fully restart VS Code.
- Every run consumes quota on the CLI you selected. Larger diffs cost more, so narrowing them with
  `git add` helps.

## License

MIT

---

# CLI Commit Message (日本語)

手元にある CLI エージェントでコミットメッセージを生成し、ソース管理の入力欄に直接書き込む
VS Code 拡張。**Claude Code** / **OpenAI Codex** / **Gemini CLI** から選べる。

Copilot の「Generate Commit Message」(✨) が
[microsoft/vscode#316204](https://github.com/microsoft/vscode/issues/316204)
の `promptFiltered` (422) で使えなくなったための代替。上流は未修正・回避策なし。

## 前提

- 使う CLI がインストール済みで、**ログインまで済んでいる**こと
  （`claude` / `codex` / `gemini`。`command -v <名前>` で確認）
- macOS / Linux（`git diff --no-index -- /dev/null <file>` を使うため）

拡張は API キーを持たない。認証は各 CLI に任せているので、先に一度ターミナルで動かして
ログイン状態を作っておく。

### Gemini を使う場合の注意

2026-08 時点で、Google アカウントの OAuth（Gemini Code Assist 個人無料枠）では `gemini` CLI が
`IneligibleTierError: This client is no longer supported` を返す。使うには `GEMINI_API_KEY` を
環境変数に置く（AI Studio のキー）。

VS Code を Dock から起動するとシェルの設定が読まれず、環境変数が拡張ホストに届かないことがある。
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
| `cliCommitMsg.language` | `English` | 生成するメッセージの言語 |
| `cliCommitMsg.model` | `sonnet` | Claude 用。`haiku` / `sonnet` / `opus` |
| `cliCommitMsg.codexModel` | 空 | Codex 用。空なら CLI の既定モデル |
| `cliCommitMsg.geminiModel` | 空 | Gemini 用。空なら CLI の既定モデル |
| `cliCommitMsg.instructions` | Conventional Commits | メッセージの規約。1 項目 1 行 |
| `cliCommitMsg.promptTemplate` | 下記参照 | プロンプト全文。`${instructions}` が置換される |
| `cliCommitMsg.diffScope` | `stagedOrAll` | `stagedOnly` にすると常にステージ済みのみ |
| `cliCommitMsg.includeUntracked` | `true` | 未追跡ファイルの内容も渡す |
| `cliCommitMsg.maxDiffBytes` | `400000` | 超過分は末尾を切り捨て。`0` で無制限 |
| `cliCommitMsg.onExistingMessage` | `replace` | `append` / `keep` も選べる |
| `cliCommitMsg.claudePath` | `claude` | `command not found` なら絶対パスを指定 |
| `cliCommitMsg.codexPath` | `codex` | 同上 |
| `cliCommitMsg.geminiPath` | `gemini` | 同上 |
| `cliCommitMsg.runInNeutralCwd` | `true` | 一時ディレクトリで CLI を実行する |

モデル設定とパス設定は、選んだ `provider` に対応するものだけが使われる。`provider` に未知の値を
入れた場合は `claude` に落とさずエラーにする（選んだつもりのない CLI とモデルで課金が走らない
ようにするため）。

`runInNeutralCwd` を切るとリポジトリ直下で CLI が動き、`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` /
`.claude` のフックが効く。プロジェクトの指示によってはサブエージェントが起動して大幅に遅くなる
ため、既定でオンにしている（＝一時ディレクトリで実行）。

### 言語

設定画面の表示は VS Code の表示言語に追従する（既定は英語、VS Code が日本語なら日本語）。

コミットメッセージの言語はそれとは別で、`cliCommitMsg.language` で決まる。この指示は拡張が
プロンプトへ必ず足すので、`instructions` を書き換えずに出力言語を切り替えられる。
`promptTemplate` を丸ごと差し替えても外れない。

## CLI ごとの違い

差分は常に標準入力で渡す。違うのは引数と、本文をどこから読むかだけ。

| provider | 実行するコマンド | 本文の取り出し |
| --- | --- | --- |
| `claude` | `claude -p [--model M] <prompt>` | 標準出力 |
| `codex` | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never [--model M] --output-last-message <file> <prompt>` | 一時ファイル |
| `gemini` | `gemini --skip-trust [-m M] -p <prompt>` | 標準出力 |

`codex exec` は実行環境の要約・受け取ったプロンプト全文・トークン数まで標準出力に出す。その
エコーには `<commit_message>` の字面も含まれるため、標準出力を読むとエコー側のタグを本文と
誤認する。だから Codex だけ `--output-last-message` のファイルから読む。

`--sandbox read-only`（Codex）は、コミットメッセージ生成にファイル変更が要らないため。
`--skip-git-repo-check`（Codex）と `--skip-trust`（Gemini）は、一時ディレクトリでも止まらずに
動かすために常に付ける。

## 出力の取り出し方

どの CLI にも本体を `<commit_message>` タグで囲んで返すよう指示し、拡張はタグの中身だけを入力欄に
入れる。この指示は `promptTemplate` とは別に拡張が必ず末尾へ足すので、テンプレートを書き換えても
外れない。

「前置きを付けるな」という指示だけに頼っていた頃は、モデルがそれを破ると「コミットメッセージが
生成されました。以下がご要望に沿った形式です：」のような前置きと末尾の講評ごと入力欄に入り、
そのままコミットされることがあった。

タグが取れなかった場合は出力全体を書き込んだうえで警告を出す。生成物を捨てるより中身を見せた
ほうが早いが、検証できていないことは必ず知らせる。警告が出たときは入力欄に余計な文章が
混ざっていないか確認する。

`promptTemplate` の「出力形式」の 2 行も保険として残しておくと安定する。

## ログ

出力パネルの `CLI Commit Message`。コマンドパレットの `CLI Commit: ログを表示` でも開く。
対象範囲・差分の統計・所要時間・エラーが出る。

## ビルドとインストール

npm も vsce も使わない。`.vsix` は ZIP なので Python の標準ライブラリで作る。

```sh
python3 build-vsix.py
code --install-extension cli-commit-message-0.2.0.vsix --force
```

インストール後は VS Code で `Developer: Reload Window`。

コードを直したら同じ 2 コマンドを流し直す。`package.json` の `version` を上げないと VS Code が
キャッシュを掴んだままになることがあるので、挙動が変わらないときは上げる。

VS Code のプロファイルを使っている場合、拡張はプロファイルごとに有効・無効が分かれる。実際に
使っているプロファイルへ入れ（`code --profile <名前> --install-extension ...`）、拡張ビューで
有効になっているか確認する。

## テスト

依存パッケージなし。Node 標準のテストランナーで動く（`.vsix` には入らない）。

```sh
npm test          # = node --test test/*.test.js
```

`vscode` モジュールはテスト側でスタブしているので、VS Code を起動せずに走る。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `package.json` | マニフェスト。コマンド / メニュー / 設定スキーマ |
| `extension.js` | 実装。素の CommonJS、依存なし |
| `package.nls.json` / `package.nls.ja.json` | 設定画面の文言（英語が既定、日本語で差し替え） |
| `l10n/bundle.l10n.ja.json` | 実行時メッセージの訳 |
| `build-vsix.py` | `.vsix` パッケージャ |
| `icon.png` | 拡張ビューに出すアイコン（256x256 PNG） |
| `test/support.js` | テストから `extension.js` を読むための足場（`vscode` スタブ） |
| `test/parse.test.js` | 出力の取り出しとプロンプト組み立て |
| `test/providers.test.js` | CLI ごとの引数組み立てとプロバイダ解決 |
| `test/l10n.test.js` | ローカライズ資源の整合 |

## 制限

- ボタンは入力欄の中ではなくタイトルバーに出る。入力欄内 (`scm/inputBox`) は proposed API
  (`contribSourceControlInputBoxMenu`) で、Copilot が組み込み拡張だから使えていた。同じ位置に
  出すには `~/.vscode/argv.json` に `"enable-proposed-api": ["takato.cli-commit-message"]` を
  足して VS Code を完全再起動する
- 実行のたびに選んだ CLI の利用枠を消費する。差分が大きいほど増えるので `git add` で絞ると有利

## ライセンス

MIT
