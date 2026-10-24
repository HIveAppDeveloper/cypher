#!/usr/bin/env python3
"""Standard-library GrokBot companion. Every action requires local confirmation."""
import argparse,json,os,secrets,subprocess,time,urllib.request,urllib.error
from pathlib import Path
from urllib.parse import urlsplit

def request(origin,path,payload):
    req=urllib.request.Request(origin+'/api/local-device/'+path,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)

def resolve_file(value,folders):
    path=Path(value).expanduser().resolve()
    if not any(path.is_relative_to(folder) for folder in folders):raise ValueError('Path is outside the folders you allowed.')
    return path

def perform(job,folders,allow_shell):
    action,args=job['action'],job['arguments']
    if action=='read_file':
        path=resolve_file(args['path'],folders)
        if path.stat().st_size>200000:raise ValueError('File is larger than 200 KB.')
        return {'path':str(path),'content':path.read_text()}
    if action=='write_file':
        path=resolve_file(args['path'],folders)
        data=args.get('content','').encode()
        if len(data)>200000:raise ValueError('File is larger than 200 KB.')
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);return {'written':True,'path':str(path)}
    if action=='shell' and allow_shell:
        process=subprocess.Popen(args['command'],shell=True,cwd=str(folders[0]) if folders else None,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try:stdout,stderr=process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            import signal
            if hasattr(os,'killpg'):os.killpg(process.pid,signal.SIGKILL)
            else:process.kill()
            process.communicate();raise ValueError('Command exceeded the 30-second limit.')
        return {'exit_code':process.returncode,'stdout':stdout[:50000],'stderr':stderr[:10000]}
    raise ValueError('This device has not granted that capability.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server',default='https://open-grokbot-hiveapp.vercel.app')
    parser.add_argument('--allow-folder',action='append',default=[],help='Folder the agent may request access to. Repeat for multiple folders.')
    parser.add_argument('--allow-shell',action='store_true',help='Permit shell requests, with local approval for each command.')
    args=parser.parse_args();origin=args.server.rstrip('/')
    if urlsplit(origin).scheme!='https' or not urlsplit(origin).hostname:parser.error('Use an HTTPS server URL.')
    folders=[Path(p).expanduser().resolve() for p in args.allow_folder]
    if any(not p.is_dir() for p in folders):parser.error('Every allowed folder must already exist.')
    config_dir=Path.home()/'.grokbot-device';config_dir.mkdir(mode=0o700,exist_ok=True)
    config_file=config_dir/(urlsplit(origin).hostname+'.json')
    config=None
    if config_file.exists():
        try:config=json.loads(config_file.read_text())
        except (ValueError,OSError):pass
    if config and (config.get('folders')!=[str(p) for p in folders] or config.get('allow_shell')!=args.allow_shell):
        parser.error('Permissions changed. Revoke the old device in GrokBot, remove its local config, and pair again.')
    if not config:
        import getpass
        code=getpass.getpass('Paste the pairing code from GrokBot → Computer → Local devices: ').strip()
        paired=request(origin,'claim',{'token':code,'folders':[str(p) for p in folders],'allow_shell':args.allow_shell})
        config={'token':paired['token'],'folders':[str(p) for p in folders],'allow_shell':args.allow_shell}
        fd=os.open(config_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as output:json.dump(config,output)
    print('Connected. Keep this process open. Every file or shell request requires your local approval. Ctrl+C stops access.')
    print('Allowed folders:',', '.join(str(p) for p in folders) or 'none','; shell:',args.allow_shell)
    while True:
        try:
            item=request(origin,'poll',{'token':config['token']}).get('job')
            if item:
                # JSON escapes terminal control sequences from untrusted requests.
                print('\nRequested action:',json.dumps(item,ensure_ascii=True,indent=2))
                approved=input('Run this action? Type yes to approve: ').strip()=='yes'
                try:result=perform(item,folders,args.allow_shell) if approved else {'detail':'Owner denied the action.'}
                except Exception as error:result={'error':str(error)}
                request(origin,'complete',{'token':config['token'],'job_id':item['id'],'approved':approved,'result':result})
            else:time.sleep(5)
        except urllib.error.HTTPError as error:
            if error.code in (401,403):raise SystemExit('Device access was revoked or expired. Re-pair from GrokBot.')
            print('Cloud connection unavailable; retrying.');time.sleep(10)
        except (OSError,ValueError):print('Connection interrupted; retrying.');time.sleep(10)

if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:print('\nDevice companion stopped.')
