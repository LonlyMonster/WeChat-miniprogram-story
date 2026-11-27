import test from 'node:test'
import {randomUUID} from 'node:crypto'
process.env.STORY_INITIAL_ADMIN_PASSWORD = randomUUID()
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp} from './server.mjs'

for(const failure of ['text-denied','text-unavailable','scene-denied','image-denied','image-unavailable','provider-denied']){
  test('A6 '+failure,async t=>{
    const dir=await mkdtemp(join(tmpdir(),'story-a6-'))
    const path=join(dir,'test.sqlite')
    let now=Date.now()
    const app=createApp(path,()=>now,async()=> 'test-key')
    await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve))
    const db=new DatabaseSync(path)
    t.after(async()=>{await new Promise(resolve=>app.close(resolve));db.close();await rm(dir,{recursive:true,force:true})})
    db.exec("UPDATE model_settings SET model='qwen-image-2.0',credential='fake',quota=100,budget_cents=1000 WHERE id=1")
    const localFetch=globalThis.fetch
    let submissions=0,recovered=false
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      url=String(url)
      if(url.endsWith('/chat/completions')){
        const {messages}=JSON.parse(options.body)
        if(messages[0].content.includes('插画师只收到本格文字'))return Response.json({choices:[{message:{content:JSON.stringify({scene:'小兔坐着翻书'})}}]})
        const stage=Array.isArray(messages[1].content)?'image':messages[1].content==='小兔坐着翻书'?'scene':'text'
        if(!recovered && failure===stage+'-unavailable')return new Response(null,{status:503})
        return Response.json({choices:[{message:{content:JSON.stringify({approved:recovered || failure!==stage+'-denied'})}}]})
      }
      if(url.endsWith('/multimodal-generation/generation')){
        submissions++
        if(!recovered && failure==='provider-denied')return Response.json({code:'DataInspectionFailed'},{status:400})
        return Response.json({output:{choices:[{message:{content:[{image:'https://test.aliyuncs.com/image'}]}}]}})
      }
      assert.equal(url,'https://test.aliyuncs.com/image')
      return new Response(Buffer.from('89504e470d0a1a0a','hex'))
    })
    let token=''
    async function call(route,data){
      return localFetch('http://127.0.0.1:'+app.address().port+'/api/mini/'+route,{method:data?'POST':'GET',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)})
    }
    async function ok(route,data){
      const response=await call(route,data)
      assert.equal(response.status,200)
      return response.json()
    }
    token=(await ok('register',{username:'family',password:'example'})).token
    const {id}=await ok('start',{})
    const original=failure==='provider-denied'?'雷欧到特曼来到了地球':'小兔在看书'
    await ok('cell',{id,text:original,requestId:'first'})
    async function waitCell(predicate){
      for(let i=0;i<90;i++){
        now+=1000
        const {cells}=await ok('story/'+id)
        if(predicate(cells[0]))return cells[0]
        await new Promise(r=>setTimeout(r,50))
      }
      assert.fail('等待队列状态超时')
    }
    const cell=await waitCell(c=>c.error)
    assert.equal(cell.text,original)
    assert.equal(cell.ready,0)
    assert.ok(cell.retryJob)
    assert.equal((await call('media/'+cell.id)).status,404)
    const expected=failure==='provider-denied'?'本格未通过绘图服务的内容审核，请修改描述后重试':failure.endsWith('unavailable')?'适龄审核暂不可用':failure.startsWith('text')?'本格文字未通过适龄审核':failure==='scene-denied'?'画面描述未通过适龄审核':'本格图片未通过适龄审核'
    assert.equal(cell.error,expected)
    assert.equal(submissions,failure.startsWith('text')||failure==='scene-denied'?0:1)
    assert.equal((await call('finish',{id})).status,409)
    recovered=true
    const text=failure==='image-unavailable'?original:'小兔在读绘本'
    const retry={id,cell:cell.id,retryJob:cell.retryJob,text}
    await ok('retry-cell',retry)
    assert.equal((await call('retry-cell',retry)).status,409)
    const ready=await waitCell(c=>c.ready)
    assert.equal(ready.id,cell.id)
    assert.equal(ready.text,text)
    assert.equal((await ok('story/'+id)).cells.length,1)
    assert.equal(submissions,['image-denied','provider-denied'].includes(failure)?2:1)
    assert.equal((await call('media/'+cell.id)).status,200)
  })
}
