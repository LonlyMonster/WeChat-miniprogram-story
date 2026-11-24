import {modelSettings,models} from './admin/server.mjs'
import http from 'node:http'
import {transcribePCM} from './speech.mjs'
import {generation,mediaType} from './generation.mjs'
import {DatabaseSync} from 'node:sqlite'
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto'
import {digest,initAdmin} from './accounts.mjs'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'


const day = 86400000
const assets = new Map([
  ['/', ['index.html','text/html']], ['/app.js',['app.js','text/javascript']],
  ...['style.css','forest.svg','book-mark.svg'].map(name=>['/'+name,['docs/ui/'+name,name.endsWith('.css')?'text/css':'image/svg+xml']])
])
function fail(status, message) { throw Object.assign(new Error(message), {status}) }
function required(value, message, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400,message)
  return value.trim()
}

async function input(req, maxBytes=65536) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'请使用 JSON')
  let size=0
  const parts=[]
  for await (const part of req) {
    size+=part.length
    if(size>maxBytes) fail(413,'输入过长')
    parts.push(part)
  }
  try {
    const body=JSON.parse(Buffer.concat(parts))
    if(body && typeof body==='object' && !Array.isArray(body)) return body
  } catch {}
  fail(400,'提交内容无效')
}

export function createApp(filename='stories.sqlite', clock=Date.now,readCredential) {
  const db=new DatabaseSync(filename)
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT UNIQUE, salt BLOB, hash BLOB);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, uid INTEGER REFERENCES users, csrf TEXT, created INTEGER, touched INTEGER);
    CREATE TABLE IF NOT EXISTS stories(id TEXT PRIMARY KEY, uid INTEGER REFERENCES users, state TEXT DEFAULT 'draft', title TEXT DEFAULT '', started INTEGER, saved INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS one_draft ON stories(uid) WHERE state!='saved';
    CREATE TABLE IF NOT EXISTS cells(id INTEGER PRIMARY KEY, story TEXT REFERENCES stories ON DELETE CASCADE, request TEXT, text TEXT, due INTEGER, art BLOB, UNIQUE(story,request));`)
  try { initAdmin(db) } catch (error) { db.close(); throw error }
  const query=sql=>db.prepare(sql)
  const settings=modelSettings(db)
  db.exec('CREATE TABLE IF NOT EXISTS reset_audit(at INTEGER,operator INTEGER,target INTEGER)')
  const jobs=generation(db,clock,readCredential)
  const limits=new Map()
  function eraseFamily(uid){
    // Keep billed jobs in the site budget without linking them to a future account or panel.
    query("UPDATE image_jobs SET uid=NULL,cell=NULL,status=CASE WHEN status='queued' THEN 'failed' ELSE status END WHERE uid=?").run(uid)
    query('DELETE FROM sessions WHERE uid=?').run(uid)
    query('DELETE FROM stories WHERE uid=?').run(uid)
    query('DELETE FROM reset_audit WHERE target=?').run(uid)
    query('DELETE FROM users WHERE id=?').run(uid)
  }
  function maintain() {
    const now=clock()
    query("DELETE FROM stories WHERE state!='saved' AND started<=?").run(now-day)
    query('DELETE FROM sessions WHERE created<=? OR touched<=?').run(now-7*day,now-3600000)
    for(const [key,entry] of limits) if(entry.until<=now) limits.delete(key)
    // Fixed local illustrations make delayed and out-of-order completion reproducible.
    for(const cell of query('SELECT id FROM cells WHERE art IS NULL AND NOT EXISTS (SELECT 1 FROM image_jobs WHERE cell=cells.id) AND due<=? LIMIT 64').all(now)){
      const colors=['#b7d7ae','#f3d59c','#c3dce8','#ecd3ba']
      const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 185"><rect width="320" height="185" fill="'+colors[cell.id%4]+'"/><circle cx="250" cy="45" r="22" fill="#fff2b2"/><path d="M0 145 Q95 55 180 135 T320 110 V185 H0Z" fill="#83a886"/></svg>'
      query('UPDATE cells SET art=? WHERE id=?').run(Buffer.from(svg),cell.id)
    }
  }
  const timer=setInterval(()=>{maintain();jobs.tick().catch(()=>console.error("生成队列暂不可用"))},500).unref()
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store')
    res.setHeader('X-Content-Type-Options','nosniff')
    const json=value=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value))}
    try {
      const path=req.url.split('?')[0]
      if(req.method==='GET' && assets.has(path)){
        const [file,type]=assets.get(path)
        res.setHeader('Content-Type',type+'; charset=utf-8')
        return res.end(await readFile(new URL(file,import.meta.url)))
      }
      const mini=path.startsWith('/api/mini/')
      const action=path.slice(mini?10:5)
      if(!path.startsWith('/api/')) fail(404,'页面不存在')
      const write=req.method==='POST'
      if(!write && req.method!=='GET') fail(405,'请求方式无效')
      if(write && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) fail(403,'来源无效')
      const speech=mini && write && action==='transcribe'
      const body=write && !speech?await input(req):{}
      maintain()
      const now=clock()
      const token=mini ? (req.headers.authorization||'').match(/^Bearer ([a-f0-9]{64})$/)?.[1]||'' : (req.headers.cookie||'').match(/(?:^|; *)sid=([a-f0-9]+)/)?.[1]||''
      const cookie=value=>res.setHeader('Set-Cookie','sid='+value+'; Path=/; HttpOnly; SameSite=Strict; Secure'+(value?'':'; Max-Age=0'))
      if(write && ['register','login'].includes(action)){
        const name=required(body.username,'请填写有效用户名',96)
        if(typeof body.password!=='string'||!body.password.length||body.password.length>256) fail(400,'请填写有效密码')
        for(const key of ['name:'+name,'ip:'+req.socket.remoteAddress]){
          const entry=limits.get(key)||{count:0,until:now+60000}
          limits.set(key,entry)
          if(++entry.count>30) fail(429,'尝试过多，请稍后再试')
        }
        let user=query('SELECT * FROM users WHERE name=?').get(name)
        if(action==='register'){
          if(name.toLowerCase()==='admin')fail(409,'该用户名不可注册')
          const salt=randomBytes(16), hash=await digest(body.password,salt)
          if(!query('INSERT OR IGNORE INTO users(name,salt,hash,account_key) VALUES(?,?,?,lower(hex(randomblob(16))))').run(name,salt,hash).changes) fail(409,'用户名已被使用')
          user=query('SELECT id,role FROM users WHERE name=?').get(name)
        }else{
          const hash=await digest(body.password,user?.salt??Buffer.alloc(16))
          if(!user||!timingSafeEqual(hash,user.hash)||!query('SELECT id FROM users WHERE id=? AND hash=?').get(user.id,hash)) fail(401,'用户名或密码错误')
        }
        if(user.reset_until && (!mini || user.reset_until<=clock() || !query('UPDATE users SET reset_used=1 WHERE id=? AND reset_used=0 AND hash=?').run(user.id,user.hash).changes))fail(401,'临时密码已失效，请联系管理员')
        query('DELETE FROM sessions WHERE token=?').run(token)
        const sid=randomBytes(32).toString('hex'), csrf=randomUUID()
        query('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sid,user.id,csrf,now,now)
        query('UPDATE users SET last_login=? WHERE id=?').run(now,user.id)
        if(mini)return json({token:sid,username:name,role:user.role,mustChange:!!user.reset_until})
        cookie(sid)
        return json({username:name,csrf})
      }
      const session=query('SELECT s.*,u.name,u.role,u.reset_until FROM sessions s JOIN users u ON u.id=s.uid WHERE token=?').get(token)
      if(!session) fail(401,'请先登录')
      if(write && !mini && req.headers['x-csrf-token']!==session.csrf) fail(403,'请刷新页面')
      query('UPDATE sessions SET touched=? WHERE token=?').run(now,token)
      const uid=session.uid
      if(session.reset_until){
        if(session.reset_until<=now) fail(401,'临时密码已过期，请联系管理员')
        if(!mini || !['me','password','logout'].includes(action))fail(403,'请先设置新密码')
      }
      if(mini && !write && action==='me')return json({username:session.name,role:session.role,mustChange:!!session.reset_until})
      if(mini && write && action==='password'){
        const {currentPassword,newPassword,confirmPassword}=body
        if((!session.reset_until && (typeof currentPassword!=='string'||currentPassword.length>256))||typeof newPassword!=='string'||!newPassword.trim()||newPassword.length>256)fail(400,'请输入有效密码')
        if(newPassword!==confirmPassword)fail(400,'两次新密码不一致')
        if(newPassword===currentPassword)fail(400,'新密码与当前密码相同')
        const original=query('SELECT hash,salt FROM users WHERE id=?').get(uid)
        if(session.reset_until && timingSafeEqual(await digest(newPassword,original.salt),original.hash))fail(400,'请使用不同于临时密码的新密码')
        if(!session.reset_until && !timingSafeEqual(await digest(currentPassword,original.salt),original.hash))fail(400,'当前密码错误')
        const salt=randomBytes(16), hash=await digest(newPassword,salt)
        db.exec('BEGIN IMMEDIATE')
        try{
          if(!query('UPDATE users SET hash=?,salt=?,reset_until=NULL,reset_used=0 WHERE id=? AND hash=? AND EXISTS(SELECT 1 FROM sessions WHERE token=? AND uid=?)').run(hash,salt,uid,original.hash,token,uid).changes)fail(401,'请重新登录')
          query('DELETE FROM sessions WHERE uid=?').run(uid)
          db.exec('COMMIT')
        }catch(e){db.exec('ROLLBACK');throw e}
        return json({})
      }
      if(action.startsWith('admin/')){
        if(!mini||session.role!=='admin')fail(403,'需要管理员权限')
        if(!write && action==='admin/users')return json({users:query('SELECT name,last_login,role,account_key FROM users ORDER BY id').all()})
        const authorize=()=>{
          if(!query("SELECT 1 FROM sessions s JOIN users u ON s.uid=u.id WHERE s.token=? AND u.role='admin'").get(token))fail(401,'请重新登录')
        }
        if(action==='admin/config'){
          const config=write?await settings.save(body,session.name,authorize):settings.current()
          return json({config,models})
        }
        if(write && action==='admin/delete-user'){
          const key=required(body.accountKey,'请重新选择家庭账号',64)
          const name=required(body.username,'请选择家庭账号',96)
          db.exec('BEGIN IMMEDIATE')
          try{
            const target=query("SELECT id FROM users WHERE account_key=? AND name=? AND role='family'").get(key,name)
            if(!target)fail(404,'家庭账号已变更，请刷新列表')
            eraseFamily(target.id)
            db.exec('COMMIT')
          }catch(error){db.exec('ROLLBACK');throw error}
          return json({})
        }
        if(write && action==='admin/reset'){
          const target=query("SELECT id,account_key FROM users WHERE name=? AND role='family'").get(required(body.username,'请选择家庭账号',96))
          if(!target)fail(404,'家庭账号不存在')
          const temporary=randomBytes(9).toString('base64url')
          const salt=randomBytes(16),hash=await digest(temporary,salt)
          authorize()
          db.exec('BEGIN IMMEDIATE')
          try{
            if(!query('UPDATE users SET salt=?,hash=?,reset_until=?,reset_used=0 WHERE id=? AND account_key=?').run(salt,hash,clock()+15*60000,target.id,target.account_key).changes)fail(404,'家庭账号已变更，请刷新列表')
            query('DELETE FROM sessions WHERE uid=?').run(target.id)
            query('INSERT INTO reset_audit VALUES(?,?,?)').run(clock(),uid,target.id)
            db.exec('COMMIT')
          }catch(error){db.exec('ROLLBACK');throw error}
          return json({temporary})
        }
        fail(404,'页面不存在')
      }
      if(session.role==='admin' && action!=='logout')fail(403,'请从小程序进入管理首页')
      if(mini && write && action==='close-account'){
        db.exec('BEGIN IMMEDIATE')
        try{
          eraseFamily(uid)
          db.exec('COMMIT')
        }catch(error){db.exec('ROLLBACK');throw error}
        return json({})
      }
      if(speech){
        const data=await input(req,2600000)
        if(typeof data.id!=='string'||!query("SELECT id FROM stories WHERE id=? AND uid=? AND state IN ('draft','saved')").get(data.id,uid))fail(404,'故事不存在')
        const key='speech:'+uid
        const limit=limits.get(key)||{count:0,until:now+60000}
        limits.set(key,limit)
        if(++limit.count>8)fail(429,'转写请求过多，请稍后再试')
        return json({text:await transcribePCM(data.audio,data.format)})
      }
      if(!write && action==='shelf'){
        const books=query(`SELECT s.id,s.title,s.saved,count(c.id) AS count,
          (SELECT CASE WHEN art IS NULL THEN NULL ELSE id END FROM cells WHERE story=s.id ORDER BY id LIMIT 1) AS cover
          FROM stories s JOIN cells c ON c.story=s.id WHERE uid=? AND state='saved' GROUP BY s.id ORDER BY saved DESC`).all(uid)
        const draft=query("SELECT id,state FROM stories WHERE uid=? AND state!='saved' AND EXISTS (SELECT 1 FROM cells WHERE story=stories.id)").get(uid)??null
        return json({books,draft,username:session.name,csrf:session.csrf})
      }
      if(write && action==='logout'){
        query('DELETE FROM sessions WHERE token=?').run(token)
        cookie('')
        return json({})
      }
      if(write && action==='start'){
        const existing=query("SELECT id FROM stories WHERE uid=? AND state!='saved'").get(uid)
        if(existing) return json(existing)
        const id=randomUUID()
        query('INSERT INTO stories(id,uid) VALUES(?,?)').run(id,uid)
        return json({id})
      }
      if(!write && (action.startsWith('media/') || action.startsWith('candidate-media/'))){
        const cell=action.startsWith('media/')?query('SELECT art FROM cells JOIN stories ON stories.id=cells.story WHERE cells.id=? AND uid=?').get(action.slice(6),uid):
          query('SELECT v.art FROM candidates v JOIN cells c ON c.id=v.cell JOIN stories s ON s.id=c.story WHERE v.job=? AND s.uid=? AND v.base=c.version').get(action.split('/')[1],uid)
        if(!cell?.art) fail(404,'图片不存在')
        res.setHeader('Content-Type',mediaType(cell.art)||'image/svg+xml')
        return res.end(Buffer.from(cell.art))
      }
      const id=write?body.id:action.slice(6)
      const story=query('SELECT * FROM stories WHERE id=? AND uid=?').get(typeof id==='string'?id:'',uid)
      if(!story) fail(404,'故事不存在')
      if(!write && action.startsWith('story/')){
        const cells=query(`SELECT c.id,c.version,c.text,c.art IS NOT NULL AS ready,
          CASE WHEN j.status IN ('failed','unknown','withheld') THEN j.error END AS error,
          CASE WHEN j.status IN ('failed','withheld') THEN j.id END AS retryJob
          FROM cells c LEFT JOIN image_jobs j ON j.id=(SELECT max(id) FROM image_jobs WHERE cell=c.id AND is_candidate=0)
          WHERE c.story=? ORDER BY c.id`).all(id)
        return json({id,state:story.state,title:story.title,cells})
      }
      if(write && mini && action==='delete'){
        if(story.state!=='saved') fail(409,'只能删除已保存的故事')
        db.exec('BEGIN IMMEDIATE')
        try{
          query("UPDATE image_jobs SET cell=NULL,status=CASE WHEN status='queued' THEN 'failed' ELSE status END WHERE cell IN (SELECT id FROM cells WHERE story=?)").run(id)
          query('DELETE FROM stories WHERE id=? AND uid=?').run(id,uid)
          db.exec('COMMIT')
        }catch(e){db.exec('ROLLBACK');throw e}
        return json({})
      }
      if(write && ['candidate','candidate-status','adopt','discard'].includes(action)){
        const cell=query("SELECT * FROM cells WHERE story=? AND id=?").get(id,body.cell)
        if(story.state!=='saved'||!cell?.art)fail(409,'请刷新后选择已完成的故事格')
        db.exec('BEGIN IMMEDIATE')
        try{
          let result={}
          if(action==='candidate'){
            const text=required(body.text,'请输入本格文字',Infinity)
            if(Array.from(text).length>100)fail(400,'本格文字最多 100 字')
            if(cell.version!==body.version)fail(409,'原版已更新，请返回阅读页刷新')
            const key=required(body.requestId,'缺少提交编号',96)
            let job=query('SELECT job FROM candidates WHERE cell=? AND request=?').get(cell.id,key)?.job
            if(!job){
              job=jobs.reserve(cell.id,uid)
              if(!job)fail(409,'请先配置绘图服务')
              query('UPDATE image_jobs SET is_candidate=1 WHERE id=?').run(job)
              query('INSERT INTO candidates(job,cell,base,request,text) VALUES(?,?,?,?,?)').run(job,cell.id,cell.version,key,text)
            }
            result={job}
          }else{
            const v=query('SELECT v.*,j.status,j.error FROM candidates v JOIN image_jobs j ON j.id=v.job WHERE v.cell=? AND v.job=?').get(cell.id,body.job)
            if(!v || v.base!==cell.version)fail(409,'版本已更新，请返回阅读页刷新')
            if(action==='candidate-status')result={status:v.status,error:v.error,text:v.text}
            else if(action==='adopt'){
              if(v.status!=='done'||!v.art)fail(409,'新版尚未生成')
              query('UPDATE cells SET text=?,art=?,version=version+1 WHERE id=?').run(v.text,v.art,cell.id)
              query("UPDATE image_jobs SET status='failed' WHERE status='queued' AND id IN (SELECT job FROM candidates WHERE cell=?)").run(cell.id)
              query('DELETE FROM candidates WHERE cell=?').run(cell.id)
            }else{
              query("UPDATE image_jobs SET status='failed' WHERE id=? AND status='queued'").run(v.job)
              query('DELETE FROM candidates WHERE job=?').run(v.job)
            }
          }
          db.exec('COMMIT')
          return json(result)
        }catch(e){db.exec('ROLLBACK');throw e}
      }
      if(write && action==='retry-cell'){
        if(story.state!=='draft')fail(409,'故事已结束')
        const text=required(body.text,'请输入本格文字',Infinity)
        if(Array.from(text).length>100)fail(400,'本格文字最多 100 字')
        db.exec('BEGIN IMMEDIATE')
        try{
          const job=query(`SELECT j.*,c.text FROM cells c JOIN image_jobs j ON j.cell=c.id
            WHERE c.story=? AND c.id=? AND c.art IS NULL ORDER BY j.id DESC LIMIT 1`).get(id,body.cell)
          if(!job || job.id!==body.retryJob || !['failed','withheld'].includes(job.status))fail(409,'本格状态已更新，请刷新')
          if(job.status==='withheld' && job.error==='适龄审核暂不可用' && text===job.text){
            query("UPDATE image_jobs SET status='poll',error=NULL,next=? WHERE id=?").run(now,job.id)
          }else{
            if(!jobs.reserve(job.cell,uid))fail(409,'请先配置绘图服务')
            query('UPDATE cells SET text=? WHERE id=?').run(text,job.cell)
          }
          db.exec('COMMIT')
        }catch(e){db.exec('ROLLBACK');throw e}
        return json({})
      }
      if(write && action==='cell'){
        const text=required(body.text,'请输入本格文字',Infinity)
        if(Array.from(text).length>100) fail(400,'本格文字最多 100 字')
        const key=required(body.requestId,'缺少提交编号',96)
        if(query('SELECT id FROM cells WHERE story=? AND request=?').get(id,key)) return json({})
        if(story.state!=='draft') fail(409,'故事已结束')
        db.exec('BEGIN IMMEDIATE')
        try {
          const count=query('SELECT count(*) AS n FROM cells WHERE story=?').get(id).n
          const inserted=query('INSERT INTO cells(story,request,text,due) VALUES(?,?,?,?)').run(id,key,text,now+(count%4===0?5000:850))
          jobs.reserve(inserted.lastInsertRowid,uid)
          query('UPDATE stories SET started=coalesce(started,?) WHERE id=?').run(now,id)
          db.exec('COMMIT')
        } catch(e){db.exec('ROLLBACK');throw e}
      }else if(write && action==='finish'){
        if(!story.started || story.state==='saved') fail(409,'请先完成至少一格')
        query("UPDATE stories SET state='ended' WHERE id=?").run(id)
      }else if(write && action==='save'){
        const title=required(body.title,'请填写故事名称',Infinity)
        if(Array.from(title).length>10) fail(400,'故事名称最多 10 字')
        if(story.state==='draft') fail(409,'请先结束故事')
        query("UPDATE stories SET state='saved',title=?,saved=? WHERE id=? AND state='ended'").run(title,now,id)
      }else fail(404,'页面不存在')
      json({})
    }catch(error){
      res.statusCode=error.status||500
      json({error:error.status?error.message:'服务暂时不可用'})
    }
  })
  server.on('close',()=>{clearInterval(timer);jobs.close();db.close()})
  return server
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.STORY_PORT || 3085)
  const app=createApp()
  app.listen(port,'127.0.0.1',()=>console.log('林间故事屋 http://localhost:'+app.address().port))
}
