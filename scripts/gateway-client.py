#!/usr/bin/env python3
"""UltimateShell loopback upload/job client. No credentials in argv, no automatic write retries."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request
import urllib.error
import uuid

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

class Client:
    def __init__(self):
        token = os.environ.get('ULTIMATESHELL_GATEWAY_TOKEN')
        if not token:
            path = Path.home() / '.codex/ultimateshell-gateway.json'
            if path.stat().st_mode & 0o077:
                raise ValueError('Gateway config must have permissions 600')
            token = json.loads(path.read_text())['token']
        if not isinstance(token, str) or not token.strip():
            raise ValueError('Invalid gateway token')
        self.token = token
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, method, path, body=None):
        request = urllib.request.Request('http://127.0.0.1:39281' + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=300) as response:
                result = json.loads(response.read(8*1024*1024))
        except urllib.error.HTTPError as error:
            detail=error.read(1024*1024).decode('utf-8',errors='replace').replace(self.token,'[REDACTED]')
            raise ValueError(f'Gateway HTTP {error.code}: {detail}')
        if not isinstance(result,dict) or result.get('ok') is not True:
            raise ValueError(str(result.get('error', result) if isinstance(result,dict) else result).replace(self.token, '[REDACTED]'))
        return result

def require_capability(client, capability):
    status=client.request('GET','/api/status')
    if status.get('protocol_version',0)<2:
        raise ValueError('Running gateway uses the old persistence/auth protocol; restart updated UltimateShell')
    if capability not in status.get('capabilities',[]):
        raise ValueError(f'Running gateway does not support {capability}; restart the updated UltimateShell')
    if capability=='jobs' and status.get('job_log_mode')!='bounded_streams':
        raise ValueError('Running gateway has the old job logger; restart the updated UltimateShell')

def valid_id(value):
    parsed=uuid.UUID(value)
    if str(parsed)!=value: raise ValueError('Request ID must be a canonical lowercase UUID')
    return value

def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(65536), b''):
            digest.update(chunk)
    return digest.hexdigest()

def upload(client, args):
    path = Path(args.file)
    size = path.stat().st_size
    if not path.is_file() or size > 256 * 1024 * 1024:
        raise ValueError('Requires a regular file <=256 MiB')
    request_id = valid_id(args.request_id or str(uuid.uuid4()))
    # Print before first request so interrupted/unknown requests can be resumed explicitly.
    print('upload_id=' + request_id, flush=True)
    require_capability(client,'uploads')
    before = (size, path.stat().st_mtime_ns)
    body = dict(request_id=request_id, server=args.server, path=args.path, size=size,
                sha256=file_hash(path), overwrite=args.overwrite)
    result = client.request('POST', '/api/uploads', body)['upload']
    if result['status'] == 'completed':
        print(json.dumps(result, ensure_ascii=False)); return
    if result['status'] == 'committing':
        print(json.dumps(client.request('POST', f'/api/uploads/{request_id}/commit', {}), ensure_ascii=False)); return
    if result['status'] != 'receiving':
        raise ValueError('Session is not receiving; create a new request ID')
    offset = result['offset']
    if type(offset) is not int or not 0 <= offset <= size: raise ValueError('Invalid confirmed upload offset')
    with path.open('rb') as source:
        source.seek(offset)
        while offset < size:
            data = source.read(min(65536, size-offset))
            if not data:
                raise ValueError('Source file changed during upload')
            result = client.request('POST', f'/api/uploads/{request_id}/chunk',
                dict(offset=offset, data=base64.b64encode(data).decode()))['upload']
            confirmed=result['offset']
            if type(confirmed) is not int or confirmed!=offset+len(data): raise ValueError('Upload offset did not advance by the accepted chunk; query the original ID')
            offset=confirmed
    if before != (path.stat().st_size, path.stat().st_mtime_ns) or file_hash(path) != body['sha256']:
        raise ValueError('Source file changed; do not commit this session')
    print(json.dumps(client.request('POST', f'/api/uploads/{request_id}/commit', {}), ensure_ascii=False))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    up = sub.add_parser('upload')
    up.add_argument('--server', required=True); up.add_argument('--file', required=True)
    up.add_argument('--path', required=True); up.add_argument('--request-id')
    up.add_argument('--overwrite', action='store_true')
    job = sub.add_parser('job')
    job.add_argument('--server', required=True); job.add_argument('--command-file', required=True); job.add_argument('--request-id')
    status = sub.add_parser('job-status')
    status.add_argument('id'); status.add_argument('--offset', type=int, default=0); status.add_argument('--stderr-offset', type=int, default=0)
    for operation in ['upload-status', 'upload-abort', 'upload-delete', 'job-cleanup']:
        p = sub.add_parser(operation); p.add_argument('id')
    args = parser.parse_args()
    try:
        client = Client()
        if args.operation == 'upload': upload(client, args)
        elif args.operation == 'job':
            request_id = valid_id(args.request_id or str(uuid.uuid4()))
            print('job_id=' + request_id, flush=True)
            require_capability(client,'jobs')
            print(json.dumps(client.request('POST', '/api/jobs', dict(server=args.server,request_id=request_id,
                command=Path(args.command_file).read_text())), ensure_ascii=False))
        else:
            valid_id(args.id)
            if args.operation=='job-status' and (args.offset<0 or args.stderr_offset<0): raise ValueError('Output offsets cannot be negative')
            method, path = {
                'job-status': ('GET', f'/api/jobs/{args.id}?offset={args.offset}&stderr_offset={args.stderr_offset}') if args.operation == 'job-status' else ('GET',''),
                'upload-status': ('GET', f'/api/uploads/{args.id}'),
                'upload-abort': ('POST', f'/api/uploads/{args.id}/abort'),
                'upload-delete': ('DELETE', f'/api/uploads/{args.id}'),
                'job-cleanup': ('DELETE', f'/api/jobs/{args.id}'),
            }[args.operation]
            print(json.dumps(client.request(method, path, {} if method == 'POST' else None), ensure_ascii=False))
        return 0
    except (OSError,ValueError,KeyError,urllib.error.URLError) as error:
        print(f'{error}. Request not retried; query the printed ID before continuing.', file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
