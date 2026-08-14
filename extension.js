'use strict';

// Copilot の「Generate Commit Message」(✨) が promptFiltered で使えなくなったため
// (microsoft/vscode#316204)、手元の CLI エージェント (Claude Code / OpenAI Codex /
// Gemini CLI) で同じことをする最小の拡張。
// ビルド不要。素の CommonJS のまま VS Code の拡張ホストで動く。

const vscode = require('vscode');
const cp = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const SECTION = 'cliCommitMsg';
const CTX_GENERATING = 'cliCommitMsg.generating';

// CLI にコミットメッセージ本体を囲ませるタグ。
//
// なぜ必要か: プロンプトで「前置き・後書きを付けるな」と書いても守る保証はない。
// 実際 2026-08-14 に「コミットメッセージが生成されました。以下がご要望に沿った
// 形式です：」という前置きと、末尾の講評ごと入力欄に入り、そのままコミットされた
// (7f8bf09ba)。本体の境界を機械的に判定できるようにして、指示違反があっても
// 本文だけを拾えるようにする。
const TAG_OPEN = '<commit_message>';
const TAG_CLOSE = '</commit_message>';

/**
 * buildPrompt() が promptTemplate の後ろへ必ず足す約束事。
 *
 * 設定ではなくコードに置くのは、ユーザーが promptTemplate を書き換えても
 * 言語指定とタグの約束だけは外れないようにするため。ここは LLM へ渡す文面なので
 * 表示言語 (l10n) ではなく常に英語で書き、生成物の言語だけを language で指定する。
 */
function outputContract(language) {
  return [
    '',
    `Write the commit message in ${language}.`,
    '',
    'Output contract:',
    `- Wrap the commit message body in ${TAG_OPEN} and ${TAG_CLOSE}.`,
    '- Write nothing outside the tags: no explanation, no preamble, no postscript.',
  ].join('\n');
}

// 対応する CLI エージェント。引数と出力の取り出し方だけが違うので、差分をここに閉じ込める。
// 各 CLI の仕様は 2026-08-14 に実機 (claude 2.1.232 / codex 0.147.0 / gemini 0.55.1) で確認した。
const PROVIDERS = {
  claude: {
    label: 'Claude Code',
    pathSetting: 'claudePath',
    fallbackBin: 'claude',
    modelSetting: 'model',
    // claude -p [--model <m>] <prompt>。差分は stdin、本文は stdout にそのまま出る。
    buildArgs: ({ model, prompt }) => ['-p', ...(model ? ['--model', model] : []), prompt],
  },
  codex: {
    label: 'OpenAI Codex',
    pathSetting: 'codexPath',
    fallbackBin: 'codex',
    modelSetting: 'codexModel',
    // codex exec は実行環境の要約・受け取ったプロンプト全文・トークン数まで stdout に出す。
    // プロンプトのエコーには <commit_message> の字面も含まれるので、stdout を読むと
    // エコー側のタグを本文と誤認する。本文は --output-last-message のファイルから取る。
    usesLastMessageFile: true,
    buildArgs: ({ model, prompt, lastMessageFile }) => [
      'exec',
      '--skip-git-repo-check', // 一時ディレクトリ (runInNeutralCwd) で動かすため
      '--sandbox',
      'read-only', // コミットメッセージ生成に書き込みは要らない
      '--ephemeral', // セッションファイルを残さない
      '--color',
      'never',
      ...(model ? ['--model', model] : []),
      '--output-last-message',
      lastMessageFile,
      prompt,
    ],
  },
  gemini: {
    label: 'Gemini CLI',
    pathSetting: 'geminiPath',
    fallbackBin: 'gemini',
    modelSetting: 'geminiModel',
    // -p が非対話モード。stdin に流した差分の後ろにプロンプトが連結される。
    // --skip-trust が無いと headless では「信頼されていないディレクトリ」で止まる。
    buildArgs: ({ model, prompt }) => [
      '--skip-trust',
      ...(model ? ['-m', model] : []),
      '-p',
      prompt,
    ],
  },
};

/** @type {vscode.OutputChannel} */
let log;

/** 実行中の CLI プロセス。同時実行と中止の判定に使う。 */
const state = { child: null, aborted: false };

function config() {
  return vscode.workspace.getConfiguration(SECTION);
}

function trace(message) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  log.appendLine(`[${stamp}] ${message}`);
}

