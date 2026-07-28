param(
    [string]$NewVersion = $(Get-Date -Format "yyyyMMdd")
)

$targetDir = "$PSScriptRoot\wwwroot"
Write-Host "Updating frontend cache-busting version to: $NewVersion" -ForegroundColor Cyan
Write-Host "Target Directory: $targetDir"

$count = 0
Get-ChildItem -Path $targetDir -Recurse -Include *.html, *.js | ForEach-Object {
    $content = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
    $modified = $false

    # 1. Replace ?v=xxxx
    $newContent = [regex]::Replace($content, '\?v=([a-zA-Z0-9_]+)', "?v=$NewVersion")
    if ($content -ne $newContent) {
        $content = $newContent
        $modified = $true
    }

    # 2. Replace window.__APP_VER__ = 'xxxx'
    $newContent = [regex]::Replace($content, '__APP_VER__\s*=\s*[''"]([a-zA-Z0-9_]+)[''"]', "__APP_VER__ = '$NewVersion'")
    if ($content -ne $newContent) {
        $content = $newContent
        $modified = $true
    }

    if ($modified) {
        [System.IO.File]::WriteAllText($_.FullName, $content, [System.Text.Encoding]::UTF8)
        Write-Host "Updated: $($_.Name)" -ForegroundColor Green
        $count++
    }
}

Write-Host "Done! Updated $count files." -ForegroundColor Yellow
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
