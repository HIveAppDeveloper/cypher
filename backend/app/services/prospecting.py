"""Bounded public encyclopedia research. No models, private scraping, or outreach."""
import asyncio
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit
import httpx
from sqlalchemy import select, or_
from app.db.tenancy import current_tenant_id
from app.models.prospecting import ProspectingRun
from app.models.plugin import Plugin
from app.services.plugins import validate_endpoint

API = 'https://en.wikipedia.org/w/api.php'
AKTA_API = 'https://api.akta.pro/api/v1/list/generate/companies/'
MAX_BYTES = 524288
TERMINAL = {'completed', 'partial', 'failed', 'cancelled'}
STOP_WORDS = {'the','and','for','with','from','that','this','into','your','our','are','you','company','companies','platform','product'}


def now():
    return datetime.now(timezone.utc).isoformat()


def database_now():
    # Persist UTC wall time in the existing naive DateTime columns.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def event(run, kind, **detail):
    run.events = [*(run.events or []), {'type':kind, 'at':now(), **detail}][-100:]


class SourceError(Exception):
    def __init__(self, code, retry_after=None, uncertain=False):
        self.code, self.retry_after, self.uncertain = code, retry_after, uncertain
        super().__init__(code)


async def wikipedia(params):
    # Fixed origin/path only. Redirects are rejected, never followed. Reuse the
    # shared HTTPS/public-DNS validator; callers cannot supply a target URL.
    try:
        async with asyncio.timeout(12):
            await validate_endpoint(API)
            async with httpx.AsyncClient(timeout=8, follow_redirects=False, headers={
                'User-Agent':'OpenGrokbotProspecting/0.1 (https://github.com/HIveAppDeveloper/open-grokbot)',
                'Accept':'application/json',
            }) as client:
                async with client.stream('GET', API, params={
                    'action':'query','format':'json','formatversion':'2','maxlag':'5', **params,
                }) as response:
                    if response.status_code == 429:
                        retry = response.headers.get('retry-after', '')
                        raise SourceError('rate_limited', int(retry) if retry.isdigit() else None)
                    if response.status_code != 200:
                        raise SourceError('source_http_'+str(response.status_code))
                    data = bytearray()
                    async for part in response.aiter_bytes():
                        data.extend(part)
                        if len(data) > MAX_BYTES: raise SourceError('response_too_large')
                    body = json.loads(data)
                    if not isinstance(body, dict): raise SourceError('invalid_source_response')
                    if body.get('error'): raise SourceError('source_api_error')
                    return body
    except SourceError:
        raise
    except (TimeoutError, httpx.TimeoutException):
        raise SourceError('source_timeout') from None
    except (httpx.HTTPError, ValueError, OSError):
        raise SourceError('source_unavailable') from None


def terms(text):
    return set(re.findall(r'[a-z0-9]{3,}', text.lower())) - STOP_WORDS


def candidate(page, run):
    title, extract = page.get('title',''), page.get('extract','')
    if not isinstance(title,str) or not isinstance(extract,str): return None
    if page.get('missing') or title.lower().startswith(('list of ', 'history of ')): return None
    # Explicit source wording is required before presenting an organization
    # candidate. This does not verify legal status, contact details, or demand.
    if not re.search(r'\b(?:is|was)\b[^.!?\n]{0,180}\b(company|corporation|firm|manufacturer|organization)\b', extract[:1200], re.I): return None
    pageid = page.get('pageid')
    if not isinstance(pageid,int) or pageid <= 0: return None
    url = 'https://en.wikipedia.org/wiki/'+quote(title.replace(' ','_'), safe='')
    matching = sorted(terms(run.market+' '+run.product) & terms(title+' '+extract))
    score = min(100, len(matching)*10)
    return {'id':'wikipedia-'+str(pageid), 'name':title, 'source_url':url,
            'retrieved_at':now(), 'observed':{'description':extract[:5000], 'source':'Wikipedia',
            'organization_status':'candidate based on source wording'},
            'inferred':{'fit_score':score, 'matched_terms':matching,
                'reason':'Lexical overlap with the supplied market/product; no buying intent is established.',
                'contributions':[{'term':term,'points':10,'source_url':url} for term in matching[:10]]},
            'contact':{'status':'needed','email':None,'source_url':None},
            'draft':None}