/**
 * git を実行する。git は「差分あり」を終了コード 1 で表すことがあるため、
 * 例外にせず {code, stdout, stderr} をそのまま返して呼び出し側に判断させる。
 */
function git(cwd, args) {
  return new Promise((resolve) => {
    cp.execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      }
    );
  });
}

/**
 * 対象リポジトリを決める。
 * scm/title のコマンドには SourceControl 相当が渡るので rootUri で突き合わせ、
 * 特定できなければアクティブエディタ → QuickPick と段階的に落とす。
 */
async function resolveRepository(arg) {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) {
    throw new Error(vscode.l10n.t('The built-in Git extension (vscode.git) was not found.'));
  }
  const exported = ext.isActive ? ext.exports : await ext.activate();
  const api = exported.getAPI(1);
  const repos = api.repositories || [];

  if (repos.length === 0) {
    throw new Error(vscode.l10n.t('No Git repository is open.'));
  }

  const wanted = arg && arg.rootUri ? arg.rootUri.fsPath : null;
  if (wanted) {
    const hit = repos.find((r) => r.rootUri.fsPath === wanted);
    if (hit) return hit;
  }

  if (repos.length === 1) return repos[0];

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const path = editor.document.uri.fsPath;
    const hit = repos
      .filter((r) => path.startsWith(r.rootUri.fsPath))
      .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
    if (hit) return hit;
  }

  const picked = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: r.rootUri.fsPath, repo: r })),
    { placeHolder: vscode.l10n.t('Repository to generate a commit message for') }
  );
  return picked ? picked.repo : null;
}

/**
 * CLI に渡す差分テキストを組み立てる。
 * 返り値の scope / untracked / truncated は進捗表示とログ用。
 */
async function collectDiff(root) {
  const cfg = config();
  const stagedOnly = cfg.get('diffScope') === 'stagedOnly';

  // --quiet は差分があると終了コード 1 を返す
  const probe = await git(root, ['diff', '--cached', '--quiet']);
  const hasStaged = probe.code !== 0;

  if (stagedOnly && !hasStaged) {
    throw new Error(vscode.l10n.t('Nothing is staged. Stage your changes first.'));
  }

  const cachedArg = hasStaged ? ['--cached'] : [];

  const diff = await git(root, ['diff', ...cachedArg]);
  let text = diff.stdout;
  let untracked = 0;

  // git diff は未追跡ファイルを出さないので、必要なら明示的に足す。
  // ステージ済みを対象にしている場合、未追跡はそのコミットに含まれないので触らない。
  if (!hasStaged && cfg.get('includeUntracked')) {
    const listed = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    const files = listed.stdout.split('\0').filter(Boolean);
    for (const file of files) {
      untracked += 1;
      const added = await git(root, ['diff', '--no-index', '--', '/dev/null', file]);
      // バイナリの場合 git は "Binary files differ" だけを返すので、これで両方さばける
      if (added.stdout) {
        text += `\n${added.stdout}`;
      } else {
        text += `\n# New file (contents unavailable): ${file}\n`;
      }
    }
  }

  if (!text.trim()) {
    throw new Error(vscode.l10n.t('There are no changes.'));
  }

  const max = Number(cfg.get('maxDiffBytes')) || 0;
  let truncated = false;
  if (max > 0 && Buffer.byteLength(text, 'utf8') > max) {
    text =
      Buffer.from(text, 'utf8').subarray(0, max).toString('utf8') +
      '\n\n[... diff truncated because it is too long ...]\n';
    truncated = true;
  }

  const stat = await git(root, ['diff', ...cachedArg, '--shortstat']);

  return {
    text,
    untracked,
    truncated,
    scope: hasStaged
      ? vscode.l10n.t('staged changes')
      : vscode.l10n.t('all changes including unstaged'),
    shortstat: stat.stdout.trim(),
  };
}

function buildPrompt() {
  const cfg = config();
  const instructions = (cfg.get('instructions') || [])
    .map((line) => `- ${line}`)
    .join('\n');
  const template = (cfg.get('promptTemplate') || []).join('\n');
  const language = String(cfg.get('language') || '').trim() || 'English';
  return template.split('${instructions}').join(instructions) + '\n' + outputContract(language);
}

