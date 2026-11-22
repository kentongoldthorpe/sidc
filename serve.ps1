<#
.SYNOPSIS
  COA Builder development server: serves this folder on http://localhost:<Port>/ using only PowerShell.

.DESCRIPTION
  For machines that have only PowerShell and a browser. Works with Windows PowerShell 5.1 and
  PowerShell 7+ (Windows, macOS, Linux). Listens on localhost only. Serves files with the MIME
  types browsers require (ES modules need text/javascript), never serves dot-files or anything
  outside the root folder, and sends no-store so edits show up on reload.

.PARAMETER Port
  Port to listen on. Default 8080.

.PARAMETER Root
  Folder to serve. Default: the folder this script is in.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1
  (or double-click serve.cmd)

.EXAMPLE
  pwsh -File ./serve.ps1 -Port 8081
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [string]$Root = $PSScriptRoot
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

function Write-Line([string]$Text) {
  [Console]::Out.WriteLine($Text)
  [Console]::Out.Flush()
}

function Stop-WithError([string]$Text) {
  [Console]::Error.WriteLine("serve.ps1: $Text")
  exit 1
}

if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
  Stop-WithError "root folder not found: $Root"
}
$separators = [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
$rootFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Root).ProviderPath).TrimEnd($separators)

# Keys are case-insensitive in PowerShell hashtables.
$mimeTypes = @{
  '.html'    = 'text/html; charset=utf-8'
  '.htm'     = 'text/html; charset=utf-8'
  '.js'      = 'text/javascript; charset=utf-8'
  '.mjs'     = 'text/javascript; charset=utf-8'
  '.css'     = 'text/css; charset=utf-8'
  '.json'    = 'application/json; charset=utf-8'
  '.map'     = 'application/json; charset=utf-8'
  '.geojson' = 'application/geo+json; charset=utf-8'
  '.csv'     = 'text/csv; charset=utf-8'
  '.txt'     = 'text/plain; charset=utf-8'
  '.md'      = 'text/markdown; charset=utf-8'
  '.svg'     = 'image/svg+xml'
  '.png'     = 'image/png'
  '.jpg'     = 'image/jpeg'
  '.jpeg'    = 'image/jpeg'
  '.gif'     = 'image/gif'
  '.ico'     = 'image/x-icon'
  '.woff2'   = 'font/woff2'
}

# Map a request path to a file under the root, or return a status code.
#   200 + path   the file to serve
#   404          missing, or a dot-file / dot-folder / '..' segment (never served, e.g. .git)
#   403          resolves outside the root (defence in depth; '..' is already refused above)
function Resolve-RequestFile([string]$EncodedPath) {
  $decoded = [System.Uri]::UnescapeDataString($EncodedPath)
  $segments = @($decoded -split '[\\/]' | Where-Object { $_ -ne '' })
  foreach ($segment in $segments) {
    if ($segment.StartsWith('.')) { return @{ Status = 404 } }
  }

  $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($rootFull, ($segments -join [System.IO.Path]::DirectorySeparatorChar)))
  $inside = $full.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or
            $full.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
  if (-not $inside) { return @{ Status = 403 } }

  if (Test-Path -LiteralPath $full -PathType Container) { $full = Join-Path $full 'index.html' }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return @{ Status = 404 } }
  return @{ Status = 200; Path = $full }
}

function Send-Bytes($Response, [int]$Status, [string]$ContentType, [byte[]]$Bytes, [bool]$WithBody) {
  $Response.StatusCode = $Status
  $Response.ContentType = $ContentType
  $Response.Headers['Cache-Control'] = 'no-store'
  $Response.Headers['X-Content-Type-Options'] = 'nosniff'
  $Response.ContentLength64 = $Bytes.Length
  if ($WithBody -and $Bytes.Length -gt 0) { $Response.OutputStream.Write($Bytes, 0, $Bytes.Length) }
}

function Send-Text($Response, [int]$Status, [string]$Text, [bool]$WithBody) {
  Send-Bytes $Response $Status 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($Text)) $WithBody
}

function Invoke-Request($Context) {
  $request = $Context.Request
  $response = $Context.Response
  $method = $request.HttpMethod
  $withBody = $method -ne 'HEAD'

  if ($method -ne 'GET' -and $method -ne 'HEAD') {
    $response.Headers['Allow'] = 'GET, HEAD'
    Send-Text $response 405 'Method not allowed' $true
    return 405
  }

  $resolved = Resolve-RequestFile $request.Url.AbsolutePath
  if ($resolved.Status -ne 200) {
    $message = if ($resolved.Status -eq 403) { 'Forbidden' } else { 'Not found' }
    Send-Text $response $resolved.Status $message $withBody
    return $resolved.Status
  }

  $extension = [System.IO.Path]::GetExtension($resolved.Path)
  $type = 'application/octet-stream'
  if ($mimeTypes.ContainsKey($extension)) { $type = $mimeTypes[$extension] }
  Send-Bytes $response 200 $type ([System.IO.File]::ReadAllBytes($resolved.Path)) $withBody
  return 200
}

$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Stop-WithError "could not listen on $prefix ($($_.Exception.Message)). Is the port in use? Try -Port 8081."
}

Write-Line "COA Builder: serving $rootFull at $prefix  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    # Wait in short steps so Ctrl+C is honoured (a blocking GetContext() ignores it on PowerShell 5.1).
    $pending = $listener.GetContextAsync()
    while (-not $pending.AsyncWaitHandle.WaitOne(250)) { }
    $context = $pending.GetAwaiter().GetResult()

    $status = 500
    try {
      $status = Invoke-Request $context
    } catch {
      try { Send-Text $context.Response 500 'Internal server error' $true } catch { }
      Write-Line "error: $($_.Exception.Message)"
    } finally {
      try { $context.Response.Close() } catch { }
    }
    Write-Line ("{0} {1} {2}" -f $context.Request.HttpMethod, $context.Request.Url.PathAndQuery, $status)
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
