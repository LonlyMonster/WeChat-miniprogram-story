import test from 'node:test'
import {randomUUID} from 'node:crypto'
process.env.STORY_INITIAL_ADMIN_PASSWORD = randomUUID()
import assert from 'node:assert/strict'
import { createApp } from './server.mjs'

test('五格成书、断线重试、家庭隔离与固定草稿期限', async t => {
  let now = Date.now()
  const app = createApp(':memory:', () => now)
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => app.close(resolve)))
  const base = 'http://127.0.0.1:' + app.address().port
  function browser() {
    let cookie = '', csrf = ''
    return async (path, body) => {
      const response = await fetch(base + '/api/' + path, {
        method: body ? 'POST' : 'GET',
        headers: {cookie, 'content-type':'application/json', 'x-csrf-token':csrf, origin:base},
        body: body && JSON.stringify(body)
      })
      cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie
      const data = await response.json()
      csrf = data.csrf ?? csrf
      return {status: response.status, ...data}
    }
  }
  const a = browser(), b = browser(), credentials = {username:'甲', password:'test-pass'}
  assert.equal((await a('register', credentials)).status, 200)
  assert.equal((await b('register', {...credentials, username:'乙'})).status, 200)
  const {id} = await a('start', {})
  assert.equal((await a('shelf')).draft,null)
  assert.equal((await a('start',{})).id,id)
  assert.equal((await a('cell',{id,text:'字'.repeat(101),requestId:'long'})).status,400)
  for (let i=0; i<5; i++) {
    const input = {id, text:'故事'+i, requestId:'request-'+i}
    assert.equal((await a('cell', input)).status, 200)
    await a('cell', input)
  }
  assert.equal((await b('story/'+id)).status, 404)
  assert.deepEqual((await a('shelf')).draft,{id,state:'draft'})
  assert.equal((await a('save',{id,title:'早了'})).status, 409)
  await a('finish',{id})
  assert.deepEqual((await a('shelf')).draft,{id,state:'ended'})
  assert.equal((await a('save',{id,title:'  '})).status, 400)
  assert.equal((await a('save',{id,title:'字'.repeat(11)})).status,400)
  await a('save',{id,title:'五格'})
  await a('save',{id,title:'五格'})
  assert.equal((await a('shelf')).books.length, 1)
  const second = browser()
  await second('login', credentials)
  const story = await second('story/'+id)
  assert.deepEqual(story.cells.map(c=>c.text), Array.from({length:5},(_,i)=>'故事'+i))
  const draft = await a('start',{})
  await a('cell',{id:draft.id,text:'临时',requestId:'draft-1'})
  now += 86400000
  await a('login',credentials)
  assert.equal((await a('shelf')).draft,null)
  assert.equal((await a('story/'+draft.id)).status,404)
  assert.equal((await a('story/'+id)).status,200)
  await a('logout',{})
  assert.equal((await a('shelf')).status,401)
})
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('服务重启后继续出图、按序取封面并持久重读', async t => {
  const folder=await mkdtemp(join(tmpdir(),'story-test-'))
  const file=join(folder,'test.sqlite')
  let now=Date.now(), server, base, cookie, csrf
  async function boot(){
    server=createApp(file,()=>now)
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    base='http://127.0.0.1:'+server.address().port
  }
  const close=()=>new Promise(resolve=>server.close(resolve))
  await boot()
  t.after(async()=>{await close();await rm(folder,{recursive:true,force:true})})
  const call=(path,body)=>fetch(base+'/api/'+path,{
    method:body?'POST':'GET',headers:{cookie:cookie||'','content-type':'application/json','x-csrf-token':csrf||''},
    body:body && JSON.stringify(body)
  })
  for(const path of ['/','/app.js','/style.css','/forest.svg','/book-mark.svg']){
    assert.equal((await fetch(base+path)).status,200)
  }
  const session=await call('register',{username:'测试',password:'secret'})
  cookie=session.headers.get('set-cookie').split(';')[0]
  csrf=(await session.json()).csrf
  const {id}=await (await call('start',{})).json()
  for(let i=0;i<2;i++) await call('cell',{id,text:'第'+i+'格',requestId:String(i)})
  await call('finish',{id})
  await call('save',{id,title:'测试封面'})
  now+=900
  const before=await (await call('story/'+id)).json()
  assert.deepEqual(before.cells.map(c=>c.ready),[0,1])
  assert.equal((await (await call('shelf')).json()).books[0].cover,null)
  await close()
  now+=5000
  await boot()
  const after=await (await call('shelf')).json()
  assert.equal(after.books[0].cover,before.cells[0].id)
  const path='media/'+after.books[0].cover
  assert.match(await (await call(path)).text(),/<svg/)
  assert.equal((await fetch(base+'/api/'+path)).status,401)
})