def run_uses_akta(run):
    return any(item.get('type') == 'queued' and item.get('use_akta') is True
               for item in (run.events or []) if isinstance(item,dict))


async def akta_list(run):
    """Paid, single-call company-list generation. The endpoint and key stay server-side."""
    from app.config import settings
    if not settings.AKTA_API_KEY:
        raise SourceError('source_not_configured')
    query = ('Find companies in this target market or audience: ' + run.market.strip() +
             '. The product being offered is: ' + run.product.strip())[:1200]
    try:
        await validate_endpoint(AKTA_API)
        async with asyncio.timeout(40):
            async with httpx.AsyncClient(timeout=32, follow_redirects=False, headers={
                'User-Agent':'CypherProspecting/1.0', 'Accept':'application/json',
                'Content-Type':'application/json', 'x-api-key':settings.AKTA_API_KEY,
            }) as client:
                async with client.stream('POST', AKTA_API, json={
                    'query':query, 'limit':min(run.limit,20), 'offset':0,
                }) as response:
                    if response.status_code == 429:
                        retry=response.headers.get('retry-after','')
                        raise SourceError('rate_limited',int(retry) if retry.isdigit() else None)
                    if response.status_code in (401,403): raise SourceError('source_auth_failed')
                    if response.status_code == 402: raise SourceError('credits_unavailable')
                    if response.status_code >= 500: raise SourceError('source_unavailable',uncertain=True)
                    if response.status_code != 200: raise SourceError('source_http_'+str(response.status_code))
                    data=bytearray()
                    async for part in response.aiter_bytes():
                        data.extend(part)
                        if len(data)>MAX_BYTES: raise SourceError('response_too_large',uncertain=True)
                    try: body=json.loads(data)
                    except (ValueError,UnicodeDecodeError): raise SourceError('invalid_source_response',uncertain=True) from None
                    if not isinstance(body,dict) or not isinstance(body.get('data'),list):
                        raise SourceError('invalid_source_response',uncertain=True)
                    consumed=body.get('credits_consumed')
                    if isinstance(consumed,bool) or not isinstance(consumed,(int,float)) or not math.isfinite(consumed) or consumed<0:
                        consumed=None
                    return body['data'][:min(run.limit,20)],consumed
    except SourceError:
        raise
    except (TimeoutError,httpx.TimeoutException):
        raise SourceError('source_timeout',uncertain=True) from None
    except (httpx.HTTPError,OSError):
        raise SourceError('source_unavailable',uncertain=True) from None


def akta_candidate(company, run, index):
    if not isinstance(company,dict): return None
    name=company.get('name') or company.get('company_name')
    if not isinstance(name,str) or not name.strip(): return None
    name=name.strip()[:300]
    website=company.get('website')
    source_url=''
    if isinstance(website,str) and len(website)<=2048:
        try:
            parsed=urlsplit(website if '://' in website else 'https://'+website)
            if parsed.scheme=='https' and parsed.hostname and not parsed.username and not parsed.password:
                source_url='https://'+parsed.netloc+parsed.path+('?' + parsed.query if parsed.query else '')
        except ValueError:
            pass
    details=[]
    for key in ('description','company_description','business_description','short_description','product_category','industry','company_status'):
        value=company.get(key)
        if isinstance(value,str) and value.strip() and value.strip() not in details:
            details.append(value.strip()[:500])
    description=' · '.join(details)[:3000] or 'Akta supplied this company record without a public description.'
    identity=company.get('uuid') or company.get('id')
    item_id=('akta-'+str(identity)[:72]) if isinstance(identity,(str,int)) and str(identity).strip() else 'akta-'+hashlib.sha256(f'{name}|{source_url}|{index}'.encode()).hexdigest()[:32]
    matching=sorted(terms(run.market+' '+run.product) & terms(name+' '+description))
    return {'id':item_id,'name':name,'source_url':source_url,'retrieved_at':now(),
            'observed':{'description':description,'source':'Akta','organization_status':'Company record returned by Akta; not independently verified'},
            'inferred':{'fit_score':min(100,len(matching)*10),'matched_terms':matching,
                'reason':'Akta generated this candidate list from the supplied market and product; text overlap only helps sort results. No buying intent is established.',
                'contributions':[{'term':term,'points':10,'source_url':source_url} for term in matching[:10] if source_url]},
            'contact':{'status':'needed','email':None,'source_url':None},'draft':None}


