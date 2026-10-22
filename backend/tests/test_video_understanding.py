import pytest
from app.services.tools.video import youtube_url

@pytest.mark.parametrize('url',['https://www.youtube.com/watch?v=NyfYxpXiw_0','https://youtu.be/NyfYxpXiw_0?t=12','https://www.youtube.com/shorts/NyfYxpXiw_0'])
def test_canonical_video_source(url):assert youtube_url(url)=='https://www.youtube.com/watch?v=NyfYxpXiw_0'

@pytest.mark.parametrize('url',['http://youtube.com/watch?v=NyfYxpXiw_0','https://youtube.com.evil.test/watch?v=NyfYxpXiw_0','https://user:password@youtube.com/watch?v=NyfYxpXiw_0','https://127.0.0.1/a.mp4','https://youtube.com/watch?v=wrong'])
def test_video_tool_rejects_unapproved_sources(url):
    with pytest.raises(ValueError):youtube_url(url)

@pytest.mark.asyncio
async def test_video_analysis_processes_media_without_offering_model_tools(monkeypatch):
    from app.services.tools.video import analyze_video
    from app.services import video_sources, multimedia
    calls=[]
    async def download(url, root, bot_id):
        calls.append(('download',url,bot_id))
        return '/tmp/verified-video.mp4', '/tmp/verified-audio.m4a'
    async def inspect(path, question, *, audio_path=None):
        calls.append(('inspect',path,question,audio_path))
        return {'analysis':'A blue car crosses the frame.','video_processed':True,'audio_processed':True,'sampled_frame_seconds':[0,1.5]}
    monkeypatch.setattr(video_sources,'download_media',download)
    monkeypatch.setattr(multimedia,'inspect_media',inspect)
    result=await analyze_video({'url':'https://youtu.be/NyfYxpXiw_0'},'bot')
    assert result['success'] and result['video_processed'] and result['audio_processed']
    assert calls==[('download','https://www.youtube.com/watch?v=NyfYxpXiw_0','bot'),('inspect','/tmp/verified-video.mp4','Describe the video, spoken content and important timestamps.','/tmp/verified-audio.m4a')]
    assert 'timestamps' in result['instruction']


@pytest.mark.asyncio
async def test_video_errors_do_not_fall_back_to_titles_or_captions(monkeypatch):
    from app.services.tools.video import analyze_video
    from app.services import video_sources
    from app.services.model_routing import ModelCapabilityError
    async def unavailable(*args):
        raise ModelCapabilityError('No video-capable provider connection.')
    monkeypatch.setattr(video_sources,'download_media',unavailable)
    result=await analyze_video({'url':'https://youtu.be/NyfYxpXiw_0'},'bot')
    assert not result['success'] and 'No video-capable provider connection' in result['error']
