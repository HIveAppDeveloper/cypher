from types import SimpleNamespace
import pytest
from app.services.tools.video import youtube_url

@pytest.mark.parametrize('url',['https://www.youtube.com/watch?v=NyfYxpXiw_0','https://youtu.be/NyfYxpXiw_0?t=12','https://www.youtube.com/shorts/NyfYxpXiw_0'])
def test_canonical_video_source(url):assert youtube_url(url)=='https://www.youtube.com/watch?v=NyfYxpXiw_0'

@pytest.mark.parametrize('url',['http://youtube.com/watch?v=NyfYxpXiw_0','https://youtube.com.evil.test/watch?v=NyfYxpXiw_0','https://user:password@youtube.com/watch?v=NyfYxpXiw_0','https://127.0.0.1/a.mp4','https://youtube.com/watch?v=wrong'])
def test_video_tool_rejects_unapproved_sources(url):
    with pytest.raises(ValueError):youtube_url(url)

@pytest.mark.asyncio
async def test_video_requires_real_frame_processing_and_never_receives_tools(monkeypatch):
    import ai
    from app.services import model_routing
    from app.services.tools.video import analyze_video
    from app.config import settings
    monkeypatch.setattr(settings,'LLM_USE_GATEWAY',True)
    async def catalog():return {'google/gemini-3.8-flash':{'modalities':{'input':['video']}}}
    monkeypatch.setattr(model_routing,'gateway_catalog',catalog)
    monkeypatch.setattr(ai,'get_model',lambda model:model)
    mode={'video':False}
    async def generate(model,messages,**kwargs):
        assert 'tools' not in kwargs
        assert messages[1].files[0].data=='https://www.youtube.com/watch?v=NyfYxpXiw_0'
        raw={'raw':{'promptTokensDetails':[{'modality':'VIDEO' if mode['video'] else 'TEXT','tokenCount':300}]}}
        return SimpleNamespace(text='At 01:00 a user creates a bot.',usage=SimpleNamespace(raw=raw))
    monkeypatch.setattr(ai,'experimental_generate',generate)
    assert not (await analyze_video({'url':'https://youtu.be/NyfYxpXiw_0'},'bot'))['success']
    mode['video']=True
    result=await analyze_video({'url':'https://youtu.be/NyfYxpXiw_0'},'bot')
    assert result['success'] and result['video_processed'] and not result['audio_processed']
