import json,os,subprocess,sys,time
from pathlib import Path
from uuid import uuid4
import pytest

@pytest.mark.skipif(not os.getenv('GROKBOT_TEST_POSTGRES_URL'),reason='Requires disposable PostgreSQL')
def test_sigkill_worker_failover_resumes_goal_without_duplicate_write(tmp_path):
    env={**os.environ,'GROKBOT_DATABASE_URL':os.environ['GROKBOT_TEST_POSTGRES_URL'],'DATABASE_SCHEMA':'e2e_recovery_'+uuid4().hex,'BACKEND_API_TOKEN':'isolated-test-token-more-than-thirty-two-characters','REQUIRE_USER_AUTH':'true','GROKBOT_VERIFY_CLOUD':'false','REDIS_URL':''}
    script=str(Path(__file__).with_name('recovery_process.py'))
    def command(mode):return [sys.executable,script,mode,str(tmp_path)]
    def run(mode):return subprocess.run(command(mode),env=env,capture_output=True,text=True,timeout=20)
    first=second=None
    logs=[]
    try:
        seed=run('seed');assert seed.returncode==0,seed.stdout+seed.stderr
        for mode in ('leader','standby'):
            log=(tmp_path/(mode+'.log')).open('w');logs.append(log)
            proc=subprocess.Popen(command(mode),env=env,stdout=log,stderr=log)
            if mode=='leader':
                first=proc
                for _ in range(200):
                    if (tmp_path/'ready').exists():break
                    if first.poll() is not None:break
                    time.sleep(.1)
                assert (tmp_path/'ready').exists(),(tmp_path/'leader.log').read_text()
            else:second=proc
        time.sleep(.5)
        assert (tmp_path/'writes.txt').read_text()=='write\n'
        first.kill();first.wait(timeout=5)  # No Python cleanup or graceful shutdown.
        for _ in range(100):
            checked=run('verify')
            if checked.returncode==0:break
            time.sleep(.15)
        assert checked.returncode==0,checked.stdout+checked.stderr+(tmp_path/'standby.log').read_text()
        print(checked.stdout)
    finally:
        for proc in (first,second):
            if proc and proc.poll() is None:
                proc.terminate()
                try:proc.wait(timeout=5)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()
        for log in logs:log.close()
        run('drop')
