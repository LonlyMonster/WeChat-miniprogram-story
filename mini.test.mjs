import test from 'node:test'
import {randomUUID} from 'node:crypto'
process.env.STORY_INITIAL_ADMIN_PASSWORD = randomUUID()
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {initAdmin} from './accounts.mjs'
import {createApp} from './server.mjs'

test('历史重名不能提升权限',async()=>{
 const db=new DatabaseSync(':memory:')
 try{
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT UNIQUE,salt BLOB,hash BLOB); INSERT INTO users(name) VALUES('Admin')")
  assert.throws(()=>initAdmin(db),/冲突/)
  assert.equal(db.prepare('SELECT role FROM users').get().role,'family')
 }finally{db.close()}
})
test('小程序角色分流、后台隔离、双端改密、退出',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'story-mini-')),path=join(dir,'test.sqlite')
 let server=createApp(path)
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})})
 async function call(action,data,token=''){
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/mini/'+action,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data&&JSON.stringify(data)})
  return {status:r.status,...await r.json()}
 }
 assert.equal((await call('register',{username:' ADMIN ',password:'test'})).status,409)
 const {token:family}=await call('register',{username:'family',password:'original'})
 assert.equal((await call('me',undefined,family)).role,'family')
 assert.equal((await call('shelf',undefined,family)).status,200)
 for(const path of ['admin/users','admin/config'])assert.equal((await call(path,undefined,family)).status,403)
 const creds={username:'admin',password:process.env.STORY_INITIAL_ADMIN_PASSWORD}
 const admin=await call('login',creds),second=await call('login',creds)
 assert.equal(admin.role,'admin')
 assert.equal((await call('shelf',undefined,admin.token)).status,403)
 assert.equal((await call('admin/users',undefined,admin.token)).users.length,2)
 const {id}=await call('start',{},family)
 assert.equal((await call('delete',{id},family)).status,409)
 assert.equal((await call('cell',{id,text:'小兔看书',requestId:'first'},family)).status,200)
 await call('finish',{id},family)
 assert.equal((await call('resume',{id},family)).status,200)
 assert.equal((await call('story/'+id,undefined,family)).state,'draft')
 assert.equal((await call('cell',{id,text:'小兔翻页',requestId:'second'},family)).status,200)
 assert.equal((await call('finish',{id},family)).status,200)
 await call('save',{id,title:'森林'},family)
 assert.equal((await call('rename',{id,title:'森林里的书'},family)).status,200)
 assert.equal((await call('story/'+id,undefined,family)).title,'森林里的书')
 const other=await call('register',{username:'neighbor',password:'neighbor'})
 assert.equal((await call('delete',{id},other.token)).status,404)
 const [firstCell]=(await call('story/'+id,undefined,family)).cells
 const caption={id,cell:firstCell.id,version:firstCell.version,text:'小兔轻轻翻开了森林里的第一本故事书。'}
 assert.equal((await call('caption',caption,other.token)).status,404)
 assert.equal((await call('caption',{...caption,text:'字'.repeat(101)},family)).status,400)
 assert.equal((await call('caption',caption,family)).status,200)
 assert.equal((await call('caption',{...caption,text:'旧版修改'},family)).status,409)
 assert.equal((await call('story/'+id,undefined,family)).cells[0].text,caption.text)
 const shelf=(await call('shelf',undefined,family)).books
 assert.equal(shelf.length,1)
 const db=new DatabaseSync(path)
 const {id:cover}=db.prepare('SELECT id FROM cells WHERE story=? ORDER BY id LIMIT 1').get(id)
 db.prepare('UPDATE cells SET art=? WHERE id=?').run(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),cover)
 db.close()
 const coverUrl='http://127.0.0.1:'+server.address().port+'/api/mini/cover/'+cover
 const ownCover=await fetch(coverUrl,{headers:{Authorization:'Bearer '+family}})
 assert.equal(ownCover.status,200)
 assert.equal(ownCover.headers.get('content-type'),'image/svg+xml')
 const otherCover=await fetch(coverUrl,{headers:{Authorization:'Bearer '+other.token}})
 assert.equal(otherCover.status,404)
 assert.equal((await call('delete',{id},family)).status,200)
 assert.equal((await call('shelf',undefined,family)).books.length,0)
 assert.equal((await call('story/'+id,undefined,family)).status,404)
 for(const route of ['admin/config','admin/reset'])assert.equal((await call(route,{},family)).status,403)
 const victim={username:'delete-test',password:'test-pass'}
 const {token:owner}=await call('register',victim)
 const {users}=await call('admin/users',undefined,admin.token)
 const deletion={username:victim.username,accountKey:users.find(u=>u.name===victim.username).account_key}
 const saved=await call('start',{},owner)
 await call('cell',{id:saved.id,text:'作品',requestId:'saved'},owner)
 await call('finish',{id:saved.id},owner)
 await call('save',{id:saved.id,title:'作品'},owner)
 const draft=await call('start',{},owner)
 await call('cell',{id:draft.id,text:'草稿',requestId:'draft'},owner)
 assert.equal((await call('admin/delete-user',deletion,family)).status,403)
 assert.notEqual((await call('admin/delete-user',{username:'admin',accountKey:deletion.accountKey},admin.token)).status,200)
 assert.equal((await call('admin/delete-user',deletion,admin.token)).status,200)
 assert.equal((await call('me',undefined,owner)).status,401)
 assert.equal((await call('login',victim)).status,401)
 const inspect=new DatabaseSync(path,{readOnly:true})
 try{
   for(const id of [draft.id,saved.id]){
     assert.equal(inspect.prepare('SELECT id FROM stories WHERE id=?').get(id),undefined)
     assert.equal(inspect.prepare('SELECT id FROM cells WHERE story=?').get(id),undefined)
   }
 }finally{inspect.close()}
 const replacement=await call('register',victim)
 assert.equal((await call('admin/reset',deletion,admin.token)).status,404)
 assert.equal((await call('admin/delete-user',deletion,admin.token)).status,404)
 assert.equal((await call('shelf',undefined,replacement.token)).books.length,0)
 const {config}=await call('admin/config',undefined,admin.token)
 const settings={model:config.model,budget:3.25,quota:10,version:config.version,key:'test-credential'}
 const written=await call('admin/config',settings,admin.token)
 assert.equal(written.status,200)
 assert.equal(written.config.configured,1)
 assert.equal(written.config.budget,3.25)
 assert.equal(JSON.stringify(written).includes(settings.key),false)
 assert.equal((await call('admin/config',{...settings,key:''},admin.token)).status,409)
 assert.equal((await call('admin/config',{...settings,key:'',version:written.config.version,quota:8},admin.token)).config.quota,8)
 const reset=await call('admin/reset',{username:'neighbor',accountKey:users.find(u=>u.name==='neighbor').account_key},admin.token)
 assert.equal(reset.status,200)
 assert.equal((await call('me',undefined,other.token)).status,401)
 const tempCredentials={username:'neighbor',password:reset.temporary}
 const limited=await call('login',tempCredentials)
 assert.equal(limited.mustChange,true)
 assert.equal((await call('shelf',undefined,limited.token)).status,403)
 assert.equal((await call('login',tempCredentials)).status,401)
 assert.equal((await call('password',{newPassword:'new-pass',confirmPassword:'new-pass'},limited.token)).status,200)
 assert.equal((await call('login',{username:'neighbor',password:'new-pass'})).mustChange,false)
 const change={currentPassword:process.env.STORY_INITIAL_ADMIN_PASSWORD,newPassword:'second-pass',confirmPassword:'second-pass'}
 assert.equal((await call('password',{...change,currentPassword:'wrong'},admin.token)).status,400)
 assert.equal((await call('password',change,admin.token)).status,200)
 for(const token of [admin.token,second.token])assert.equal((await call('me',undefined,token)).status,401)
 assert.equal((await call('login',creds)).status,401)
 await new Promise(r=>server.close(r))
 server=createApp(path)
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 assert.equal((await call('login',creds)).status,401)
 const again=await call('login',{...creds,password:'second-pass'})
 assert.equal(again.role,'admin')
 assert.equal((await call('me',undefined,family)).status,200)
 assert.equal((await call('close-account',{},again.token)).status,403)
 const closingBook=await call('start',{},family)
 await call('cell',{id:closingBook.id,text:'测试',requestId:'one'},family)
 await call('finish',{id:closingBook.id},family)
 await call('save',{id:closingBook.id,title:'测试'},family)
 const closingDraft=await call('start',{},family)
 const familySecond=await call('login',{username:'family',password:'original'})
 assert.equal((await call('close-account',{},family)).status,200)
 assert.equal((await call('me',undefined,familySecond.token)).status,401)
 assert.equal((await call('login',{username:'family',password:'original'})).status,401)
 const closedFamilyDb=new DatabaseSync(path,{readOnly:true})
 try{assert.equal(closedFamilyDb.prepare('SELECT count(*) AS n FROM stories WHERE id IN (?,?)').get(closingBook.id,closingDraft.id).n,0)}
 finally{closedFamilyDb.close()}
 await call('logout',{},again.token)
 assert.equal((await call('me',undefined,again.token)).status,401)
})
test('只接受受信直连代理覆盖的客户端 IP，并保留账号限流',async t=>{
 for(const trusted of [false,true]){
  if(trusted)process.env.STORY_TRUSTED_PROXY='127.0.0.1'
  else delete process.env.STORY_TRUSTED_PROXY
  const app=createApp(':memory:')
  delete process.env.STORY_TRUSTED_PROXY
  await new Promise(r=>app.listen(0,'127.0.0.1',r))
  try{
   async function login(name,address){
    return (await fetch('http://127.0.0.1:'+app.address().port+'/api/mini/login',{
     method:'POST',headers:{'Content-Type':'application/json','X-Real-IP':address},body:JSON.stringify({username:name,password:'test'})
    })).status
   }
   for(let i=1;i<=30;i++)assert.equal(await login('same','192.0.2.1'),401)
   assert.equal(await login('other','192.0.2.2'),trusted?401:429)
   assert.equal(await login('same','192.0.2.2'),429)
  }finally{await new Promise(r=>app.close(r))}
 }
})

test('书架只提供阅读入口，书内通过图标进入编辑后可直接点书名和插图', async () => {
  const template = page => readFile(new URL('./miniprogram/pages/' + page + '/index.wxml', import.meta.url), 'utf8')
  const [shelf, read] = await Promise.all([template('shelf'), template('read')])
  assert.doesNotMatch(shelf, /bindtap="remove"/)
  assert.match(read, /bindtap="remove"/)
  assert.match(read, /bindtap="toggleEditing"/)
  assert.match(read, /<button[^>]*bindtap="remove"[^>]*>\s*<image[^>]*src="\/watercolor\/delete\.png"/)
  assert.match(read, /<text[^>]*wx:elif="{{editing && !savingTitle}}"[^>]*bindtap="editTitle"/)
  assert.match(read, /<view class="read-art"[^>]*bindtap="{{editing \? 'edit' : 'preview'}}"/)
})
