# Hajiwang World - Minimal local HTTP server (no Node/Python required)
param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# If port is busy, try the next one
while ($true) {
  try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Start()
    break
  } catch {
    $Port += 1
    if ($Port -gt 9000) { throw "No available port found" }
  }
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Hajiwang World is running" -ForegroundColor Green
Write-Host "  URL: $url" -ForegroundColor Green
Write-Host "  Close this window to stop the server"
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Open browser automatically
Start-Process $url

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.json' = 'application/json; charset=utf-8'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $reqPath = $ctx.Request.Url.LocalPath.TrimStart('/')
    if ([string]::IsNullOrEmpty($reqPath)) { $reqPath = 'index.html' }
    $file = Join-Path $root $reqPath

    if (Test-Path $file -PathType Leaf) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $buf = [IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentLength64 = $buf.Length
      $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  } catch {
    # Ignore per-request errors, keep serving
  }
}
