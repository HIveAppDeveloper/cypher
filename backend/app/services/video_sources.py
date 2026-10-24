"""Read actual YouTube/Instagram media, reusing only this agent's saved login."""
import asyncio
import http.cookiejar
import ipaddress
import math
import re
import shutil
import socket
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from app.services.model_routing import ModelCapabilityError

MAX_DOWNLOAD=100*1024*1024


def video_url(value):
    from app.services.tools.video import youtube_url
    parsed=urlsplit(str(value))
    if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443):raise ValueError('Use an HTTPS YouTube or Instagram video link.')
    host=(parsed.hostname or '').lower()
    if host in {'instagram.com','www.instagram.com','m.instagram.com'}:
        match=re.fullmatch(r'/(reel|reels|p|tv)/([A-Za-z0-9_-]{5,80})/?',parsed.path)
        if not match:raise ValueError('Use a link to an Instagram reel or video post.')
        return 'https://www.instagram.com/'+('reel' if match[1]=='reels' else match[1])+'/'+match[2]+'/'
    return youtube_url(value)


def media_host(url, platform):
    parsed=urlsplit(url)
    domains=('googlevideo.com','youtube.com') if platform=='youtube' else ('cdninstagram.com','fbcdn.net','instagram.com')
    host=(parsed.hostname or '').lower()
    if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443) or not any(host==d or host.endswith('.'+d) for d in domains):raise ModelCapabilityError('The video site returned an unsupported media destination.')
    return host


async def validate_media_url(url, platform):
    host=media_host(url,platform)
    records=await asyncio.get_running_loop().getaddrinfo(host,443,type=socket.SOCK_STREAM)
    if not records or any(not ipaddress.ip_address(row[4][0]).is_global for row in records):raise ModelCapabilityError('The media destination is not a public server.')


class QuietLogger:
    def debug(self,*args):pass
    def warning(self,*args):pass
    def error(self,*args):pass


def extract(url,cookies):
    import yt_dlp
    platform='instagram' if 'instagram.com/' in url else 'youtube'
    options={'quiet':True,'no_warnings':True,'logger':QuietLogger(),'noplaylist':True,'socket_timeout':15,'retries':1,'extractor_retries':1,'skip_download':True,'cachedir':False,'geo_bypass':False,'js_runtimes':{'node':{'path':shutil.which('node') or 'node'}},'format':'bestvideo[protocol=https][height<=480]+bestaudio[protocol=https]/best[protocol=https][height<=480]/best[protocol=https]'}
    with yt_dlp.YoutubeDL(options) as ydl:
        for cookie in cookies:
            domain=cookie.get('domain','').lstrip('.')
            allowed='instagram.com' if platform=='instagram' else 'youtube.com'
            if domain!=allowed and not domain.endswith('.'+allowed):continue
            ydl.cookiejar.set_cookie(http.cookiejar.Cookie(0,cookie['name'],cookie['value'],None,False,cookie['domain'],True,cookie['domain'].startswith('.'),cookie.get('path','/'),True,cookie.get('secure',True),int(cookie['expires']) if cookie.get('expires',0)>0 else None,False,None,None,{}))
        try:info=ydl.extract_info(url,download=False)
        except Exception as error:raise ModelCapabilityError('The video site could not provide playable media. It may require sign-in, be private, restricted, or block this cloud worker. Use this agent’s saved browser login or upload the video. A caption was not used as a substitute.') from error
    if info.get('_type') in {'playlist','multi_video'}:
        entries=[x for x in info.get('entries',[]) if x]
        if len(entries)!=1:raise ModelCapabilityError('This post has multiple media items. Send a single reel or upload the video you want analyzed.')
        info=entries[0]
    duration=float(info.get('duration') or 0)
    if not math.isfinite(duration) or not 0<=duration<=1800:raise ModelCapabilityError('Send a video of up to 30 minutes.')
    formats=info.get('requested_formats') or [info]
    if not formats or len(formats)>2:raise ModelCapabilityError('The site did not provide a supported video/audio format.')
    for item in formats:
        media_host(item.get('url',''),platform)
        if item.get('filesize',0) and item['filesize']>MAX_DOWNLOAD:raise ModelCapabilityError('This video exceeds the 100 MB processing limit. Upload a shorter clip.')
    return platform,formats


