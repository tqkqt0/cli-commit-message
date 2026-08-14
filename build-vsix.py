#!/usr/bin/env python3
"""package.json / extension.js から .vsix を組み立てる。

.vsix の実体は決まった構成の ZIP なので、npm / vsce / Node を一切使わず
標準ライブラリだけでパッケージできる。TypeScript のコンパイルもバンドルも発生しない。

使い方:
    python3 build-vsix.py
    code --install-extension cli-commit-message-<version>.vsix --force
"""

import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent

# .vsix に入れるファイル。(ZIP 内のパス, 実ファイル, 必須か)
PAYLOAD = [
    ("extension/package.json", ROOT / "package.json", True),
    ("extension/extension.js", ROOT / "extension.js", True),
    ("extension/README.md", ROOT / "README.md", False),
    # package.json の "icon" が指すファイル。同梱し忘れると拡張ビューでアイコンが出ない
    ("extension/icon.png", ROOT / "icon.png", True),
    # 配布物にライセンス本文を含める (package.json の "license": "MIT" に対応)
    ("extension/LICENSE", ROOT / "LICENSE", True),
    # 設定画面の文言。package.json の %key% を VS Code がこれで解決する
    # (既定は英語、表示言語が日本語なら .ja が優先される)
    ("extension/package.nls.json", ROOT / "package.nls.json", True),
    ("extension/package.nls.ja.json", ROOT / "package.nls.ja.json", True),
    # 実行時メッセージ。package.json の "l10n": "./l10n" に対応する
    ("extension/l10n/bundle.l10n.ja.json", ROOT / "l10n" / "bundle.l10n.ja.json", True),
]

CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".xml" ContentType="text/xml" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
"""

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0"
    xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"
    xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{publisher}" />
    <DisplayName>{display_name}</DisplayName>
    <Description xml:space="preserve">{description}</Description>
    <Tags>git,scm,commit,commit message,ai,claude,codex,gemini,cli</Tags>
    <Categories>SCM Providers,AI</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{engine}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace,ui" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
"""


def escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def main() -> int:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

    missing = [key for key in ("name", "version", "publisher") if not pkg.get(key)]
    if missing:
        print(f"package.json に必須フィールドがありません: {', '.join(missing)}", file=sys.stderr)
        return 1

    manifest = MANIFEST.format(
        name=escape(pkg["name"]),
        version=escape(pkg["version"]),
        publisher=escape(pkg["publisher"]),
        display_name=escape(pkg.get("displayName", pkg["name"])),
        description=escape(pkg.get("description", "")),
        engine=escape((pkg.get("engines") or {}).get("vscode", "^1.90.0")),
    )

    out = ROOT / f"{pkg['name']}-{pkg['version']}.vsix"
    written = []

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as vsix:
        vsix.writestr("extension.vsixmanifest", manifest)
        vsix.writestr("[Content_Types].xml", CONTENT_TYPES)
        for arcname, path, required in PAYLOAD:
            if not path.exists():
                if required:
                    print(f"必須ファイルがありません: {path}", file=sys.stderr)
                    return 1
                continue
            vsix.write(path, arcname)
            written.append(arcname)

    print(f"作成: {out}")
    print(f"  {pkg['publisher']}.{pkg['name']} v{pkg['version']}")
    for arcname in written:
        print(f"  + {arcname}")
    print()
    print("インストール:")
    print(f"  code --install-extension {out} --force")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
