# Stop only this project's isolated test profiles and their descendants.
$ErrorActionPreference = 'Stop'
$corpusRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.cache/corpus-audit'))
$processes = Get-CimInstance Win32_Process
foreach ($version in @('9','10')) {
    $profilePath = Join-Path $corpusRoot "zotero$version/profile"
    $profilePath = [IO.Path]::GetFullPath($profilePath)
    if (-not $profilePath.StartsWith($corpusRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test profile' }
    $ids = [Collections.Generic.HashSet[int]]::new()
    foreach ($p in $processes) {
        if ($p.Name -eq 'zotero.exe' -and $p.CommandLine -and $p.CommandLine.Contains($profilePath)) { [void]$ids.Add([int]$p.ProcessId) }
    }
    do {
        $changed = $false
        foreach ($p in $processes) {
            if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $changed=$true }
        }
    } while ($changed)
    foreach ($processId in $ids) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    foreach ($processId in $ids) { Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue }
}
