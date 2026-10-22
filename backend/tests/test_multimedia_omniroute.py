import base64
import copy
import json
import shutil
import subprocess
from io import BytesIO
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image,ImageDraw
from app.config import settings
from app.schemas.input import Attachment,content_parts
from app.services import attachments,multimedia,omniroute
from app.services.model_routing import ModelCapabilityError,required_modalities
from app.services.video_sources import video_url,media_host,validate_media_url


def scanned(pages=1):
    image=Image.new('RGB',(400,500),'white');ImageDraw.Draw(image).rectangle((30,80,230,250),fill='purple')
    buffer=BytesIO();image.save(buffer,format='PDF',save_all=True,append_images=[image]*(pages-1))
    return {'name':'scan.pdf','mime':'application/pdf','data':base64.b64encode(buffer.getvalue()).decode()}


def test_scanned_pdf_preserves_original_and_renders_every_page_as_vision_evidence():
    source=[scanned(2)];original=copy.deepcopy(source)
    files=multimedia.prepare_documents(source)
    assert source==original
    assert required_modalities([{'role':'user','content':content_parts('Read the PDF',files)}])=={'text','image'}
    images=[x for x in files if x['mime']=='image/jpeg']
    assert len(images)==2 and 'page 2' in images[1]['name']
    with Image.open(BytesIO(base64.b64decode(images[0]['data']))) as im:
        r,g,b=im.getpixel((150,260));assert r>g+30 and b>g+30
    assert 'not instructions' in base64.b64decode(files[0]['data']).decode()


def test_overlong_or_invalid_pdf_fails_instead_of_silently_omitting_pages():
    for file in [scanned(21),{'name':'broken.pdf','mime':'application/pdf','data':'bm90IGEgcGRm'}]:
        original=copy.deepcopy(file)
        with pytest.raises(ModelCapabilityError):multimedia.prepare_documents([file])
        assert file==original


@pytest.mark.asyncio
async def test_audio_uses_only_authenticated_omniroute_and_cached_transcript_keeps_original(monkeypatch):
    monkeypatch.setattr(settings,'OMNIROUTE_URL','https://router.example')
    monkeypatch.setattr(settings,'OMNIROUTE_API_KEY','test-inference-key')
    monkeypatch.setattr(settings,'LLM_USE_GATEWAY',True)
    seen=[]
    async def request(path,body):
        seen.append((path,body));return {'text':'A purple bicycle costs $47.','segments':[{'start':0,'end':4,'text':'A purple bicycle costs $47.'}]}
    monkeypatch.setattr(omniroute,'request',request)
    file={'name':'speech.mp3','mime':'audio/mpeg','data':base64.b64encode(b'controlled audio').decode()}
    message=SimpleNamespace(metadata_json={'attachments':[copy.deepcopy(file)]})
    class DB:
        async def commit(self):pass
    first=await attachments.prepare_audio(DB(),message,[file]);second=await attachments.prepare_audio(DB(),message,[file])
    assert first==second and len(seen)==1 and seen[0][0]=='/audio/transcriptions'
    assert seen[0][1]['model']=='omniroute/whisper-base-local'
    assert message.metadata_json['attachments']==[file]
    assert '$47' in base64.b64decode(first[0]['data']).decode()


@pytest.mark.parametrize('url',[
 'https://www.instagram.com/reel/Dew3Lb_OL4t/?utm_source=test',
 'https://instagram.com/reels/Dew3Lb_OL4t/',
 'https://youtu.be/NyfYxpXiw_0?t=12',
])
def test_video_sources_are_canonical_and_tracking_is_not_forwarded(url):
    assert video_url(url) in {'https://www.instagram.com/reel/Dew3Lb_OL4t/','https://www.youtube.com/watch?v=NyfYxpXiw_0'}


@pytest.mark.parametrize('url',['http://instagram.com/reel/Dew3Lb_OL4t/','https://instagram.com.evil.test/reel/Dew3Lb_OL4t/','https://user:pass@instagram.com/reel/Dew3Lb_OL4t/','https://127.0.0.1/video.mp4','https://instagram.com/accounts/login/'])
def test_video_sources_reject_other_hosts_credentials_and_nonvideo_paths(url):
    with pytest.raises(ValueError):video_url(url)


@pytest.mark.asyncio
async def test_media_redirects_cannot_escape_site_or_resolve_to_internal_ips(monkeypatch):
    for url in ['https://googlevideo.com.evil.test/v','https://127.0.0.1/v','http://cdninstagram.com/v']:
        with pytest.raises(ModelCapabilityError):media_host(url,'youtube')
    async def private(*args,**kwargs):return [(2,1,6,'',('127.0.0.1',443))]
    monkeypatch.setattr(__import__('asyncio').get_running_loop(),'getaddrinfo',private)
    with pytest.raises(ModelCapabilityError,match='public'):await validate_media_url('https://r.googlevideo.com/video','youtube')


@pytest.mark.asyncio
async def test_video_sends_real_sampled_frames_and_full_timestamped_speech_to_router(tmp_path,monkeypatch):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):pytest.skip('Install ffmpeg for media integration test')
    path=tmp_path/'test.mp4'
    subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','color=c=purple:s=320x240:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(path)],check=True)
    monkeypatch.setattr(settings,'OMNIROUTE_URL','https://router.example')
    async def speech(route,body):
        assert route=='/audio/transcriptions' and base64.b64decode(body['file']['data'])[:3] in (b'ID3',b'\xff\xfbP')
        return {'text':'watermelon','segments':[{'start':.25,'end':1.5,'text':'watermelon'}]}
    monkeypatch.setattr(omniroute,'request',speech)
    async def complete(messages,**kwargs):
        assert not kwargs.get('tools')
        images=[p for p in messages[-1]['content'] if p['type']=='image_url']
        assert len(images)==2
        with Image.open(BytesIO(base64.b64decode(images[0]['image_url']['url'].split(',')[1]))) as im:
            r,g,b=im.getpixel((50,50));assert r>g+50 and b>g+50
        assert '[0.25–1.50s] watermelon' in json.dumps(messages,ensure_ascii=False)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='A purple frame. Speech: watermelon.'))])
    from app.services.llm_gateway import LLMGateway
    monkeypatch.setattr(LLMGateway,'complete',complete)
    evidence=await multimedia.inspect_media(path,'Describe it')
    assert evidence['video_processed'] and evidence['audio_processed']
    assert evidence['sampled_frame_seconds']==[0.0,1.9] and evidence['transport']=='omniroute'
