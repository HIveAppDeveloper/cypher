"""Read connector links published by a website, without running its scripts."""
import asyncio
import json
import re
from html.parser import HTMLParser
from urllib.parse import urljoin,urlsplit
from app.services.plugins import validate_endpoint

class Links(HTMLParser):
    def __init__(self):super().__init__();self.urls=[]
    def handle_starttag(self,tag,attrs):
        item=dict(attrs)
        if tag=='link' and 'mcp' in (item.get('rel') or '').lower().split() and item.get('href'):self.urls.append(item['href'])

async def published_connector(host,client_factory):
    origin='https://'+host
    async def read(path):
        url=origin+path
        async with client_factory() as client:
            for _ in range(3):
                async with client.stream('GET',url,timeout=4) as response:
                    if response.status_code in (301,302,307,308):
                        target=urljoin(url,response.headers.get('location',''))
                        if (urlsplit(target).hostname or '').removeprefix('www.')!=host.removeprefix('www.'):return []
                        await validate_endpoint(target);url=target;continue
                    if response.status_code!=200:return []
                    content=bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content)>131072:break
                    candidates=[]
                    for match in re.finditer(r'<([^>]+)>\s*;\s*rel=["\']?mcp\b',response.headers.get('link',''),re.I):candidates.append(match.group(1))
                    if path.endswith('.json'):
                        try:
                            data=json.loads(content)
                            records=data.get('mcpServers',data.get('servers',[]))
                            records=list(records.values()) if isinstance(records,dict) else records
                            if isinstance(records,list):candidates.extend(r['url'] for r in records if isinstance(r,dict) and isinstance(r.get('url'),str))
                        except (ValueError,AttributeError):pass
                    else:
                        links=Links();links.feed(content.decode('utf-8',errors='replace'));candidates.extend(links.urls)
                    return [urljoin(url,item) for item in candidates]
        return []
    results=await asyncio.gather(read('/.well-known/mcp.json'),read('/'),return_exceptions=True)
    for candidates in results:
        if not isinstance(candidates,list):continue
        for url in candidates[:5]:
            try:await validate_endpoint(url)
            except (ValueError,OSError):continue
            return {'id':'website-'+host,'name':host,'url':url,'description':'Connector published by this website. Sign in to grant access to your account.','category':'Custom','domains':[host],'auth':'auto','source':origin}
    return None
