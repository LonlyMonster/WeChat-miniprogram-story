import test from 'node:test'
import {randomUUID} from 'node:crypto'
process.env.STORY_INITIAL_ADMIN_PASSWORD = randomUUID()
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createApp} from './server.mjs'

test('A8 候选隔离、失败和放弃、并发采用、首格封面',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'story-edit-'))
  const file=join(dir,'test.sqlite')
  let now=Date.now()
  const app=createApp(file,()=>now,async()=>'fake')
  await new Promise(r=>app.listen(0,'127.0.0.1',r))
  const db=new DatabaseSync(file)
  t.after(async()=>{await new Promise(r=>app.close(r));db.close();await rm(dir,{recursive:true,force:true})})
  const http=globalThis.fetch
  let failNextDownload=false
  const png=Buffer.from('89504e470d0a1a0a','hex')
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).endsWith('/chat/completions')){
      const {messages}=JSON.parse(options.body)
      return Response.json({choices:[{message:{content:JSON.stringify({approved:messages[1].content!=='拒绝样本'})}}]})
    }
    if(String(url).endsWith('/multimodal-generation/generation')){
      if(JSON.parse(options.body).input.messages[0].content[0].text.includes('拒绝样本'))return Response.json({code:'DataInspectionFailed'},{status:400})
      return Response.json({output:{choices:[{message:{content:[{image:'https://test.aliyuncs.com/art'}]}}]}})
    }
    assert.equal(String(url),'https://test.aliyuncs.com/art')
    if(failNextDownload){
      failNextDownload=false
      throw Error('临时下载失败')
    }
    return new Response(png)
  })
  let token=''
  const call=(route,data,auth=token)=>http('http://127.0.0.1:'+app.address().port+'/api/mini/'+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(data)})
  async function ok(route,data){const r=await call(route,data);assert.equal(r.status,200);return r.json()}
  const other=(await ok('register',{username:'neighbor',password:'test1234'})).token
  token=(await ok('register',{username:'family',password:'test1234'})).token
  const {id}=await ok('start',{})
  for(const text of ['首格','次格'])await ok('cell',{id,text,requestId:text})
  now+=10000
  await ok('finish',{id});await ok('save',{id,title:'故事'})
  const book=()=>ok('story/'+id)
  const initial=(await book()).cells
  const cell=initial[0].id
  const original=Buffer.from(await (await call('media/'+cell)).arrayBuffer())
  db.exec("UPDATE model_settings SET model='qwen-image-2.0',credential='fake',budget_cents=1000,quota=100 WHERE id=1")
  async function generate(text,cell=initial[0].id){
    const data={id,cell,version:0,text,requestId:text}
    const v=await ok('candidate',data)
    assert.equal((await ok('candidate',data)).job,v.job)
    return {id,cell,job:v.job}
  }
  async function wait(v,status){
    for(let i=0;i<90;i++){
      now+=1000
      if((await ok('candidate-status',v)).status===status)return
      await new Promise(r=>setTimeout(r,50))
    }
    assert.fail('候选未就绪')
  }
  const denied=await generate('拒绝样本')
  await wait(denied,'failed')
  assert.equal((await call('candidate-media/'+denied.job)).status,404)
  await ok('discard',denied)
  const secondArt=Buffer.from(await (await call('media/'+initial[1].id)).arrayBuffer())
  const discarded=await generate('放弃样本',initial[1].id)
  await wait(discarded,'done')
  const jobCount=()=>db.prepare('SELECT count(*) AS n FROM image_jobs').get().n
  const beforeReview=jobCount()
  db.prepare("UPDATE image_jobs SET status='withheld',error='适龄审核暂不可用',task=? WHERE id=?").run('https://test.aliyuncs.com/art',discarded.job)
  assert.equal((await call('retry-candidate-review',discarded,other)).status,404)
  now+=16*60*1000
  failNextDownload=true
  await ok('retry-candidate-review',discarded)
  await wait(discarded,'done')
  assert.equal(jobCount(),beforeReview)
  assert.equal((await call('candidate-media/'+discarded.job,undefined,other)).status,404)
  await ok('discard',discarded)
  assert.deepEqual((await book()).cells,initial)
  const a=await generate('新图文'),b=await generate('另一版本')
  await wait(a,'done');await wait(b,'done')
  assert.deepEqual(Buffer.from(await (await call('media/'+cell)).arrayBuffer()),original)
  const results=await Promise.all([call('adopt',a),call('adopt',b)])
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
  const updated=(await book()).cells
  assert.equal(updated[0].version,1)
  assert.equal(updated[0].text,results[0].status===200?'新图文':'另一版本')
  assert.deepEqual(updated[1],initial[1])
  assert.deepEqual(Buffer.from(await (await call('media/'+initial[1].id)).arrayBuffer()),secondArt)
  const cover=(await ok('shelf')).books[0].cover
  assert.deepEqual(Buffer.from(await (await call('media/'+cover)).arrayBuffer()),png)
  const queued=db.prepare("INSERT INTO image_jobs(cell,status,is_candidate,next) VALUES(?,'queued',1,?)").run(cell,now+60000).lastInsertRowid
  db.prepare("INSERT INTO candidates(job,cell,base,request,text) VALUES(?,?,1,'pending','新草稿')").run(queued,cell)
  const description=db.prepare('SELECT scene_description FROM cells WHERE id=?')
  const before=description.get(cell).scene_description
  assert.ok(before)
  await ok('caption',{id,cell,version:1,text:'修正图注'})
  assert.equal(description.get(cell).scene_description,before)
  assert.equal(db.prepare('SELECT status FROM image_jobs WHERE id=?').get(queued).status,'failed')
  assert.equal(db.prepare('SELECT job FROM candidates WHERE job=?').get(queued),undefined)
})
test('到期草稿任务与后续故事格隔离',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'story-expiry-'))
  const file=join(dir,'test.sqlite')
  let now=Date.now()
  const app=createApp(file,()=>now)
  const db=new DatabaseSync(file)
  await new Promise(r=>app.listen(0,'127.0.0.1',r))
  t.after(async()=>{await new Promise(r=>app.close(r));db.close();await rm(dir,{recursive:true,force:true})})
  const uid=db.prepare("SELECT id FROM users WHERE name='admin'").get().id
  db.prepare("INSERT INTO stories(id,uid,started) VALUES('expired',?,?)").run(uid,now)
  db.exec("INSERT INTO cells(story,text) VALUES('expired','旧正文')")
  const cell=db.prepare('SELECT id FROM cells').get().id
  db.prepare("INSERT INTO image_jobs(cell,status,next) VALUES(?,'poll',?)").run(cell,now+3*86400000)
  now+=86400000
  await fetch('http://127.0.0.1:'+app.address().port+'/api/mini/me')
  assert.equal(db.prepare('SELECT count(*) AS n FROM cells').get().n,0)
  db.prepare("INSERT INTO stories(id,uid) VALUES('new',?)").run(uid)
  db.prepare("INSERT INTO cells(id,story,text) VALUES(?,'new','新正文')").run(cell)
  assert.equal(db.prepare("UPDATE cells SET art=X'01' WHERE id=(SELECT cell FROM image_jobs LIMIT 1)").run().changes,0)
})
