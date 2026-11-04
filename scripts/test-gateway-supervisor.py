import contextlib
import importlib.util
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('job_capture',Path(__file__).parents[1]/'src-tauri/src/gateway_job_capture.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

@contextlib.contextmanager
def work(command):
    previous=os.getcwd()
    with tempfile.TemporaryDirectory() as path:
        os.chdir(path)
        Path('command.sh').write_text(command)
        try: yield Path(path)
        finally: os.chdir(previous)

class CaptureTests(unittest.TestCase):
    def test_short_writes_are_fully_saved(self):
        class Sink:
            def __init__(self):self.data=bytearray()
            def write(self,value):self.data.extend(value[:3]);return min(3,len(value))
        sink=Sink();module.write_all(sink,b'0123456789');self.assertEqual(sink.data,b'0123456789')
    def test_setup_failure_does_not_start_command(self):
        with work('touch must-not-exist'):
            Path('stdout').mkdir();result=module.capture()
            self.assertEqual(result['status'],'setup_failed');self.assertFalse(result['task_started']);self.assertIsNone(result['exit_code']);self.assertFalse(Path('must-not-exist').exists())
    def test_capture_failure_stops_and_reaps_task_group(self):
        with work('echo $$ > child.pid; echo started; sleep 30; touch must-not-exist'):
            with patch.object(module,'write_all',side_effect=OSError('simulated full disk')):
                result=module.capture()
            self.assertEqual(result['status'],'error');self.assertEqual(result['exit_code'],143);self.assertIn('full disk',result['capture_error']);self.assertFalse(Path('must-not-exist').exists())
            pid=int(Path('child.pid').read_text())
            with self.assertRaises(ProcessLookupError):os.kill(pid,0)
    def test_signal_exit_is_not_success(self):
        with work('kill -TERM $$'):
            result=module.capture();self.assertEqual(result['exit_code'],143);self.assertEqual(result['status'],'error')
    def test_both_streams_are_drained_and_result_is_command_exit(self):
        with work("python3 - <<'PY'\nimport sys\nfrom pathlib import Path\nsys.stdout.buffer.write(b'o'*200000);sys.stdout.buffer.flush()\nsys.stderr.buffer.write(b'e'*200000);sys.stderr.buffer.flush()\nPath('finished').write_text('yes')\nPY\nexit 7"):
            with patch.object(module,'LIMIT',65536):result=module.capture()
            self.assertEqual(result['exit_code'],7);self.assertEqual(Path('stdout').stat().st_size,65536);self.assertEqual(Path('stderr').stat().st_size,65536);self.assertTrue(Path('finished').exists())

if __name__=='__main__':unittest.main()
