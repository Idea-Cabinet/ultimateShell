import base64
import contextlib
import importlib.util
import io
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('gateway_client', Path(__file__).with_name('gateway-client.py'))
client_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client_module)

class UploadClient:
    def __init__(self, offset=0, status='receiving', change=None):
        self.offset, self.status, self.calls, self.change = offset, status, [], change
        self.data = bytearray()
    def request(self, method, path, body=None):
        self.calls.append((method,path,body))
        if path == '/api/status':
            return {'ok':True,'protocol_version':2,'capabilities':['uploads','jobs'],'job_log_mode':'bounded_streams'}
        if path == '/api/uploads':
            return {'upload': {'offset':self.offset,'status':self.status}}
        if path.endswith('/chunk'):
            data = base64.b64decode(body['data'])
            assert body['offset'] == self.offset
            self.offset += len(data)
            self.data.extend(data)
            if self.change:
                self.change(); self.change=None
            return {'upload': {'offset':self.offset,'status':'receiving'}}
        return {'ok':True}

class GatewayClientTests(unittest.TestCase):
    def args(self, path):
        return SimpleNamespace(file=str(path),request_id='00000000-0000-4000-8000-000000000001',
                               server='fixture',path='/tmp/release.tgz',overwrite=False)
    def upload(self, client, args):
        with contextlib.redirect_stdout(io.StringIO()):
            return client_module.upload(client,args)
    def test_upload_uses_binary_chunks_not_exec(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'release'; p.write_bytes(bytes(range(256))*600)
            client=UploadClient();self.upload(client,self.args(p))
            self.assertEqual(client.data,p.read_bytes())
            self.assertEqual(client.calls[-1][1].split('/')[-1],'commit')
            self.assertFalse(any('/exec' in path for _,path,_ in client.calls))
            self.assertTrue(all(len(base64.b64decode(body['data']))<=65536 for _,path,body in client.calls if path.endswith('/chunk')))
    def test_resume_starts_from_server_offset(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'release';p.write_bytes(b'a'*70000+b'end')
            client=UploadClient(offset=65536);self.upload(client,self.args(p))
            self.assertEqual(client.data,p.read_bytes()[65536:])
    def test_completed_upload_does_not_send_chunks(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'release';p.write_bytes(b'abc')
            client=UploadClient(status='completed');self.upload(client,self.args(p))
            self.assertEqual(len(client.calls),2)
    def test_unknown_commit_reuses_same_id(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'release';p.write_bytes(b'abc')
            client=UploadClient(status='committing');self.upload(client,self.args(p))
            self.assertEqual(len(client.calls),3)
            self.assertTrue(client.calls[-1][1].endswith('/00000000-0000-4000-8000-000000000001/commit'))
    def test_source_change_prevents_commit(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'release';p.write_bytes(b'abc')
            client=UploadClient(change=lambda:p.write_bytes(b'xyz'))
            with self.assertRaises(ValueError): self.upload(client,self.args(p))
            self.assertFalse(any(path.endswith('/commit') for _,path,_ in client.calls))
    def test_errors_do_not_retry(self):
        class Failed(UploadClient):
            def request(self,*args):
                self.calls.append(args)
                raise OSError('connection lost')
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'release';p.write_bytes(b'abc');client=Failed()
            with self.assertRaises(OSError):self.upload(client,self.args(p))
            self.assertEqual(len(client.calls),1)

    def test_stalled_offset_is_an_error_not_an_infinite_retry(self):
        class Stalled(UploadClient):
            def request(self,method,path,body=None):
                if path.endswith('/chunk'):
                    self.calls.append((method,path,body));return {'upload':{'offset':self.offset,'status':'receiving'}}
                return super().request(method,path,body)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'release';p.write_bytes(b'abc');client=Stalled()
            with self.assertRaises(ValueError):self.upload(client,self.args(p))
            self.assertEqual(sum(path.endswith('/chunk') for _,path,_ in client.calls),1)
            self.assertFalse(any(path.endswith('/commit') for _,path,_ in client.calls))
    def test_old_gateway_stops_before_any_upload_mutation(self):
        class Old(UploadClient):
            def request(self,method,path,body=None):
                self.calls.append((method,path,body));return {'ok':True,'version':'1.0.0'}
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'release';p.write_bytes(b'abc');client=Old()
            with self.assertRaises(ValueError):self.upload(client,self.args(p))
            self.assertEqual([(method,path) for method,path,_ in client.calls],[('GET','/api/status')])

if __name__ == '__main__': unittest.main()
