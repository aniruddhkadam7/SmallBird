; Installer hooks for the Windows NSIS bundle (see tauri.conf.json's
; bundle.windows.nsis.installerHooks).
;
; Why this exists: the desktop app spawns a background child process at
; startup — the RAG-lite service (rag-lite.exe), bundled as a resource next
; to the main exe (see src/rag/process.rs). It has no visible window, so a
; user reinstalling/updating over a still-running instance has no obvious
; way to know they need to close it first. Without this, Windows can't
; overwrite the locked DLLs that process has open, and the installer fails
; mid-extraction with an "Error opening file for writing" prompt (seen in
; the field on a real test machine, on rag-lite's VCRUNTIME140.dll) —
; confusing for anyone who isn't a developer and doesn't know to check Task
; Manager for background exe's with no window. STT no longer spawns a local
; process at all (it's a Deepgram Flux WebSocket connection made directly by
; the main process — see src/stt/client.rs), so there is nothing to kill for
; it here.
;
; taskkill's exit code is deliberately ignored (nothing to do differently
; whether or not each process was actually running) — this only ever needs
; to be best-effort cleanup before extraction, never a hard failure gate.
;
; nsExec::ExecToLog runs the command the same way ExecWait does, but through
; NSIS's bundled helper plugin, which hides the child console window instead
; of letting it flash on screen — taskkill.exe is a console-subsystem
; program, so a plain ExecWait briefly pops a visible terminal every install/
; uninstall/reinstall.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "desktop.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "rag-lite.exe" /T'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "desktop.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "rag-lite.exe" /T'
!macroend