/** 拡張ホストの PATH は Dock 起動時に痩せていることがあるので補う。 */
function buildEnv() {
  const env = Object.assign({}, process.env);
  const extra = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${os.homedir()}/.local/bin`,
    '/usr/bin',
    '/bin',
  ];
  const current = (env.PATH || '').split(':').filter(Boolean);
  env.PATH = Array.from(new Set(current.concat(extra))).join(':');
  return env;
}

/**
 * 設定から使う CLI を決める。
 *
 * 未知の値は落とす。黙って claude に落とすと、選んだつもりのない CLI とモデルで
 * 課金が走るため。
 */
function resolveProvider() {
  const name = String(config().get('provider') || 'claude').trim();
  const spec = PROVIDERS[name];
  if (!spec) {
    throw new Error(
      vscode.l10n.t('Unknown provider: {0} (valid values: {1})', name, Object.keys(PROVIDERS).join(' / '))
    );
  }
  return { name, spec };
}

/** CLI を起動し、差分を stdin に流して stdout を返す。 */
function spawnCli(bin, args, cwd, input, label) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = cp.spawn(bin, args, { cwd, env: buildEnv() });
    } catch (e) {
      reject(new Error(vscode.l10n.t('Cannot start {0}: {1}', bin, e.message)));
      return;
    }

    state.child = child;
    state.aborted = false;

    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });

    child.on('error', (e) => {
      state.child = null;
      reject(new Error(vscode.l10n.t('Cannot run {0}: {1}', bin, e.message)));
    });

    child.on('close', (code) => {
      state.child = null;
      if (state.aborted) {
        const aborted = new Error(vscode.l10n.t('Cancelled.'));
        aborted.code = 'aborted';
        reject(aborted);
        return;
      }
      if (code !== 0) {
        reject(new Error(vscode.l10n.t('{0} exited abnormally (exit {1})\n{2}', label, String(code), err.trim())));
        return;
      }
      resolve(out);
    });

    // stdin が既に閉じられていても拡張を落とさない
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** 設定されたプロバイダでコミットメッセージを生成し、CLI の生の出力を返す。 */
async function runCli(prompt, diff) {
  const { spec } = resolveProvider();
  const cfg = config();
  const bin = cfg.get(spec.pathSetting) || spec.fallbackBin;
  const model = String(cfg.get(spec.modelSetting) || '').trim();
  const cwd = cfg.get('runInNeutralCwd') ? os.tmpdir() : undefined;

  let dir = null;
  let lastMessageFile;
  if (spec.usesLastMessageFile) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-commit-message-'));
    lastMessageFile = path.join(dir, 'last-message.txt');
  }

  trace(
    vscode.l10n.t(
      'Running {0} ({1} / model={2}, cwd={3})',
      bin,
      spec.label,
      model || vscode.l10n.t('CLI default'),
      cwd || vscode.l10n.t('repository')
    )
  );

  try {
    const args = spec.buildArgs({ model, prompt, lastMessageFile });
    const stdout = await spawnCli(bin, args, cwd, diff, spec.label);

    if (!lastMessageFile) return stdout;
    if (!fs.existsSync(lastMessageFile)) {
      throw new Error(
        vscode.l10n.t('{0} did not write a final message. Check the log for details.', spec.label)
      );
    }
    return fs.readFileSync(lastMessageFile, 'utf8');
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** コードフェンス・行末空白・前後の空行を落とす。 */
function tidy(raw) {
  return String(raw)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*```/.test(line))
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/**
 * CLI の出力からコミットメッセージ本体を取り出す。
 *
 * タグが取れなければ出力全体を返す。生成物を捨てるとユーザーは再実行するしかない
 * ため中身は渡すが、検証できていないことは `clean: false` で呼び出し側へ伝える
 * (黙って入力欄へ入れると、前置き付きのままコミットされる事故に戻る)。
 *
 * @returns {{message: string, clean: boolean}}
 */
function extractMessage(raw) {
  const text = String(raw).replace(/\r\n/g, '\n');

  // 形式の説明として空タグを先に出すモデルがいるので、中身のある最初のものを採る。
  const pairs = /<commit_message>([\s\S]*?)<\/commit_message>/gi;
  let match;
  while ((match = pairs.exec(text)) !== null) {
    const body = tidy(match[1]);
    if (body) return { message: body, clean: true };
  }

  // タグが無い、閉じられていない、中身が空。タグ文字列だけ落として全体を返す。
  return { message: tidy(text.replace(/<\/?commit_message>/gi, '')), clean: false };
}