async def gmail_state(db):
    # Metadata only. Never trust global environment Gmail grants for a user.
    # Do not reload every connector's large tool catalog or encrypted grant on
    # each progress poll. Browser connectors are metadata, not draft capability.
    ids = (await db.execute(select(Plugin.id).where(
        Plugin.enabled.is_(True), Plugin.tenant_id == current_tenant_id.get(),
        or_(Plugin.name.ilike('%gmail%'), Plugin.url.ilike('%gmail%')),
    ))).scalars().all()
    return {'status':'connection_saved' if ids else 'connection_required', 'verified':False,
            'supported_draft':False, 'plugin_ids':ids,
            'detail':'Saved per-user Gmail connection metadata only. No typed Gmail draft API is available or verified; drafts stay in the app database.' if ids else 'Connect Gmail in Plugins for this account. No mailbox grant was created; no Gmail draft API is verified.'}



def snapshot(run, gmail=None):
    use_akta=run_uses_akta(run)
    saved=next((item for item in reversed(run.events or []) if isinstance(item,dict) and item.get('type')=='akta_results_saved'),None)
    return {'id':run.id,'market':run.market,'product':run.product,'limit':run.limit,
            'source':'Akta' if use_akta else 'Wikipedia API',
            'credits_consumed':saved.get('credits_consumed') if saved else None,
            'status':run.status,'created_at':run.created_at,'completed_at':run.completed_at,
            'results':run.results,'events':run.events,
            'gmail':gmail or {'status':'not_checked','verified':False},
            'sending':{'enabled':False,'review_required':True},
            'limitations':['Public encyclopedia company candidates only; coverage is incomplete.',
                            'Scores are lexical relevance, not verified interest or spending.',
                            'Drafts are stored in the app database; no Gmail draft or email is created.']}


async def recover(sessions):
    # Paid calls cannot be blindly replayed. Preserve saved results and fail an
    # interrupted Akta request if its billable outcome was not persisted.
    async with sessions() as db:
        rows=(await db.execute(select(ProspectingRun).where(ProspectingRun.status=='running'))).scalars().all()
        for row in rows:
            attempted=any(item.get('type')=='akta_request_started' for item in row.events or [] if isinstance(item,dict))
            saved=any(item.get('type')=='akta_results_saved' for item in row.events or [] if isinstance(item,dict))
            if run_uses_akta(row) and attempted and not saved:
                row.status='failed'; row.completed_at=database_now()
                event(row,'source_error',code='source_outcome_unknown',source='Akta',credits_unknown=True)
            else:
                row.status='pending'
        await db.commit()


