"""Durable supervisor: log limits do not affect task files or masquerade as task exits."""
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

LIMIT = 8 * 1024 * 1024


def atomic_record(name, value):
    temporary = Path(name + '.tmp')
    with temporary.open('w') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(str(temporary), name)
    directory = os.open('.', os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def write_all(stream, data):
    view = memoryview(data)
    while view:
        count = stream.write(view)
        if not count:
            raise OSError('log write made no progress')
        view = view[count:]


def capture():
    os.umask(0o077)
    selector = selectors.DefaultSelector()
    logs = {}
    child = None
    result = dict(status='unknown', exit_code=None, capture_error=None, task_started=False)
    try:
        # Open log files BEFORE starting a task. Failure here has no remote task side effects.
        for name in ('stdout', 'stderr'):
            logs[name] = dict(file=open(name, 'wb', buffering=0), written=0, dropped=0)
        child = subprocess.Popen(['sh', './command.sh'], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        result['task_started'] = True
        for name, pipe in [('stdout', child.stdout), ('stderr', child.stderr)]:
            selector.register(pipe, selectors.EVENT_READ, name)
        ended_at = None
        while selector.get_map():
            for key, _ in selector.select(0.1):
                data = os.read(key.fd, 65536)
                if not data:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                log = logs[key.data]
                keep = min(len(data), max(0, LIMIT - log['written']))
                if keep:
                    write_all(log['file'], data[:keep])
                    log['written'] += keep
                if keep < len(data):
                    log['dropped'] += len(data) - keep
                    if not Path(key.data + '.truncated').exists():
                        Path(key.data + '.truncated').write_text('1\n')
            if child.poll() is not None:
                if ended_at is None:
                    ended_at = time.monotonic()
                elif time.monotonic() - ended_at > 2:
                    for key in list(selector.get_map().values()):
                        Path(key.data + '.truncated').write_text('descendant retained output pipe\n')
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                    break
        code = child.wait()
        result['exit_code'] = code if code >= 0 else 128 - code
        result['status'] = 'success' if code == 0 else 'error'
    except BaseException as error:
        result['capture_error'] = str(error)
        if child is None:
            result['status'] = 'setup_failed'
        else:
            # On capture/disk failure, stop and reap our own process group before publishing a final state.
            try:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                try:
                    code = child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    code = child.wait(timeout=5)
                result['exit_code'] = code if code >= 0 else 128 - code
                result['status'] = 'error'
            except BaseException as stop_error:
                result['capture_error'] += '; cannot confirm termination: ' + str(stop_error)
    finally:
        selector.close()
        if child is not None:
            for pipe in (child.stdout, child.stderr):
                if pipe is not None:
                    pipe.close()
        for name, log in logs.items():
            try:
                os.fsync(log['file'].fileno())
                log['file'].close()
                if log['dropped']:
                    Path(name + '.truncated').write_text(str(log['dropped']) + '\n')
            except OSError as error:
                result['capture_error'] = str(error)
                result['status'] = 'error' if result['exit_code'] is not None else 'unknown'
    return result


if __name__ == '__main__':
    outcome = capture()
    # Never synthesize a task exit from the supervisor's own exit code.
    atomic_record('result.json', json.dumps(outcome))
    if outcome['exit_code'] is not None:
        atomic_record('exit', str(outcome['exit_code']) + '\n')
