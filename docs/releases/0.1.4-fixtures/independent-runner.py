import pathlib,json,re,http.cookiejar,urllib.request,uuid,tempfile,hashlib,subprocess,time,concurrent.futures,collections
r=pathlib.Path(__file__).resolve().parent
class Host:
 def __init__(self,name):
  self.name=name;self.deployment=json.loads((r/'deployments.json').read_text())[name]
  url=re.search(r'dsh web: (http://\S+)',pathlib.Path(self.deployment['log']).read_text()).group(1);self.base=url.split('/?')[0]
  jar=http.cookiejar.MozillaCookieJar(str(r/f'{name}-cookies.private.txt'));self.op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));self.op.open(url).read();jar.save(ignore_discard=True)
 def rpc(self,method,payload):
  body={'type':'client-request','rpcId':str(uuid.uuid4()),'method':method,'payload':{'args':payload}}
  response=json.load(self.op.open(urllib.request.Request(self.base+'/api/'+method,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':self.base}),timeout=45))
  if not response['result']['ok']:raise RuntimeError(str(response['result']))
  return response['result']['value']
 def status(self,sid):return json.load(self.op.open(self.base+'/api/task-supervisor?sessionId='+sid,timeout=20))
 def events(self,sid,root=None):
  item=next(x for x in self.rpc('session/list',{'_request':{}})['items'] if x['sessionId']==sid);through=item['projections']['asOfSeq'];records=[];before=None
  while True:
   request={'address':{'kind':'subagent','parentSessionId':root,'childSessionId':sid,'mode':'unknown'} if root else {'kind':'session','sessionId':sid},'throughSeq':through,'maxMessages':1000}
   if before is not None:request['beforeSeq']=before
   page=self.rpc('session/page',{'request':request});records+=page['records']
   if not page['hasMore']:break
   events=[x['event']['seq'] for x in page['records'] if x['type']=='event'];assert events;before=min(events)
  events=sorted({x['event']['seq']:x['event'] for x in records if x['type']=='event'}.values(),key=lambda x:x['seq']);(r/f'{self.name}-{sid}.private.json').write_text(json.dumps(events,ensure_ascii=False));return item,events
 def prompt(self,sid,text):return self.rpc('session/prompt',{'request':{'requestId':str(uuid.uuid4()),'sessionId':sid,'mode':'queue','content':[{'type':'text','text':text}]}})
def execute(name):
 host=Host(name);prior=next((x for x in host.rpc('session/list',{'_request':{}})['items'] if x.get('blank') and pathlib.Path(x.get('cwd','')).name.startswith(f'dsh-overall-{name}-')),None);workspace=pathlib.Path(prior['cwd']) if prior else pathlib.Path(tempfile.mkdtemp(prefix=f'dsh-overall-{name}-')).resolve()
 workspace.joinpath('memo.md').write_text('# 会议记录\n\n日期：2026-10-09\n参与者：甲、乙\n决议：下周三提交初稿。\n');workspace.joinpath('input.json').write_text(json.dumps({'items':[{'label':'A','qty':3,'price':4},{'label':'B','qty':2,'price':5}]},ensure_ascii=False));workspace.joinpath('result.json').write_text(json.dumps({'sum':22}))
 originals={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in workspace.iterdir()}
 host.rpc('workspace/create',{'request':{'path':str(workspace)}})
 create={'sessionId':prior['sessionId']} if prior else host.rpc('session/create',{'request':{'cwd':str(workspace),'agentPreset':'standard'}});sid=create['sessionId']
 listed=next(x for x in host.rpc('session/list',{'_request':{}})['items'] if x['sessionId']==sid);assert listed['cwd']==str(workspace)
 registration='supervisor-overall-014-clean-20261009'
 subprocess.run(['python3','/Users/yuqixian/forever-skills/skills/dsh-plugin-isolated-test/scripts/environments.py','bind',registration,'--case',f'overall-{name}-paired-20261009','--workspace',str(workspace),'--session',sid,'--purpose','Matched static/data fixture pair, two Tasks in one Session; one approval each and no rescue'],capture_output=True,check=True)
 case={'name':name,'sessionId':sid,'workspace':str(workspace),'originalHashes':originals,'tasks':[]};(r/f'{name}-case.json').write_text(json.dumps(case,indent=2));print(json.dumps({'event':'bound','name':name,'sessionId':sid}),flush=True)
 prompts=[('calculation','只读验收 input.json 与 result.json。原始要求：items 各项 qty × price 合计必须为 22，result.json 的 sum 必须等于该合计；用中文给出核算依据。只检查现状，不修改任何文件。用一个节点规划，等待批准后执行，并提交节点与整体审查。',{'sum':22}),('negative','新建独立验收任务：只读核对 input.json 与 result.json。产品要求是 items 各项 qty × price 合计为 22，result.json 的 sum 必须等于该合计。只检查当前产物，不能修改文件；要求未满足时明确报告，并等待用户。只用一个节点规划。与前一任务的审查结论无关。',{'sum':22,'actualSum':23})]

 for kind,objective,oracle in prompts:
  while next(x for x in host.rpc('session/list',{'_request':{}})['items'] if x['sessionId']==sid)['running']:time.sleep(.2)
  tokenBaseline=next(x for x in host.rpc('session/list',{'_request':{}})['items'] if x['sessionId']==sid)['projections']['values'].get('tokenUsage')
  if kind=='negative':workspace.joinpath('result.json').write_text(json.dumps({'sum':23}));originals['result.json']=hashlib.sha256(workspace.joinpath('result.json').read_bytes()).hexdigest()
  start=time.time();receipt=host.rpc('commands/execute',{'agentId':sid,'line':'/task '+objective,'submittedAttachments':[]});assert receipt['result']['kind']=='success',receipt;approved=False;seen=None;lastprint=None;terminal=None
  while time.time()-start<900:
   state=host.status(sid);task=state.get('task')or{};seen=task.get('id')or seen
   if task.get('phase')=='awaiting-approval' and not approved:
    listed=next(x for x in host.rpc('session/list',{'_request':{}})['items'] if x['sessionId']==sid)
    if not listed['running']:
     receipt=host.rpc('commands/execute',{'agentId':sid,'line':'/task approve','submittedAttachments':[]})
     with (r/f'{name}-{kind}-approval-receipt.json').open('x') as f:json.dump(receipt,f,ensure_ascii=False,indent=2)
     assert receipt['result']['kind']=='success',receipt
     approved=True
   jobs=[j for j in state.get('reviewJobs',[]) if j['taskId']==seen]
   summary=(task.get('phase'),len(jobs),[(j['kind'],j['status']) for j in jobs])
   if str(summary)!=lastprint:
    print(json.dumps({'event':'state','name':name,'case':kind,'phase':task.get('phase'),'jobs':[(j['kind'],j['status']) for j in jobs]},ensure_ascii=False),flush=True);lastprint=str(summary)
   (r/f'{name}-status.private.json').write_text(json.dumps(state,ensure_ascii=False,indent=2))
   if task.get('phase') in ['complete','paused'] and not state.get('reviewing'):
    terminal=task.get('phase');break
   time.sleep(2)
  if terminal is None:
   terminal='deadline';host.rpc('commands/execute',{'agentId':sid,'line':'/task pause','submittedAttachments':[]})
  for settle in range(150):
   if not any(x['running'] for x in host.rpc('session/list',{'_request':{}})['items'] if x['sessionId']==sid):break
   time.sleep(.2)
  rootitem,events=host.events(sid);tokens={sid:rootitem['projections']['values'].get('tokenUsage')};details=[]
  for j in jobs:
   child,log=host.events(j['reviewerSessionId'],sid);tokens[j['reviewerSessionId']]=child['projections']['values'].get('tokenUsage');calls=[e for e in log if e['type']=='tool/call'];reads=[e for e in calls if e['data']['name'].startswith(('read_','inspect_','list_'))];repeated=sum(n-1 for n in collections.Counter((e['data']['name'],e['data']['arguments']) for e in reads).values())
   headers=[e['data'].get('header', {}).get('config') for e in log if e['type']=='request/header'];reqs=(j.get('decision')or{}).get('requirements')
   details.append({'id':j['id'],'kind':j['kind'],'status':j['status'],'attempt':j['attempt'],'reviewerSessionId':j['reviewerSessionId'],'cutoff':j['cutoff'],'startedAt':j['startedAt'],'finishedAt':j['finishedAt'],'verdict':(j.get('decision')or{}).get('verdict'),'fault':j.get('fault'),'model':j.get('model'),'requestHeaders':headers,'toolCalls':len(calls),'failedToolResults':sum(e['type']=='tool/result' and e['data']['message'].get('isError',False) for e in log),'repeatedReads':repeated,'faultRetries':(j.get('recovery')or{}).get('consumed'),'readCorrections':(j.get('readCorrections')or{}).get('consumed'),'protocolRepairs':(j.get('recovery')or{}).get('protocolRepairs'),'requirementCount':len(reqs) if reqs else None,'independentChecks':len((j.get('verification')or{}).get('checks',[])),'independentEvidenceCount':sum(len(x['evidence']) for x in reqs if x['method']!='log') if reqs else None})
  unchanged=set(p.name for p in workspace.iterdir())==set(originals) and all(hashlib.sha256((workspace/f).read_bytes()).hexdigest()==h for f,h in originals.items())
  output=json.dumps([e['data'] for e in events if e['type']=='assistant/message'],ensure_ascii=False)
  contentCorrect=('2026-10-09' in output and '初稿' in output) if kind=='static' else re.search(r'(?<!\d)22(?!\d)',output) is not None
  result={'name':name,'case':kind,'sessionId':sid,'taskId':seen,'terminal':terminal,'elapsedSeconds':round(time.time()-start,3),'initialApprovals':int(approved),'userOperations':2 if approved else 1,'oracle':oracle,'artifactUnchanged':unchanged,'contentCorrect':contentCorrect,'reward':int(terminal=='complete' and unchanged and contentCorrect) if kind!='negative' else int(terminal!='complete' and unchanged),'jobs':details,'tokens':tokens,'rootTokenBaseline':tokenBaseline,'primaryRequestHeaders':[e['data'].get('header', {}).get('config') for e in events if e['type']=='request/header'],'falseAcceptance':None,'falsePause':None,'grading':'Local deterministic development oracle; not a public benchmark'}
  with (r/f'{name}-{kind}-result.json').open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
  case['tasks'].append({'kind':kind,'taskId':seen,'terminal':terminal});(r/f'{name}-case.json').write_text(json.dumps(case,indent=2));print(json.dumps({'event':'sealed','name':name,'case':kind,'terminal':terminal,'reward':result['reward']},ensure_ascii=False),flush=True)
  if terminal!='complete':break
 return case
if __name__=='__main__':
 frozen={'candidateRuntimeCommit':'52dcbb0','mode':'independent','order':['calculation','negative'],'repeats':1,'taskDeadlineSeconds':900,'initialApprovals':1,'rescue':False,'route':'deepseek-codebuddy/deepseek-v4.1-flash','frequency':'unchanged defaults','deployments':json.loads((r/'deployments.json').read_text())}
 if (r/'comparison-freeze.json').exists():assert json.loads((r/'comparison-freeze.json').read_text())==frozen
 else:
  with (r/'comparison-freeze.json').open('x') as f:json.dump(frozen,f,indent=2)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  for value in pool.map(execute,['independent']):pass