/** @returns {boolean} 入力欄へ書き込んだか (keep で見送った場合は false) */
function applyToInputBox(repo, message) {
  const mode = config().get('onExistingMessage') || 'replace';
  const existing = (repo.inputBox.value || '').trim();

  if (existing && mode === 'keep') {
    vscode.window.showInformationMessage(
      vscode.l10n.t('The Source Control input box already has text, so the result was not written.')
    );
    trace(vscode.l10n.t('Kept the existing message, nothing written (onExistingMessage=keep)'));
    return false;
  }

  repo.inputBox.value =
    existing && mode === 'append' ? `${existing}\n\n${message}` : message;
  return true;
}

async function generate(arg) {
  if (state.child) {
    vscode.window.showWarningMessage(vscode.l10n.t('A commit message is already being generated.'));
    return;
  }

  let repo;
  try {
    repo = await resolveRepository(arg);
  } catch (e) {
    trace(vscode.l10n.t('Error: {0}', e.message));
    vscode.window.showErrorMessage(e.message);
    return;
  }
  if (!repo) return;

  const root = repo.rootUri.fsPath;
  await vscode.commands.executeCommand('setContext', CTX_GENERATING, true);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.SourceControl,
        title: vscode.l10n.t('Generating commit message…'),
      },
      async () => {
        const diff = await collectDiff(root);
        trace(
          `${root}: ${diff.scope} / ${diff.shortstat || vscode.l10n.t('(no stats)')}` +
            (diff.untracked ? ` / ${vscode.l10n.t('{0} untracked', String(diff.untracked))}` : '') +
            (diff.truncated ? ` / ${vscode.l10n.t('diff truncated')}` : '')
        );

        const started = Date.now();
        const raw = await runCli(buildPrompt(), diff.text);
        const { message, clean } = extractMessage(raw);
        trace(
          vscode.l10n.t('Done ({0}ms, {1} chars)', String(Date.now() - started), String(message.length)) +
            (clean ? '' : ` / ${vscode.l10n.t('no {0}, used the whole output', TAG_OPEN)}`)
        );

        if (!message) {
          throw new Error(vscode.l10n.t('The result was empty. Check the log for details.'));
        }
        const written = applyToInputBox(repo, message);

        // タグを取れなかった＝前置き・後書きが混ざっている可能性がある。
        // そのままコミットされる事故を防ぐため、書き込んだときは必ず知らせる。
        if (written && !clean) {
          vscode.window.showWarningMessage(
            vscode.l10n.t(
              '{0} returned no {1} tag, so the whole output was written as is. Check it for stray preamble or postscript.',
              resolveProvider().spec.label,
              TAG_OPEN
            )
          );
        }
      }
    );
  } catch (e) {
    const text = e && e.message ? e.message : String(e);
    trace(vscode.l10n.t('Error: {0}', text));
    if (e && e.code === 'aborted') {
      vscode.window.setStatusBarMessage(vscode.l10n.t('Commit message generation cancelled.'), 3000);
    } else {
      const OPEN_LOG = vscode.l10n.t('Show Log');
      const choice = await vscode.window.showErrorMessage(text, OPEN_LOG);
      if (choice === OPEN_LOG) log.show(true);
    }
  } finally {
    await vscode.commands.executeCommand('setContext', CTX_GENERATING, false);
  }
}

function abort() {
  if (!state.child) return;
  state.aborted = true;
  state.child.kill('SIGTERM');
  trace(vscode.l10n.t('Cancelled by the user'));
}

function activate(context) {
  log = vscode.window.createOutputChannel('CLI Commit Message');
  context.subscriptions.push(log);
  trace(vscode.l10n.t('Extension activated.'));

  context.subscriptions.push(
    vscode.commands.registerCommand('cliCommitMsg.generate', generate),
    vscode.commands.registerCommand('cliCommitMsg.abort', abort),
    vscode.commands.registerCommand('cliCommitMsg.showLog', () => log.show(true))
  );
}

function deactivate() {
  if (state.child) {
    state.aborted = true;
    state.child.kill('SIGTERM');
  }
}

module.exports = {
  activate,
  deactivate,
  // test/parse.test.js からの参照用。拡張ホストは activate / deactivate しか使わない。
  _internal: { tidy, extractMessage, buildPrompt, resolveProvider, runCli, PROVIDERS },
};
