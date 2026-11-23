<#
.SYNOPSIS
  COA Builder development server: serves this folder on http://localhost:<Port>/ using only PowerShell.

.DESCRIPTION
  For machines that have only PowerShell and a browser. Works with Windows PowerShell 5.1 and
  PowerShell 7+ (Windows, macOS, Linux). Listens on localhost only. Serves files with the MIME
  types browsers require (ES modules need text/javascript), never serves dot-files or anything
  outside the root folder, and sends no-store so edits show up on reload.

  It also stores COAs as GeoJSON files (one <id>.geojson per COA) through a small API:
    GET    /api/health          { storage: "files", dataDir }
    GET    /api/coas            { ids: [...] }
    GET    /api/coas/{id}       the document, ETag "<revision>"            | 404
    PUT    /api/coas/{id}       If-None-Match: *  → 201 | 409 (exists)
                                If-Match: "<rev>" → 200 | 409 (stale) | 404
                                neither → 428; bad id or body → 400; > 10 MB → 413
    DELETE /api/coas/{id}       If-Match: "<rev>" → 204 | 409 | 404;  none → 428
    GET    /api/settings        the settings document, ETag "<revision>"     | 404 before the first save
    PUT    /api/settings        as for COAs; body: a JSON object with an integer revision >= 1
    GET    /api/docs/{collection}       { ids: [...] }  (data/<collection>/<id>.json; systems, threat models)
    GET    /api/docs/{collection}/{id}  the document, ETag "<revision>" | 404
    PUT    /api/docs/{collection}/{id}  as for COAs; body: a JSON object with "id" = {id} and an integer revision >= 1
    DELETE /api/docs/{collection}/{id}  as for COAs.  collection: ^[a-z][a-z0-9-]{0,39}$
  409 replies carry { expectedRevision, actualRevision }. Writes go to a temp file first.

.PARAMETER Port
  Port to listen on. Default 8080.

.PARAMETER Root
  Folder to serve. Default: the folder this script is in.

.PARAMETER DataDir
  Folder for the COA files. Default: <Root>/data. Created if missing.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1
  (or double-click serve.cmd)

.EXAMPLE
  pwsh -File ./serve.ps1 -Port 8081
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [string]$Root = $PSScriptRoot,
  [string]$DataDir = ''
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

if ($DataDir -eq '') { $DataDir = Join-Path $rootFull 'data' }
try {
  $null = New-Item -ItemType Directory -Force -Path $DataDir
} catch {
  Stop-WithError "data folder could not be created: $DataDir ($($_.Exception.Message))"
}
$dataFull = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $DataDir).ProviderPath)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$maxBodyBytes = 10MB
$idPattern = '^[A-Za-z0-9_-]{1,128}$'
$collectionPattern = '^[a-z][a-z0-9-]{0,39}$'

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
  # Same policy as index.html and serve.py (tests/csp.test.js checks they agree).
  $Response.Headers['Content-Security-Policy'] = 'default-src ''self''; script-src ''self''; style-src ''self'' ''unsafe-inline''; img-src ''self'' data: blob: https://tile.openstreetmap.org; connect-src ''self''; font-src ''self''; object-src ''none''; base-uri ''none''; form-action ''self'''
  $Response.ContentLength64 = $Bytes.Length
  if ($WithBody -and $Bytes.Length -gt 0) { $Response.OutputStream.Write($Bytes, 0, $Bytes.Length) }
}

function Send-Text($Response, [int]$Status, [string]$Text, [bool]$WithBody) {
  Send-Bytes $Response $Status 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($Text)) $WithBody
}

function Send-Json($Response, [int]$Status, [string]$Json) {
  Send-Bytes $Response $Status 'application/json; charset=utf-8' ($utf8NoBom.GetBytes($Json)) $true
}

# A property of a parsed JSON object, or $null if absent (StrictMode forbids reading missing properties).
function Get-Member($Object, [string]$Name) {
  if ($null -eq $Object -or $Object -isnot [System.Management.Automation.PSCustomObject]) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Test-WholeNumber($Value) {
  return ($Value -is [int] -or $Value -is [long]) -and $Value -ge 1
}

# The revision stored in a COA file, or $null if the file is unreadable.
function Get-StoredRevision([string]$Path) {
  try {
    $doc = [System.IO.File]::ReadAllText($Path, $utf8NoBom) | ConvertFrom-Json
    $revision = Get-Member (Get-Member $doc 'coa') 'revision'
    if (Test-WholeNumber $revision) { return [long]$revision }
  } catch { }
  return $null
}

# The revision stored in settings.json, or $null if unreadable.
function Get-SettingsRevision([string]$Path) {
  try {
    $revision = Get-Member ([System.IO.File]::ReadAllText($Path, $utf8NoBom) | ConvertFrom-Json) 'revision'
    if (Test-WholeNumber $revision) { return [long]$revision }
  } catch { }
  return $null
}

# "If-Match: "4"" or "4" → 4; anything else → $null.
function Get-ExpectedRevision([string]$Header) {
  $value = 0L
  if ([long]::TryParse($Header.Trim().Trim('"'), [ref]$value)) { return $value }
  return $null
}

function Write-CoaFile([string]$Path, [string]$Text) {
  $temp = Join-Path $dataFull (".{0}.tmp" -f [guid]::NewGuid().ToString('N'))
  [System.IO.File]::WriteAllText($temp, $Text, $utf8NoBom)
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    # [NullString]::Value: PowerShell would turn $null into "", which Replace rejects as a backup path.
    [System.IO.File]::Replace($temp, $Path, [NullString]::Value)
  } else {
    [System.IO.File]::Move($temp, $Path)
  }
}

