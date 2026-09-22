$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot "packages\browser-extension"
$addonRoot = Join-Path $projectRoot "packages\zotero-addon"
$distributionRoot = Join-Path $projectRoot "dist"
$extensionVersion = (Get-Content -LiteralPath (Join-Path $extensionRoot "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$addonVersion = (Get-Content -LiteralPath (Join-Path $addonRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$releaseStage = Join-Path $temporaryBase ("paper-bridge-release-" + [guid]::NewGuid().ToString("N"))

if (-not ([System.IO.Path]::GetFullPath($releaseStage).StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase))) {
  throw "Release staging path is outside the system temporary directory"
}

Push-Location $projectRoot
try {
  npm run check:extension
  if ($LASTEXITCODE -ne 0) { throw "Extension checks failed" }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "Regression tests failed" }
  npm run build:zotero
  if ($LASTEXITCODE -ne 0) { throw "Zotero build failed" }

  New-Item -ItemType Directory -Path $distributionRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $releaseStage -Force | Out-Null

  $chromeStage = Join-Path $releaseStage "paper-bridge-chrome"
  New-Item -ItemType Directory -Path $chromeStage -Force | Out-Null
  Copy-Item -Path (Join-Path $extensionRoot "*") -Destination $chromeStage -Recurse -Force

  $chromeArchive = Join-Path $distributionRoot "translate-bridge-chrome-$extensionVersion.zip"
  Compress-Archive -Path (Join-Path $chromeStage "*") -DestinationPath $chromeArchive -CompressionLevel Optimal -Force

  $addonSource = Join-Path $addonRoot ".scaffold\build\translate-bridge-for-zotero.xpi"
  $addonArtifact = Join-Path $distributionRoot "translate-bridge-zotero-$addonVersion.xpi"
  Copy-Item -LiteralPath $addonSource -Destination $addonArtifact -Force

  $bundleStage = Join-Path $releaseStage "paper-bridge"
  New-Item -ItemType Directory -Path $bundleStage -Force | Out-Null
  $bundleChrome = Join-Path $bundleStage "Translate-Bridge-Chrome-$extensionVersion"
  New-Item -ItemType Directory -Path $bundleChrome -Force | Out-Null
  Copy-Item -Path (Join-Path $extensionRoot "*") -Destination $bundleChrome -Recurse -Force
  Copy-Item -LiteralPath $addonArtifact -Destination (Join-Path $bundleStage "Translate-Bridge-Zotero-$addonVersion.xpi") -Force
  $installationGuide = Get-ChildItem -LiteralPath (Join-Path $projectRoot "docs") -Filter "*.html" | Select-Object -First 1
  if (-not $installationGuide) {
    throw "Installation guide was not found"
  }
  Copy-Item -LiteralPath $installationGuide.FullName -Destination (Join-Path $bundleStage "START-HERE.html") -Force
  $manual = Join-Path $projectRoot "docs\用户手册.md"
  Copy-Item -LiteralPath $manual -Destination (Join-Path $bundleStage "USER-MANUAL.md") -Force

  $bundleArchive = Join-Path $distributionRoot "translate-bridge-for-zotero-$extensionVersion.zip"
  Compress-Archive -Path (Join-Path $bundleStage "*") -DestinationPath $bundleArchive -CompressionLevel Optimal -Force

  Get-Item -LiteralPath $chromeArchive, $addonArtifact, $bundleArchive |
    Select-Object Name, Length, LastWriteTime
}
finally {
  Pop-Location
  if (Test-Path -LiteralPath $releaseStage) {
    $resolvedStage = [System.IO.Path]::GetFullPath($releaseStage)
    if ($resolvedStage.StartsWith($temporaryBase, [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
  }
}
