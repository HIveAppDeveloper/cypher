import importlib.util,json
from pathlib import Path
import pytest
from .test_workspace_workflows import workspace
from app.db.tenancy import current_tenant_id
from app.services import usage
from app.services.local_device import local_device_tool

A={'x-grokbot-user-id':'device-owner'};B={'x-grokbot-user-id':'another-owner'}

@pytest.mark.asyncio
async def test_pairing_rotation_owner_isolation_revoke_and_explicit_result(workspace):
    client,sessions=workspace
    pair=await client.post('/api/local-device/devices',headers=A,json={'name':'Controlled laptop'})
    assert pair.status_code==201,pair.text
    id=pair.json()['id'];code=pair.json()['pairing_code']
    anonymous={'x-grokbot-user-id':''}
    claim=await client.post('/api/local-device/claim',headers=anonymous,json={'token':code,'folders':['/allowed'],'allow_shell':False})
    assert claim.status_code==200,claim.text
    secret=claim.json()['token']
    assert secret!=code
    assert (await client.post('/api/local-device/claim',headers=anonymous,json={'token':code})).status_code==401
    assert (await client.get('/api/local-device/devices',headers=B)).json()==[]
    tenant=current_tenant_id.set('device-owner');context=usage.active.set(('device-test',sessions))
    try:
        denied=await local_device_tool({'action':'shell','device_id':id,'command':'pwd'},'agent')
        assert 'error' in denied
        request=await local_device_tool({'action':'read_file','device_id':id,'path':'/allowed/file.txt'},'agent')
        assert request['status']=='pending_local_approval'
        before=await local_device_tool({'action':'status','job_id':request['job_id']},'agent')
        assert before['status']=='pending' and before['result'] is None
    finally:usage.active.reset(context);current_tenant_id.reset(tenant)
    polled=(await client.post('/api/local-device/poll',headers=anonymous,json={'token':secret})).json()
    assert polled['job']['arguments']['path']=='/allowed/file.txt'
    assert (await client.post('/api/local-device/poll',headers=anonymous,json={'token':secret})).json()['job'] is None
    complete=await client.post('/api/local-device/complete',headers=anonymous,json={'token':secret,'job_id':request['job_id'],'approved':False,'result':{'detail':'Owner declined'}})
    assert complete.json()['status']=='denied'
    assert (await client.delete('/api/local-device/devices/'+id,headers=B)).status_code==404
    assert (await client.delete('/api/local-device/devices/'+id,headers=A)).status_code==200
    assert (await client.post('/api/local-device/poll',headers=anonymous,json={'token':secret})).status_code==401


def test_companion_enforces_folders_and_rejects_symlink_escape(tmp_path):
    file=Path(__file__).resolve().parents[2]/'companion/grokbot_device.py'
    spec=importlib.util.spec_from_file_location('companion',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    allowed=tmp_path/'allowed';allowed.mkdir();outside=tmp_path/'outside';outside.mkdir();(outside/'private.txt').write_text('private')
    (allowed/'link').symlink_to(outside,target_is_directory=True)
    with pytest.raises(ValueError):module.resolve_file(str(allowed/'link/private.txt'),[allowed])
    with pytest.raises(ValueError):module.perform({'action':'shell','arguments':{'command':'pwd'}},[allowed],False)
    result=module.perform({'action':'write_file','arguments':{'path':str(allowed/'test.txt'),'content':'approved'}},[allowed],False)
    assert result['written'] and (allowed/'test.txt').read_text()=='approved'
    assert file.read_bytes()==(file.parents[1]/'frontend/public/grokbot_device.py').read_bytes()