function Send-Conflict($Response, $Expected, $Actual) {
  $actualJson = if ($null -eq $Actual) { 'null' } else { "$Actual" }
  Send-Json $Response 409 ('{{"expectedRevision":{0},"actualRevision":{1}}}' -f $Expected, $actualJson)
}

# The revision stored in a document file (data/<collection>/<id>.json), or $null if unreadable.
function Get-DocumentRevision([string]$Path) {
  try {
    $revision = Get-Member ([System.IO.File]::ReadAllText($Path, $utf8NoBom) | ConvertFrom-Json) 'revision'
    if (Test-WholeNumber $revision) { return [long]$revision }
  } catch { }
  return $null
}

# /api/docs/{collection}[/{id}]: plain JSON documents with an id and a revision (systems, threat models).
function Invoke-DocumentApi($Request, $Response, [string]$Method, [string]$Collection, $Id) {
  if ($Collection -cnotmatch $collectionPattern) { Send-Json $Response 400 '{"error":"invalid collection"}'; return 400 }
  $folder = Join-Path $dataFull $Collection
  if ($null -eq $Id) {
    if ($Method -ne 'GET') { $Response.Headers['Allow'] = 'GET'; Send-Json $Response 405 '{"error":"method not allowed"}'; return 405 }
    $ids = @()
    if (Test-Path -LiteralPath $folder -PathType Container) {
      $ids = @(Get-ChildItem -LiteralPath $folder -Filter '*.json' -File | ForEach-Object { $_.BaseName } | Where-Object { $_ -match $idPattern })
    }
    Send-Json $Response 200 ('{"ids":' + (ConvertTo-Json -InputObject $ids -Compress) + '}')
    return 200
  }
  if ($Id -notmatch $idPattern) { Send-Json $Response 400 '{"error":"invalid id"}'; return 400 }
  $file = Join-Path $folder "$Id.json"
  $exists = Test-Path -LiteralPath $file -PathType Leaf

  if ($Method -eq 'GET') {
    if (-not $exists) { Send-Json $Response 404 '{"error":"not found"}'; return 404 }
    $revision = Get-DocumentRevision $file
    if ($null -ne $revision) { $Response.Headers['ETag'] = '"' + $revision + '"' }
    Send-Bytes $Response 200 'application/json; charset=utf-8' ([System.IO.File]::ReadAllBytes($file)) $true
    return 200
  }

  if ($Method -eq 'PUT') {
    if ($Request.ContentLength64 -gt $maxBodyBytes) { Send-Json $Response 413 '{"error":"document too large"}'; return 413 }
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $utf8NoBom)
    $body = $reader.ReadToEnd()
    $reader.Dispose()
    if ($utf8NoBom.GetByteCount($body) -gt $maxBodyBytes) { Send-Json $Response 413 '{"error":"document too large"}'; return 413 }
    $doc = $null
    try { $doc = $body | ConvertFrom-Json } catch { }
    if ($doc -isnot [System.Management.Automation.PSCustomObject] -or (Get-Member $doc 'id') -cne $Id -or -not (Test-WholeNumber (Get-Member $doc 'revision'))) {
      Send-Json $Response 400 '{"error":"body is not a document for this id"}'
      return 400
    }
    $ifNoneMatch = $Request.Headers['If-None-Match']
    $ifMatch = $Request.Headers['If-Match']
    if ($ifNoneMatch -eq '*') {
      if ($exists) { Send-Conflict $Response 0 (Get-DocumentRevision $file); return 409 }
      $null = New-Item -ItemType Directory -Force -Path $folder
      Write-CoaFile $file $body
      Send-Json $Response 201 ('{{"id":"{0}","revision":{1}}}' -f $Id, (Get-Member $doc 'revision'))
      return 201
    }
    if ($null -eq $ifMatch) { Send-Json $Response 428 '{"error":"If-Match or If-None-Match required"}'; return 428 }
    if (-not $exists) { Send-Json $Response 404 '{"error":"not found"}'; return 404 }
    $expected = Get-ExpectedRevision $ifMatch
    $actual = Get-DocumentRevision $file
    if ($null -eq $expected -or $expected -ne $actual) { Send-Conflict $Response $(if ($null -eq $expected) { 'null' } else { $expected }) $actual; return 409 }
    Write-CoaFile $file $body
    Send-Json $Response 200 ('{{"id":"{0}","revision":{1}}}' -f $Id, (Get-Member $doc 'revision'))
    return 200
  }

  if ($Method -eq 'DELETE') {
    $ifMatch = $Request.Headers['If-Match']
    if ($null -eq $ifMatch) { Send-Json $Response 428 '{"error":"If-Match required"}'; return 428 }
    if (-not $exists) { Send-Json $Response 404 '{"error":"not found"}'; return 404 }
    $expected = Get-ExpectedRevision $ifMatch
    $actual = Get-DocumentRevision $file
    if ($null -eq $expected -or $expected -ne $actual) { Send-Conflict $Response $(if ($null -eq $expected) { 'null' } else { $expected }) $actual; return 409 }
    Remove-Item -LiteralPath $file -Force
    $Response.StatusCode = 204
    $Response.Headers['Cache-Control'] = 'no-store'
    return 204
  }

  $Response.Headers['Allow'] = 'GET, PUT, DELETE'
  Send-Json $Response 405 '{"error":"method not allowed"}'
  return 405
}

