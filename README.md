# Auralis — Wave Meter

<img width="934" height="151" alt="image" src="https://github.com/user-attachments/assets/65555a16-c3d5-437b-915e-e225c57bb74c" />

A glowing, cascading sine wave visualizer with an accurate volume bar. Uses Web Audio + Canvas.
Vite + React + Tailwind frontend. Purely client-side.

## Quick Start (dev)

```bash
# 1) Extract the zip, then:
cd auralis
npm i
npm run dev
# open the URL shown (default http://localhost:5173)
```

- Load your own files via the **Load Audio** file picker, or drop audio in `public/test_audio/` (Vite serves from /test_audio).

## Loading audio

- Use the Browse button or drag-and-drop onto the drop zone.
- You can also place files in `public/test_audio/` and import via `/test_audio/<filename>` during dev.

## Build (distribution)

```bash
npm run build

# Share the built site
# Zip the 'dist' folder or copy it directly to another PC

# How to run the built site (no Node required)
# Option A: Python
cd dist
python -m http.server 5173
# Option B: Windows BAT (create a file named launch.bat in dist with the script from README below)
```

## Defaults & behavior

- On first load the app tries `/test_audio/default.wav`. If it’s missing, no error is shown; use Browse to pick a file.
- Interactions (play/pause/seek) are disabled until a track is loaded.

## Local dev preview

After build, you can preview locally with Vite:

```bash
npm run preview
```

## Windows one-click launcher (BAT)

Place this file next to `index.html` inside `dist/` and double-click it to run without Node. It will use Python if present, otherwise a PowerShell fallback server, and open your browser.

```
@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Usage: launch.bat [PORT]
set "PORT=%~1"
if not defined PORT set "PORT=5173"

set "SITE=%~dp0"
pushd "%SITE%" >nul

where python >nul 2>&1 && (
  start "Auralis (python)" cmd /d /c python -m http.server %PORT%
  goto open
)
where py >nul 2>&1 && (
  start "Auralis (py)" cmd /d /c py -m http.server %PORT%
  goto open
)

set "TMPPS=%TEMP%\auralis_http.ps1"
> "%TMPPS%" echo $ErrorActionPreference='Stop'
>>"%TMPPS%" echo $site = Resolve-Path '.'
>>"%TMPPS%" echo $port = %PORT%
>>"%TMPPS%" echo $prefix = 'http://localhost:' ^+ $port ^+ '/'
>>"%TMPPS%" echo $h = New-Object System.Net.HttpListener
>>"%TMPPS%" echo $h.Prefixes.Add($prefix)
>>"%TMPPS%" echo $h.Start()
>>"%TMPPS%" echo Write-Host ('Serving ' ^+ $site ^+ ' on ' ^+ $prefix) -ForegroundColor Cyan
>>"%TMPPS%" echo try { Start-Process $prefix } catch {}
>>"%TMPPS%" echo while ($h.IsListening) {
>>"%TMPPS%" echo ^  $ctx = $h.GetContext()
>>"%TMPPS%" echo ^  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
>>"%TMPPS%" echo ^  if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
>>"%TMPPS%" echo ^  $path = Join-Path $site $rel
>>"%TMPPS%" echo ^  if (-not (Test-Path $path) -and ($ctx.Request.Accept -match 'text/html')) { $path = Join-Path $site 'index.html' }
>>"%TMPPS%" echo ^  if (Test-Path $path) {
>>"%TMPPS%" echo ^    try {
>>"%TMPPS%" echo ^      $bytes = [IO.File]::ReadAllBytes($path)
>>"%TMPPS%" echo ^      $ext = [IO.Path]::GetExtension($path).ToLower()
>>"%TMPPS%" echo ^      $mime = switch ($ext) {
>>"%TMPPS%" echo ^        '.html' { 'text/html' }
>>"%TMPPS%" echo ^        '.js'   { 'application/javascript' }
>>"%TMPPS%" echo ^        '.css'  { 'text/css' }
>>"%TMPPS%" echo ^        '.json' { 'application/json' }
>>"%TMPPS%" echo ^        '.png'  { 'image/png' }
>>"%TMPPS%" echo ^        '.jpg'  { 'image/jpeg' }
>>"%TMPPS%" echo ^        '.jpeg' { 'image/jpeg' }
>>"%TMPPS%" echo ^        '.gif'  { 'image/gif' }
>>"%TMPPS%" echo ^        '.svg'  { 'image/svg+xml' }
>>"%TMPPS%" echo ^        '.ico'  { 'image/x-icon' }
>>"%TMPPS%" echo ^        Default { 'application/octet-stream' }
>>"%TMPPS%" echo ^      }
>>"%TMPPS%" echo ^      $ctx.Response.ContentType = $mime
>>"%TMPPS%" echo ^      $ctx.Response.ContentLength64 = $bytes.Length
>>"%TMPPS%" echo ^      $ctx.Response.StatusCode = 200
>>"%TMPPS%" echo ^      $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
>>"%TMPPS%" echo ^    } catch { $ctx.Response.StatusCode = 500 }
>>"%TMPPS%" echo ^  } else { $ctx.Response.StatusCode = 404 }
>>"%TMPPS%" echo ^  $ctx.Response.OutputStream.Close()
>>"%TMPPS%" echo }
start "Auralis (PowerShell)" powershell -NoProfile -ExecutionPolicy Bypass -File "%TMPPS%"

:open
timeout /t 1 >nul
start "" "http://localhost:%PORT%"
popd >nul
exit /b 0
```

## Notes

- Microphone access requires a user gesture and permission.
- Wave motion intensity scales with RMS volume; dominant frequency is approximated from analyser bins.
- Microphone access requires a user gesture and permission.
- Wave motion intensity scales with RMS volume; dominant frequency is approximated from analyser bins.
