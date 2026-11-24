import http from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {randomBytes, timingSafeEqual} from 'node:crypto'
import {spawn} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {userInfo} from 'node:os'
import {pathToFileURL} from 'node:url'

export const models=['wanx2.0-t2i-turbo','wan2.2-t2i-flash']
const files=new Map([
  ['/', ['index.html','text/html']], ['/admin.js',['admin.js','text/javascript']],
  ['/style.css',['../docs/ui/style.css','text/css']], ['/book-mark.svg',['../docs/ui/book-mark.svg','image/svg+xml']]
])
function reject(status,message){throw Object.assign(new Error(message),{status})}

// DPAPI binds the encrypted credential to the Windows account running the service.
export function protect(secret){
  const script="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))"
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']})
    let output=''
    child.stdout.on('data',data=>{output+=data})
    child.on('error',reject)
    child.stdin.on('error',reject)
    child.on('close',code=>code===0 && output.trim()?resolve(output.trim()):reject(new Error('credential storage failed')))
    child.stdin.end(Buffer.from(secret).toString('base64'))
  })
}
export function modelSettings(db,encrypt=protect){
  db.exec(`CREATE TABLE IF NOT EXISTS model_settings(id INTEGER PRIMARY KEY CHECK(id=1),model TEXT,budget_cents INTEGER,quota INTEGER,credential TEXT,version INTEGER);
    INSERT OR IGNORE INTO model_settings VALUES(1,'wanx2.0-t2i-turbo',5000,20,NULL,0);
    CREATE TABLE IF NOT EXISTS config_audit(at TEXT,operator TEXT,fields TEXT);`)
  const current=()=>db.prepare('SELECT model,budget_cents/100.0 AS budget,quota,credential IS NOT NULL AS configured,version FROM model_settings WHERE id=1').get()
  async function save(data,operator,authorize=()=>{}){
    if(!data || !models.includes(data.model))reject(400,'请选择百炼模型')
    const cents=Math.round(data.budget*100)
    if(typeof data.budget!=='number' || !Number.isSafeInteger(cents) || cents<0 || cents/100!==data.budget ||
      !Number.isSafeInteger(data.quota)||data.quota<0)reject(400,'请输入有效预算和整数张数')
    if(typeof data.key!=='string'||data.key.length>1024||/\s/.test(data.key))reject(400,'请检查 API Key 格式')
    const before=current()
    if(!before.configured && !data.key)reject(400,'首次保存请填写 API Key')
    const credential=data.key?await encrypt(data.key):null
    authorize()
    const fields=['model','budget','quota'].filter(k=>data[k]!==before[k])
    if(credential)fields.push('credential')
    db.exec('BEGIN IMMEDIATE')
    try{
      const update=db.prepare('UPDATE model_settings SET model=?,budget_cents=?,quota=?,credential=coalesce(?,credential),version=version+1 WHERE id=1 AND version=?')
      if(!Number.isSafeInteger(data.version)||!update.run(data.model,cents,data.quota,credential,data.version).changes)reject(409,'配置已更新，请刷新后重试')
      db.prepare('INSERT INTO config_audit VALUES(?,?,?)').run(new Date().toISOString(),operator,fields.join(','))
      db.exec('COMMIT')
    }catch(e){db.exec('ROLLBACK');throw e}
    return current()
  }
  return {current,save}
}
export function createAdmin(filename,token,encrypt=protect){
  const db=new DatabaseSync(filename)
  const settings=modelSettings(db,encrypt)
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store')
    res.setHeader('Referrer-Policy','no-referrer')
    res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    res.setHeader('X-Content-Type-Options','nosniff')
    function json(data){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))}
    try{
      const host='127.0.0.1:'+server.address().port
      if(req.headers.host!==host)reject(403,'请从本机管理入口打开')
      if(req.method==='GET' && files.has(req.url)){
        const [file,type]=files.get(req.url)
        res.setHeader('Content-Type',type+'; charset=utf-8')
        return res.end(await readFile(new URL(file,import.meta.url)))
      }
      if(req.url!=='/config')reject(404,'页面不存在')
      const auth=Buffer.from(req.headers.authorization||'')
      const expected=Buffer.from('Bearer '+token)
      if(auth.length!==expected.length || !timingSafeEqual(auth,expected))reject(401,'请在项目目录运行管理端启动命令')
      if(req.method==='GET')return json({...settings.current(),models})
      if(req.method!=='POST' || req.headers.origin!=='http://'+host || req.headers['content-type']!=='application/json')reject(403,'请求无效')
      const chunks=[]
      let size=0
      for await(const chunk of req){size+=chunk.length;if(size>8192)reject(413,'输入过长');chunks.push(chunk)}
      let data
      try{data=JSON.parse(Buffer.concat(chunks))}catch{reject(400,'请检查配置')}
      json({...await settings.save(data,userInfo().username),models})
    }catch(e){res.statusCode=e.status||500;json({error:e.status?e.message:'保存失败，请检查本机凭据存储'})}
  })
  server.on('close',()=>db.close())
  return server
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const token=randomBytes(32).toString('hex')
  const server=createAdmin('stories.sqlite',token)
  server.listen(0,'127.0.0.1',()=>{
    const url='http://127.0.0.1:'+server.address().port+'/#'+token
    // Deliver the local operator credential to the browser, never to application logs.
    const opener=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'})
    opener.on('error',()=>console.error('未能打开默认浏览器'))
    console.log('本地管理端已启动。关闭此进程即撤销本次管理权限。')
  })
}