async def download_media(url,root,bot_id):
    from app.services.tools.registry import _browser_tool
    state=await _browser_tool._load_state(bot_id) or {}
    cookies=state.get('cookies',[])
    try:
        platform,formats=await asyncio.wait_for(asyncio.to_thread(extract,url,cookies),90)
    except (ModelCapabilityError,TimeoutError):
        platform,formats=await browser_source(url,bot_id)
    jar=httpx.Cookies()
    domain='instagram.com' if platform=='instagram' else 'youtube.com'
    for cookie in cookies:
        host=cookie.get('domain','').lstrip('.')
        if host==domain or host.endswith('.'+domain):jar.set(cookie['name'],cookie['value'],domain=cookie['domain'],path=cookie.get('path','/'))
    paths=[];total=0
    async with httpx.AsyncClient(timeout=httpx.Timeout(30,read=30),follow_redirects=False,cookies=jar) as client:
        for n,item in enumerate(formats):
            target=item['url'];path=Path(root)/f'source-{n}'
            for attempt in range(4):
                await validate_media_url(target,platform)
                headers={k:v for k,v in (item.get('http_headers') or {}).items() if k.lower() in {'user-agent','referer','accept'}}
                async with client.stream('GET',target,headers=headers) as response:
                    if response.is_redirect:
                        target=str(response.url.join(response.headers.get('location','')));continue
                    if response.status_code!=200:raise ModelCapabilityError('The video site refused the media download. Sign in through this agent’s browser or upload the clip.')
                    if int(response.headers.get('content-length','0'))+total>MAX_DOWNLOAD:raise ModelCapabilityError('This video exceeds the 100 MB processing limit.')
                    with path.open('wb') as output:
                        async for chunk in response.aiter_bytes(262144):
                            total+=len(chunk)
                            if total>MAX_DOWNLOAD:raise ModelCapabilityError('This video exceeds the 100 MB processing limit.')
                            output.write(chunk)
                    break
            else:raise ModelCapabilityError('The video site redirected too many times.')
            paths.append((path,item.get('vcodec')!='none'))
    videos=[path for path,is_video in paths if is_video]
    audio=next((path for path,is_video in paths if not is_video),None)
    if not videos:raise ModelCapabilityError('The media source contained no video frames.')
    return videos[0],audio


async def browser_source(url,bot_id):
    """A site may accept its normal browser while refusing the media extractor."""
    from app.services.tools.registry import _browser_tool
    platform='instagram' if 'instagram.com/' in url else 'youtube'
    await _browser_tool._get_page(bot_id)
    page=await _browser_tool._contexts[bot_id].new_page()
    responses=[]
    def observe(response):
        if 'video/' in response.headers.get('content-type',''):
            try:media_host(response.url,platform);responses.append(response.url)
            except ModelCapabilityError:pass
    page.on('response',observe)
    try:
        await page.goto(url,wait_until='domcontentloaded',timeout=30000)
        try:await page.wait_for_function("document.querySelector('video')?.readyState >= 1 || document.querySelector('meta[property=\"og:video\"]')",timeout=15000)
        except Exception:pass
        sources=await page.evaluate("""code => {
          let matched=[],seen=0;
          function walk(value,depth=0){
            if(!value||typeof value!=='object'||depth>45||seen++>80000)return;
            if((value.code===code||value.shortcode===code)&&(value.video_url||value.video_versions?.length))
              matched=[value.video_url||value.video_versions[0].url];
            for(const child of Object.values(value))walk(child,depth+1);
          }
          // Match the requested post, not unrelated videos prefetched in its feed.
          for(const script of document.querySelectorAll('script[type="application/json"]'))
            if(script.textContent.length<6000000)try{walk(JSON.parse(script.textContent))}catch{}
          return matched.length?matched:[document.querySelector('video')?.currentSrc,document.querySelector('meta[property="og:video"]')?.content,document.querySelector('meta[property="og:video:url"]')?.content].filter(v=>v?.startsWith('https://'));
        }""",urlsplit(url).path.strip('/').split('/')[-1])
        candidates=sources or responses
        unique={}
        for source in candidates:
            try:
                media_host(source,platform);parsed=urlsplit(source);unique[(parsed.hostname,parsed.path)]=source
            except ModelCapabilityError:pass
        if len(unique)!=1:raise ModelCapabilityError('The video site did not expose one identifiable playable video to this agent’s browser. Sign in through this agent’s Instagram/YouTube browser connection, or upload the clip. Its caption is not video evidence.')
        source=next(iter(unique.values()))
        return platform,[{'url':source,'vcodec':'unknown','http_headers':{'Referer':url,'User-Agent':await page.evaluate('navigator.userAgent')}}]
    finally:await page.close()
