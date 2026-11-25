"""Run one owned process tree with a finite deadline and parent-death cleanup.

Windows uses a kill-on-close Job Object before launching any descendants. POSIX
uses a separate child session; this supervisor survives its caller's termination.
No process-name matching, shell, command text or payload logging is used.
"""
import ctypes
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path


def windows_ownership(parent):
    from ctypes import wintypes as w
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    class BASIC(ctypes.Structure):
        _fields_ = [('ProcessTime', ctypes.c_int64), ('JobTime', ctypes.c_int64),
                    ('Flags', w.DWORD), ('Min', ctypes.c_size_t), ('Max', ctypes.c_size_t),
                    ('Active', w.DWORD), ('Affinity', ctypes.c_size_t),
                    ('Priority', w.DWORD), ('Scheduling', w.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ['r', 'w', 'o', 'rb', 'wb', 'ob']]
    class EXT(ctypes.Structure):
        _fields_ = [('Basic', BASIC), ('Io', IO), ('ProcessMemory', ctypes.c_size_t),
                    ('JobMemory', ctypes.c_size_t), ('PeakProcess', ctypes.c_size_t),
                    ('PeakJob', ctypes.c_size_t)]
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    # Parent handle prevents PID reuse from confusing ownership checks.
    handle = kernel.OpenProcess(0x00100000, False, parent)
    job = kernel.CreateJobObjectW(None, None)
    info = EXT()
    info.Basic.Flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not handle or not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise ctypes.WinError(ctypes.get_last_error())
    # Keep the non-inheritable job handle alive until supervisor exit. Closing it
    # kills this supervisor too, so the OS performs the final close at exit.
    return lambda: kernel.WaitForSingleObject(handle, 0) == 0x102, job


def main():
    parent, timeout, phase, *command = sys.argv[1:]
    timeout = float(timeout)
    if timeout <= 0 or not command:
        raise ValueError('Positive timeout and command required')
    started = time.monotonic()
    parent = int(parent)
    alive = lambda: os.getppid() == parent
    job = None
    if os.name == 'nt':
        alive, job = windows_ownership(parent)
    elif sys.platform.startswith('linux'):
        # Reap orphaned grandchildren in our own tree after group termination.
        ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)  # PR_SET_CHILD_SUBREAPER
    cancelled = False
    def cancel(*_):
        nonlocal cancelled
        cancelled = True
    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    # Caller supplies finite JSON (or empty input); EOF precedes child launch.
    payload = sys.stdin.buffer.read()
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=os.name != 'nt')
    reason = 'exit'
    output = error = b''
    try:
        while True:
            if cancelled or not alive():
                reason = 'parent_terminated'
                break
            if time.monotonic() - started >= timeout:
                reason = 'operation_timeout'
                break
            try:
                output, error = child.communicate(payload, timeout=min(.1, timeout))
                break
            except subprocess.TimeoutExpired:
                payload = None
    finally:
        if os.name == 'nt':
            # taskkill is restricted to this tracked, still-owned child PID.
            # Job close remains the backstop if caller/supervisor is terminated.
            if child.poll() is None:
                cleanup = subprocess.run(['taskkill.exe', '/PID', str(child.pid), '/T', '/F'],
                                         capture_output=True, timeout=1.5)
                if cleanup.returncode and child.poll() is None:
                    reason = 'tree_cleanup_failed'
        else:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            output, error = child.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            reason = 'tree_cleanup_failed'
        if os.name != 'nt':
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                try:
                    pid, _ = os.waitpid(-1, os.WNOHANG)
                    if not pid:
                        time.sleep(.01)
                        continue
                except ChildProcessError:
                    break
    sys.stdout.buffer.write(output)
    sys.stderr.buffer.write(error)
    metrics = os.environ.get('CHELM_PROCESS_REPORT_DIR')
    if metrics:
        # One report per supervisor avoids concurrent append/locking ambiguity.
        try:
            Path(metrics).mkdir(parents=True, exist_ok=True)
            ended = time.time() * 1000
            value = dict(phase=phase, pid=child.pid, supervisor_pid=os.getpid(), reason=reason,
                         started_ms=ended-(time.monotonic()-started)*1000, ended_ms=ended,
                         elapsed_ms=round((time.monotonic()-started)*1000), limit_ms=round(timeout*1000),
                         exit=child.returncode)
            target = Path(metrics) / (str(os.getpid())+'-'+str(time.time_ns())+'.json')
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps(value), encoding='utf-8')
            temporary.replace(target)
        except OSError:
            pass  # Optional measurements cannot change the operation's outcome.
    if reason != 'exit' or child.returncode:
        print('\nCHELM_PROCESS ' + json.dumps(dict(phase=phase, pid=child.pid, reason=reason,
              elapsed_ms=round((time.monotonic()-started)*1000), limit_ms=round(timeout*1000),
              exit=child.returncode)), file=sys.stderr, flush=True)
    return child.returncode if reason == 'exit' else (125 if reason == 'tree_cleanup_failed' else 124)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        # Do not echo command/payload or arbitrary exception text.
        print('CHELM_PROCESS ' + json.dumps(dict(reason='supervisor_failed', type=type(exc).__name__)), file=sys.stderr)
        sys.exit(125)
