import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp} from './server.mjs'

test('A7 同号并发、丢失响应重试、账号配额、全站预算和结果未知',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'story-a7-'))
  const file=join(dir,'test.sqlite')
  let app,base,now=Date.UTC(2026,10,15)
  async function start(){
    app=createApp(file,()=>now,async()=> 'test-key')
    await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve))
    base='http://127.0.0.1:'+app.address().port+'/api/mini/'
  }
  await start()
  const db=new DatabaseSync(file)
  t.after(async()=>{await new Promise(r=>app.close(r));db.close();await rm(dir,{recursive:true,force:true})})
  db.exec("UPDATE model_settings SET model='wanx2.0-t2i-turbo',credential='fake',budget_cents=8,quota=1 WHERE id=1")
  const localFetch=globalThis.fetch
  let submissions=0
  t.mock.method(globalThis,'fetch',async(url)=>{
    if(String(url).endsWith('/chat/completions'))return Response.json({choices:[{message:{content:'{"approved":true}'}}]})
    assert.ok(String(url).endsWith('/image-synthesis'))
    submissions++
    throw Error('模拟供应商收到提交后连接断开')
  })
  const post=(route,data,token='')=>localFetch(base+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)})
  async function family(username){
    const {token}=await (await post('register',{username,password:'test1234'})).json()
    const {id}=await (await post('start',{},token)).json()
    return {id,token}
  }
  const [a,b,c]=await Promise.all(['alpha','bravo','charlie'].map(family))
  const cell=(family,key)=>post('cell',{id:family.id,text:'一起看书',requestId:key},family.token)
  const count=()=>db.prepare('SELECT count(*) AS cells FROM cells').get().cells
  const ledger=()=>db.prepare('SELECT count(*) AS jobs,sum(cents) AS cents FROM image_jobs').get()
  const duplicates=await Promise.all([cell(a,'one'),cell(a,'one')])
  assert.deepEqual(duplicates.map(r=>r.status),[200,200])
  // Replay a committed request as if the client never received the first response.
  assert.equal((await cell(a,'one')).status,200)
  assert.equal(count(),1)
  assert.deepEqual({...ledger()},{jobs:1,cents:4})
  assert.equal((await cell(a,'two')).status,409)
  const race=await Promise.all([cell(b,'last'),cell(c,'last')])
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409])
  assert.equal(count(),2)
  assert.deepEqual({...ledger()},{jobs:2,cents:8})
  for(let i=0;i<60 && db.prepare("SELECT count(*) AS n FROM image_jobs WHERE status='unknown'").get().n<2;i++)
    await new Promise(r=>setTimeout(r,50))
  assert.equal(submissions,2)
  const jobs=db.prepare('SELECT id,cell,status FROM image_jobs ORDER BY id').all()
  assert.deepEqual(jobs.map(j=>j.status),['unknown','unknown'])
  const retry={id:a.id,cell:jobs[0].cell,retryJob:jobs[0].id,text:'一起看书'}
  assert.equal((await post('retry-cell',retry,a.token)).status,409)
  await post('finish',{id:a.id},a.token)
  await post('save',{id:a.id,title:'我的书'},a.token)
  const shelf=await (await localFetch(base+'shelf',{headers:{Authorization:'Bearer '+a.token}})).json()
  assert.equal(shelf.books[0].title,'我的书')
  // Simulate a crash between sending a request and persisting its task ID.
  await new Promise(r=>app.close(r))
  db.prepare("UPDATE image_jobs SET status='sending' WHERE id=?").run(jobs[0].id)
  await start()
  now+=60000
  await new Promise(r=>setTimeout(r,650))
  assert.equal(db.prepare('SELECT status FROM image_jobs WHERE id=?').get(jobs[0].id).status,'unknown')
  assert.equal((await cell(a,'one')).status,200)
  assert.equal(submissions,2)
  assert.deepEqual({...ledger()},{jobs:2,cents:8})
})
