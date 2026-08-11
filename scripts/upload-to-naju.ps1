# NOTE: keep this file saved as UTF-8 *with BOM*. Windows PowerShell 5.1 reads
# BOM-less .ps1 files as ANSI, which mangles the Korean strings below badly
# enough to break quote pairing and fail to parse. Re-add the BOM after editing.
#
# 나주 대시보드 데이터 자동 업로드
#
# 지정한 폴더에서 각 패턴에 맞는 "가장 최근" 엑셀을 찾아 /api/ingest 로 보낸다.
# 파일명에 _V20, _Ver26 처럼 버전이 붙고 갱신될 때마다 올라가므로, 고정 경로가
# 아니라 패턴으로 찾아 수정일이 가장 최근인 것을 고른다.
#
# 사용법:
#   .\upload-to-naju.ps1              실제 전송
#   .\upload-to-naju.ps1 -DryRun      어떤 파일이 잡히는지만 확인 (전송 안 함)
#
# 토큰은 이 스크립트 옆의 token.txt 에서 읽는다. 환경변수
# NAJU_INGEST_TOKEN 이 있으면 그쪽을 우선한다.

[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# ---- 설정 ---------------------------------------------------------------
$Endpoint = "https://naju.kbmtt.com/api/ingest"

# Folder 는 파일이 실제로 있는 폴더 (UNC 경로 가능: \\서버\공유\...). Pattern 은
# 와일드카드도 되고 정확한 파일명도 된다. 버전이 올라가는 파일은 _V* 로 두어
# 최신 것을 잡는다. 어느 쪽이든 맞는 파일이 없으면 그 항목만 실패로 남고
# 나머지는 정상 전송된다.
$Sources = @(
    @{ Label = "코팅현황"
       Folder  = "\\10.10.10.251\나주공장 공용폴더\발열체\코팅작업검사현황"
       Pattern = "히터코일검사현황_Ver*.xlsx" }
    @{ Label = "생산계획 대비 실적"
       Folder  = "\\10.10.10.251\나주공장\3.생산관리\생산관리 보고파일"
       Pattern = "생산계획대비 실적_V*.xlsx" }
    @{ Label = "히터코일/메시 출하"
       Folder  = "\\10.10.10.251\나주공장\3.생산관리\생산관리 보고파일"
       Pattern = "히터코일 출하현황_V*.xlsx" }
    @{ Label = "진공증착 생산실적"
       Folder  = "\\10.10.10.251\나주공장\3.생산관리\생산관리 보고파일"
       Pattern = "VM 월별 생산실적 보고_V*.xlsx" }
    @{ Label = "커넥터 품질실적"
       Folder  = "\\10.10.10.251\나주공장\4.품질\품질보증\품질실적"
       Pattern = "커넥터 품질실적 대시보드_V*.xlsx" }
)
# -------------------------------------------------------------------------

$LogPath = Join-Path $PSScriptRoot "upload-to-naju.log"

function Write-Log {
    param([string]$Message)
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -Encoding utf8
}

function Get-Token {
    if ($env:NAJU_INGEST_TOKEN) { return $env:NAJU_INGEST_TOKEN.Trim() }
    $tokenFile = Join-Path $PSScriptRoot "token.txt"
    if (-not (Test-Path $tokenFile)) {
        throw "토큰이 없습니다. $tokenFile 을 만들거나 NAJU_INGEST_TOKEN 환경변수를 설정하세요."
    }
    $t = (Get-Content $tokenFile -Raw).Trim()
    if (-not $t) { throw "$tokenFile 이 비어 있습니다." }
    return $t
}

# 패턴에 맞는 파일 중 가장 최근 것. Excel 잠금 파일(~$...)은 패턴이 이름
# 처음부터 맞아야 해서 애초에 걸리지 않는다.
function Find-Latest {
    param([string]$Folder, [string]$Pattern)
    Get-ChildItem -Path $Folder -Filter $Pattern -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Send-File {
    param([System.IO.FileInfo]$File, [string]$Token)

    $curlArgs = @(
        "--silent", "--show-error", "--max-time", "180",
        "--write-out", "`n%{http_code}",
        "--request", "POST", $Endpoint,
        "--header", "Authorization: Bearer $Token",
        "--form", "file=@$($File.FullName)"
    )

    $output = & curl.exe @curlArgs 2>&1
    $exit = $LASTEXITCODE
    $text = ($output | Out-String).Trim()

    # 정상이면 마지막 줄이 --write-out 으로 붙인 상태코드다. curl 자체가
    # 실패하면 그 줄이 없으니, 오류 메시지를 상태코드로 오인하지 않게 나눈다.
    $lines = $text -split "`r?`n"
    if ($lines.Count -ge 2) {
        $status = $lines[-1].Trim()
        $body = ($lines[0..($lines.Count - 2)] -join " ").Trim()
    } else {
        $status = ""
        $body = $text
    }

    return [pscustomobject]@{
        CurlExit = $exit
        Status   = $status
        Body     = $body
    }
}

# ---- 실행 ---------------------------------------------------------------
Write-Log "=== 시작 ($(if ($DryRun) { 'DryRun' } else { '실전송' })) ==="

# 폴더별로 한 번만 확인한다 (같은 폴더를 쓰는 항목이 여러 개라도 중복 검사 안 함).
foreach ($folder in ($Sources.Folder | Select-Object -Unique)) {
    if (-not (Test-Path $folder)) {
        Write-Log "[경고] 폴더에 접근할 수 없습니다: $folder (네트워크 연결/권한 확인 필요)"
    }
}

$token = $null
if (-not $DryRun) { $token = Get-Token }

$failed = 0

foreach ($src in $Sources) {
    $file = Find-Latest -Folder $src.Folder -Pattern $src.Pattern

    if (-not $file) {
        Write-Log "[실패] $($src.Label): '$($src.Pattern)' 에 맞는 파일이 없습니다."
        $failed++
        continue
    }

    $sizeKb = [Math]::Round($file.Length / 1KB)
    $stamp = $file.LastWriteTime.ToString("yyyy-MM-dd HH:mm")

    if ($DryRun) {
        Write-Log "[확인] $($src.Label): $($file.Name)  (${sizeKb}KB, 수정 $stamp)"
        continue
    }

    # 네트워크 문제나 서버 오류는 잠깐 뒤 다시 해볼 만하다. 4xx 는 파일이나
    # 설정이 잘못된 것이라 재시도해도 같은 결과라서 바로 넘어간다.
    $attempt = 0
    while ($true) {
        $attempt++
        $r = Send-File -File $file -Token $token

        if ($r.CurlExit -eq 0 -and $r.Status -eq "200") {
            Write-Log "[성공] $($src.Label): $($file.Name) -> $($r.Body)"
            break
        }

        $retryable = ($r.CurlExit -ne 0) -or ($r.Status -match '^5')
        if ($retryable -and $attempt -lt 3) {
            Write-Log "[재시도 $attempt] $($src.Label): HTTP $($r.Status) $($r.Body)"
            Start-Sleep -Seconds 20
            continue
        }

        Write-Log "[실패] $($src.Label): $($file.Name) HTTP $($r.Status) (curl $($r.CurlExit)) $($r.Body)"
        $failed++
        break
    }
}

# 로그가 무한정 자라지 않게 최근 500줄만 남긴다.
if (Test-Path $LogPath) {
    $all = Get-Content $LogPath
    if ($all.Count -gt 500) {
        $all | Select-Object -Last 500 | Set-Content $LogPath -Encoding utf8
    }
}

Write-Log "=== 종료 (실패 $failed 건) ==="
exit $(if ($failed -gt 0) { 1 } else { 0 })
