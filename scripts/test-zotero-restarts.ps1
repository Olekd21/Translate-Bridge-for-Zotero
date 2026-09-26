$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version=(Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$base=Join-Path $repo (".cache/restart-audit-$version"+$env:BRIDGE_RESTART_SUFFIX)
$results=@()
for($round=1;$round -le 4;$round++) {
    foreach($v in @('9','10')) {
        $profile=Join-Path $base "zotero$v/profile"
        if(-not (Test-Path (Join-Path $profile 'extensions/restart-audit@local.research.xpi'))){throw 'Missing isolated probe'}
        $exe=Join-Path $repo ".cache/zotero$v-runtime/Zotero_win-x64/zotero.exe"
        Start-Process -FilePath $exe -ArgumentList @('-ZoteroDebugText','-no-remote','-profile',('"'+$profile+'"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $base "stdout-$v-$round.log") -RedirectStandardError (Join-Path $base "stderr-$v-$round.log") | Out-Null
    }
    $deadline=(Get-Date).AddSeconds(100)
    do {
        Start-Sleep -Milliseconds 500
        $allReady=$true
        foreach($v in @('9','10')) {
            $result=Join-Path $base "zotero$v/result.json.round-$round.json"
            if(-not (Test-Path $result)){$allReady=$false}
        }
    }while(-not $allReady -and (Get-Date) -lt $deadline)
    if(-not $allReady){throw "Round $round timed out"}
    foreach($v in @('9','10')) {
        $r=Get-Content (Join-Path $base "zotero$v/result.json.round-$round.json") -Raw | ConvertFrom-Json
        if(-not $r.ok){throw ($r|ConvertTo-Json -Depth 6)}
        $results+=$r
    }
    # Let each isolated application finish its normal quit before relaunch.
    Start-Sleep -Seconds 2
}
$results | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 (Join-Path $base 'results.json')
$results | Select-Object version,round,ok,@{n='active';e={$_.addon.active}},@{n='temporary';e={$_.addon.temporary}}