function Invoke-Api($Request, $Response, [string]$Path) {
  $method = $Request.HttpMethod

  if ($Path -eq '/api/health') {
    $info = @{ storage = 'files'; dataDir = $dataFull } | ConvertTo-Json -Compress
    Send-Json $Response 200 $info
    return 200
  }

  if ($Path -eq '/api/settings') {
    $file = Join-Path $dataFull 'settings.json'
    $exists = Test-Path -LiteralPath $file -PathType Leaf
    if ($method -eq 'GET') {
      if (-not $exists) { Send-Json $Response 404 '{"error":"not found"}'; return 404 }
      $revision = Get-SettingsRevision $file
      if ($null -ne $revision) { $Response.Headers['ETag'] = '"' + $revision + '"' }
      Send-Bytes $Response 200 'application/json; charset=utf-8' ([System.IO.File]::ReadAllBytes($file)) $true
      return 200
    }
    if ($method -ne 'PUT') { $Response.Headers['Allow'] = 'GET, PUT'; Send-Json $Response 405 '{"error":"method not allowed"}'; return 405 }
    if ($Request.ContentLength64 -gt $maxBodyBytes) { Send-Json $Response 413 '{"error":"document too large"}'; return 413 }
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $utf8NoBom)
    $body = $reader.ReadToEnd()
    $reader.Dispose()
    $doc = $null
    try { $doc = $body | ConvertFrom-Json } catch { }
    if (-not (Test-WholeNumber (Get-Member $doc 'revision'))) { Send-Json $Response 400 '{"error":"not a settings document"}'; return 400 }
    $ifNoneMatch = $Request.Headers['If-None-Match']
    $ifMatch = $Request.Headers['If-Match']
    if ($ifNoneMatch -eq '*') {
      if ($exists) { Send-Conflict $Response 0 (Get-SettingsRevision $file); return 409 }
      Write-CoaFile $file $body
      Send-Json $Response 201 ('{{"revision":{0}}}' -f (Get-Member $doc 'revision'))
      return 201
    }
    if ($null -eq $ifMatch) { Send-Json $Response 428 '{"error":"If-Match or If-None-Match required"}'; return 428 }
    if (-not $exists) { Send-Json $Response 404 '{"error":"not found"}'; return 404 }
    $expected = Get-ExpectedRevision $ifMatch
    $actual = Get-SettingsRevision $file
    if ($null -eq $expected -or $expected -ne $actual) { Send-Conflict $Response $(if ($null -eq $expected) { 'null' } else { $expected }) $actual; return 409 }
    Write-CoaFile $file $body
    Send-Json $Response 200 ('{{"revision":{0}}}' -f (Get-Member $doc 'revision'))
    return 200
  }

  $docs = [regex]::Match($Path, '^/api/docs/([^/]+)(?:/([^/]+))?$')
  if ($docs.Success) {
    $collection = [System.Uri]::UnescapeDataString($docs.Groups[1].Value)
    $docId = if ($docs.Groups[2].Success) { [System.Uri]::UnescapeDataString($docs.Groups[2].Value) } else { $null }
    return (Invoke-DocumentApi $Request $Response $method $collection $docId)
  }

  if ($Path -eq '/api/coas') {
    if ($method -ne 'GET') {
      $Response.Headers['Allow'] = 'GET'
      Send-Json $Response 405 '{"error":"method not allowed"}'
      return 405
    }
    $ids = @(Get-ChildItem -LiteralPath $dataFull -Filter '*.geojson' -File |
      ForEach-Object { $_.BaseName } |
      Where-Object { $_ -match $idPattern })
    Send-Json $Response 200 ('{"ids":' + (ConvertTo-Json -InputObject $ids -Compress) + '}')
    return 200
  }

  $match = [regex]::Match($Path, '^/api/coas/([^/]+)$')
  if (-not $match.Success) {
    Send-Json $Response 404 '{"error":"not found"}'
    return 404
  }
  $id = [System.Uri]::UnescapeDataString($match.Groups[1].Value)
  if ($id -notmatch $idPattern) {
    Send-Json $Response 400 '{"error":"invalid id"}'
    return 400
  }
  $file = Join-Path $dataFull "$id.geojson"
  $exists = Test-Path -LiteralPath $file -PathType Leaf

  if ($method -eq 'GET') {
    if (-not $exists) { Send-Json $Response 404 '{"error":"not found"}'; return 404 }
    $revision = Get-StoredRevision $file
    if ($null -ne $revision) { $Response.Headers['ETag'] = '"' + $revision + '"' }
    Send-Bytes $Response 200 'application/geo+json; charset=utf-8' ([System.IO.File]::ReadAllBytes($file)) $true
    return 200
  }

  if ($method -eq 'PUT') {
    if ($Request.ContentLength64 -gt $maxBodyBytes) { Send-Json $Response 413 '{"error":"document too large"}'; return 413 }
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $utf8NoBom)
    $body = $reader.ReadToEnd()
    $reader.Dispose()
    if ($utf8NoBom.GetByteCount($body) -gt $maxBodyBytes) { Send-Json $Response 413 '{"error":"document too large"}'; return 413 }

    $doc = $null
    try { $doc = $body | ConvertFrom-Json } catch { }
    $coa = Get-Member $doc 'coa'
    if ((Get-Member $doc 'type') -ne 'FeatureCollection' -or (Get-Member $coa 'id') -cne $id -or -not (Test-WholeNumber (Get-Member $coa 'revision'))) {
      Send-Json $Response 400 '{"error":"body is not a COA document for this id"}'
      return 400
    }

    $ifNoneMatch = $Request.Headers['If-None-Match']
    $ifMatch = $Request.Headers['If-Match']
    if ($ifNoneMatch -eq '*') {
      if ($exists) { Send-Conflict $Response 0 (Get-StoredRevision $file); return 409 }
      Write-CoaFile $file $body
      Send-Json $Response 201 ('{{"id":"{0}","revision":{1}}}' -f $id, (Get-Member $coa 'revision'))
      return 201
    }
    if ($null -eq $ifMatch) { Send-Json $Response 428 '{"error":"If-Match or If-None-Match required"}'; return 428 }
    if (-not $exists) { Send-Json $Response 404 '{"error":"not found"}'; return 404 }
    $expected = Get-ExpectedRevision $ifMatch
    $actual = Get-StoredRevision $file
    if ($null -eq $expected -or $expected -ne $actual) { Send-Conflict $Response $(if ($null -eq $expected) { 'null' } else { $expected }) $actual; return 409 }
    Write-CoaFile $file $body
    Send-Json $Response 200 ('{{"id":"{0}","revision":{1}}}' -f $id, (Get-Member $coa 'revision'))
    return 200
  }

  if ($method -eq 'DELETE') {
    $ifMatch = $Request.Headers['If-Match']
    if ($null -eq $ifMatch) { Send-Json $Response 428 '{"error":"If-Match required"}'; return 428 }
    if (-not $exists) { Send-Json $Response 404 '{"error":"not found"}'; return 404 }
    $expected = Get-ExpectedRevision $ifMatch
    $actual = Get-StoredRevision $file
    if ($null -eq $expected -or $expected -ne $actual) { Send-Conflict $Response $(if ($null -eq $expected) { 'null' } else { $expected }) $actual; return 409 }
    Remove-Item -LiteralPath $file -Force
    $Response.StatusCode = 204
    $Response.Headers['Cache-Control'] = 'no-store'
    return 204
  }

  $Response.Headers['Allow'] = 'GET, PUT, DELETE'
  Send-Json $Response 405 '{"error":"method not allowed"}'
  return 405
}

function Invoke-Request($Context) {
  $request = $Context.Request
  $response = $Context.Response
  $method = $request.HttpMethod
  $withBody = $method -ne 'HEAD'

  $path = $request.Url.AbsolutePath
  if ($path -eq '/api' -or $path.StartsWith('/api/')) {
    return Invoke-Api $request $response $path
  }

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