async def tick(sessions):
    """One durable worker slice per call, with a commit after each public read."""
    async with sessions() as db:
        row = (await db.execute(select(ProspectingRun).where(ProspectingRun.status.in_(['pending','running','cancel_requested'])).order_by(ProspectingRun.created_at).limit(1).with_for_update(skip_locked=True))).scalar_one_or_none()
        if row is None: return False
        owner = current_tenant_id.set(row.tenant_id)
        try:
            if row.status == 'cancel_requested':
                row.status='cancelled'; row.completed_at=database_now(); event(row,'cancelled'); await db.commit(); return True
            if row.status == 'pending':
                source='Akta' if run_uses_akta(row) else 'Wikipedia API'
                row.status='running'; event(row,'started',source=source); await db.commit()
            try:
                if run_uses_akta(row):
                    if not any(item.get('type')=='akta_results_saved' for item in row.events or [] if isinstance(item,dict)):
                        event(row,'akta_request_started',source='Akta')
                        await db.commit()
                        companies,credits=await akta_list(row)
                        items=[]
                        for index,company in enumerate(companies):
                            item=akta_candidate(company,row,index)
                            if item and item['id'] not in {candidate['id'] for candidate in items}:
                                items.append(item)
                        row.candidates=[{'id':item['id']} for item in items]
                        row.results=sorted(items,key=lambda item:(-item['inferred']['fit_score'],item['name']))
                        row.cursor=len(row.candidates)
                        event(row,'akta_results_saved',count=len(row.results),source='Akta',
                              source_url='https://docs.akta.pro/docs/list-generation/overview',
                              credits_consumed=credits,retrieved_at=now())
                        await db.commit()
                    await db.refresh(row)
                    if row.status == 'cancel_requested':
                        row.status='cancelled'; row.completed_at=database_now(); event(row,'cancelled')
                    else:
                        row.status='completed'; row.completed_at=database_now(); event(row,'completed',count=len(row.results))
                    await db.commit()
                elif not row.candidates:
                    body = await wikipedia({'list':'search','srsearch':row.market+' company','srnamespace':'0','srlimit':str(row.limit)})
                    hits = body.get('query',{}).get('search')
                    if not isinstance(hits,list): raise SourceError('invalid_source_response')
                    row.candidates = [{'pageid':p['pageid']} for p in hits if isinstance(p,dict) and isinstance(p.get('pageid'),int)][:row.limit]
                    event(row,'discovered',count=len(row.candidates),source_url=API,retrieved_at=now())
                    await db.commit()
                elif row.cursor < len(row.candidates):
                    pageid = row.candidates[row.cursor]['pageid']
                    body = await wikipedia({'prop':'extracts','pageids':str(pageid),'exintro':'1','explaintext':'1','exchars':'5000'})
                    pages = body.get('query',{}).get('pages')
                    if not isinstance(pages,list): raise SourceError('invalid_source_response')
                    for page in pages[:1]:
                        if not isinstance(page,dict): raise SourceError('invalid_source_response')
                        item = candidate(page,row)
                        if item and item['id'] not in {r['id'] for r in row.results}:
                            row.results=sorted([*row.results,item],key=lambda r:(-r['inferred']['fit_score'],r['name']))
                            event(row,'result_saved',result_id=item['id'],source_url=item['source_url'],retrieved_at=item['retrieved_at'])
                        else: event(row,'candidate_skipped',pageid=pageid,reason='No organization wording or duplicate.')
                    row.cursor += 1
                    await db.commit()
                # Refresh cancellation after the HTTP boundary. Concurrent cancel
                # only updates status, and these JSON assignments cannot erase it.
                await db.refresh(row)
                if row.status == 'cancel_requested':
                    row.status='cancelled'; row.completed_at=database_now(); event(row,'cancelled')
                elif row.cursor >= len(row.candidates):
                    row.status='completed'; row.completed_at=database_now(); event(row,'completed',count=len(row.results))
                await db.commit()
            except (SourceError, TypeError, AttributeError, KeyError) as error:
                if not isinstance(error,SourceError): error=SourceError('invalid_source_response')
                await db.refresh(row)
                row.status='cancelled' if row.status=='cancel_requested' else ('partial' if row.results else 'failed')
                row.completed_at=database_now()
                event(row,'source_error',code=error.code,retry_after=error.retry_after,
                      source='Akta' if run_uses_akta(row) else 'Wikipedia API',
                      credits_unknown=bool(getattr(error,'uncertain',False)),
                      source_url=AKTA_API if run_uses_akta(row) else API)
                await db.commit()
        finally:
            current_tenant_id.reset(owner)
    # At most one Wikipedia request per second per single lock-owning worker.
    await asyncio.sleep(1)
    return True
