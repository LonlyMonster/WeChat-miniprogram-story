import {spawn} from 'node:child_process'
import {imageModels} from './image-models.mjs'
import {openCredential} from './credentials.mjs'

import {sceneFor,reviewImage} from './scene.mjs'
const root='https://dashscope.aliyuncs.com/api/v1'
function problem(message){return Object.assign(new Error(message),{status:409})}
export async function unlock(cipher){
  if(cipher.startsWith('v1:'))return openCredential(cipher)
  if(process.platform!=='win32')throw Error('迁移至 Linux 后请重新保存模型密钥')
  const script="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))"
  return new Promise((resolve,reject)=>{
    const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{stdio:['pipe','pipe','ignore'],windowsHide:true})
    let out=''
    p.stdout.on('data',b=>out+=b)
    p.on('error',reject)
    p.stdin.on('error',reject)
    p.on('close',code=>code===0&&out.trim()?resolve(out.trim()):reject(Error('无法读取本机凭据')))
    p.stdin.end(cipher)
  })
}
async function call(path,key,body,synchronous=false){
  const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'}
  if(!synchronous)headers['X-DashScope-Async']='enable'
  const response=await fetch(root+path,{method:body?'POST':'GET',headers,body:body&&JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(synchronous?240000:30000)})
  const data=await response.json()
  if(!response.ok || !data.output){
    const code=String(data.code||response.status)
    const e=Error(/^[\w.-]{1,80}$/.test(code)?code:'ServiceError')
    e.rejected=response.status>=400 && response.status<500 && response.status!==408
    throw e
  }
  return data.output
}
export function mediaType(bytes){
  const b=Buffer.from(bytes)
  if(b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png'
  if(b[0]===255 && b[1]===216 && b[2]===255)return 'image/jpeg'
  if(b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP')return 'image/webp'
}
async function download(url){
  const target=new URL(url)
  if(target.protocol!=='https:' || !target.hostname.endsWith('.aliyuncs.com'))throw Error('图片来源异常')
  const r=await fetch(target,{signal:AbortSignal.timeout(45000),redirect:'error'})
  if(!r.ok)throw Error('图片下载失败')
  let size=0
  const chunks=[]
  for await(const chunk of r.body){
    size+=chunk.length
    if(size>16*1024*1024)throw Error('图片过大')
    chunks.push(chunk)
  }
  const bytes=Buffer.concat(chunks)
  if(!mediaType(bytes))throw Error('未知图片格式')
  return bytes
}
export function frameDescriptions(q,cell,first){
  return q(`SELECT c.id,c.text AS 原文,c.scene_description AS 画面描述,
    CASE WHEN c.scene_description IS NULL AND c.version=0 THEN (
      SELECT r.prompt FROM scene_requests r JOIN image_jobs j ON j.id=r.job
      WHERE j.cell=c.id AND j.is_candidate=0 AND j.status='done' ORDER BY j.id DESC LIMIT 1
    ) END AS legacy_prompt FROM cells c
    WHERE c.story=(SELECT story FROM cells WHERE id=?) AND c.id BETWEEN ? AND ? ORDER BY c.id`).all(cell,first,cell).map(frame=>({原文:frame.原文,画面描述:frame.画面描述 ||
    frame.legacy_prompt?.match(/(?:^|\n)本格画面：([\s\S]*?)(?:\n连续性校对：|\n本格原文：|$)/)?.[1] || null}))
}
async function prepareIllustration(q,key,job){
  const descriptions=frameDescriptions(q,job.cell,0)
  const current=descriptions.pop()
  const scene=await sceneFor(key,job.text,descriptions,job.is_candidate?current:null)
  const prompt=['儿童绘本单格插画，细墨线，纯色平涂，简洁浅色背景，画面无文字。',
    '采用童趣、非写实的儿童画风格，像孩子画的简笔画：用几笔概括外形，以略带夸张的姿态表现动作。',
    '主体和背景都用边缘清晰的纯色色块平涂，每个色块内部平滑均匀，细节用少量简洁线条表示。',
    '本格画面：'+scene].join('\n')
  return {scene,prompt}
}
export function generation(db,clock,readCredential=unlock){
  const q=sql=>db.prepare(sql)
  db.exec(`CREATE TABLE IF NOT EXISTS story_references(story TEXT REFERENCES stories(id) ON DELETE CASCADE,
    name TEXT,description TEXT NOT NULL,art BLOB NOT NULL,PRIMARY KEY(story,name));
    CREATE TABLE IF NOT EXISTS scene_requests(cell INTEGER REFERENCES cells(id) ON DELETE CASCADE,
    job INTEGER PRIMARY KEY,prompt TEXT NOT NULL,reference_names TEXT NOT NULL);`)
  if(!q("SELECT name FROM pragma_table_info('scene_requests') WHERE name='solo_character'").get())
    db.exec('ALTER TABLE scene_requests ADD COLUMN solo_character TEXT')
  if(!q("SELECT name FROM pragma_table_info('scene_requests') WHERE name='paper_cell'").get())
    db.exec('ALTER TABLE scene_requests ADD COLUMN paper_cell INTEGER; ALTER TABLE scene_requests ADD COLUMN paper_version INTEGER')
  db.exec(`CREATE TABLE IF NOT EXISTS image_jobs(id INTEGER PRIMARY KEY,cell INTEGER,uid INTEGER,month TEXT,model TEXT,cents INTEGER,status TEXT,task TEXT,error TEXT,next INTEGER,created INTEGER);
  CREATE INDEX IF NOT EXISTS image_jobs_cell ON image_jobs(cell);
  CREATE INDEX IF NOT EXISTS image_jobs_due ON image_jobs(status,next);`)
  if(!q("SELECT name FROM pragma_table_info('image_jobs') WHERE name='review_started'").get())
    db.exec('ALTER TABLE image_jobs ADD COLUMN review_started INTEGER')
  if(!q("SELECT name FROM pragma_table_info('image_jobs') WHERE name='is_candidate'").get())
    db.exec('ALTER TABLE image_jobs ADD COLUMN is_candidate INTEGER NOT NULL DEFAULT 0')
  if(!q("SELECT name FROM pragma_table_info('cells') WHERE name='version'").get())
    db.exec('ALTER TABLE cells ADD COLUMN version INTEGER NOT NULL DEFAULT 0')
  db.exec(`CREATE TABLE IF NOT EXISTS candidates(job INTEGER PRIMARY KEY REFERENCES image_jobs(id),cell INTEGER NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
    base INTEGER NOT NULL,request TEXT NOT NULL,text TEXT NOT NULL,art BLOB,UNIQUE(cell,request))`)
  // Expired drafts can release row IDs while a provider request is still in flight.
  db.exec(`CREATE TRIGGER IF NOT EXISTS detach_cell_jobs BEFORE DELETE ON cells BEGIN
    UPDATE image_jobs SET cell=NULL,status=CASE WHEN status='queued' THEN 'failed' ELSE status END
    WHERE cell=OLD.id;
  END`)
  // An interrupted submission may already have been billed. Never submit it again automatically.
  q("UPDATE image_jobs SET status='unknown',error='提交中断，需核对供应商账单' WHERE status='sending'").run()
  // A queued legacy job has no provider task yet. Release its old reservation for an explicit retry.
  q("UPDATE image_jobs SET status='failed',error='原模型已升级，请重试本格' WHERE status='queued' AND model IN ('wanx2.0-t2i-turbo','wan2.7-image','wan2.2-t2i-flash')").run()
  function reserve(cell,uid){
    if(!q("SELECT name FROM sqlite_master WHERE type='table' AND name='model_settings'").get())return
    const cfg=q('SELECT model,budget_cents,quota,credential IS NOT NULL AS configured FROM model_settings WHERE id=1').get()
    if(!cfg?.configured)return
    const month=new Date(clock()+8*3600000).toISOString().slice(0,7)
    const cents=imageModels[cfg.model]?.cents
    if(!cents)throw problem('模型价格未配置')
    const used=q("SELECT coalesce(sum(cents),0) AS total,count(CASE WHEN uid=? THEN 1 END) AS count FROM image_jobs WHERE month=? AND status!='failed'").get(uid,month)
    if(used.total+cents>cfg.budget_cents || used.count>=cfg.quota)throw problem('本月生成额度已用完')
    return Number(q("INSERT INTO image_jobs(cell,uid,month,model,cents,status,next,created) VALUES(?,?,?,?,?,'queued',?,?)").run(cell,uid,month,cfg.model,cents,clock(),clock()).lastInsertRowid)
  }
  for(const table of ['cells','scene_requests']){
    if(!q("SELECT name FROM pragma_table_info(?) WHERE name='scene_description'").get(table))
      db.exec('ALTER TABLE '+table+' ADD COLUMN scene_description TEXT')
  }
  let busy=false,closed=false
  async function tick(){
    if(busy||closed)return
    const job=q(`SELECT j.*,coalesce(v.text,c.text) AS text FROM image_jobs j JOIN cells c ON c.id=j.cell LEFT JOIN candidates v ON v.job=j.id
      WHERE (j.is_candidate=0 OR v.job IS NOT NULL) AND status IN ('queued','poll') AND next<=? ORDER BY next,j.id LIMIT 1`).get(clock())
    if(!job)return
    busy=true
    let sending=false
    try{
      const key=await readCredential(q('SELECT credential FROM model_settings WHERE id=1').get().credential)
      if(closed)return
      if(job.status==='queued'){
        const previous=q(`SELECT p.id,p.art IS NOT NULL AS ready FROM cells c JOIN cells p ON p.story=c.story AND p.id<c.id
          WHERE c.id=? ORDER BY p.id DESC LIMIT 1`).get(job.cell)
        if(previous && !previous.ready && q("SELECT 1 FROM image_jobs WHERE cell=? AND status IN ('queued','sending','poll')").get(previous.id)){
          q('UPDATE image_jobs SET next=? WHERE id=?').run(clock()+3000,job.id)
          return
        }
        const {scene,prompt}=await prepareIllustration(q,key,job)
        if(closed)return
        if(!q("UPDATE image_jobs SET status='sending' WHERE id=? AND status='queued'").run(job.id).changes)return
        sending=true
        q("INSERT INTO scene_requests(cell,job,prompt,reference_names,scene_description) VALUES(?,?,?,'[]',?)").run(job.cell,job.id,prompt,scene)
        const input={messages:[{role:'user',content:[{text:prompt}]}]}
        const parameters={size:'1024*1024',n:1,prompt_extend:false,watermark:false}
        const result=await call('/services/aigc/multimodal-generation/generation',key,{model:job.model,input,parameters},true)
        const task=result.choices?.[0]?.message?.content?.find(part=>part.image)?.image
        if(typeof task!=='string'||!task)throw Error('缺少生成结果')
        if(!closed)q("UPDATE image_jobs SET status='poll',task=?,next=? WHERE id=? AND status='sending'").run(task,clock(),job.id)
        return
      }
      const hasImageUrl=job.task?.startsWith('https://')
      const out=hasImageUrl?{task_status:'SUCCEEDED',results:[{url:job.task}]}:await call('/tasks/'+encodeURIComponent(job.task),key)
      if(closed)return
      if(out.task_status==='SUCCEEDED'){
        const bytes=await download(out.results?.[0]?.url)
        const appearance=await reviewImage(key,bytes,mediaType(bytes),job.text)
        if(closed)return
        db.exec('BEGIN IMMEDIATE')
        try{
          if(appearance)q("UPDATE scene_requests SET scene_description=? WHERE job=?").run(appearance,job.id)
          if(job.is_candidate)q('UPDATE candidates SET art=? WHERE job=?').run(bytes,job.id)
          else q('UPDATE cells SET art=?,scene_description=(SELECT scene_description FROM scene_requests WHERE job=?) WHERE id=(SELECT cell FROM image_jobs WHERE id=?)').run(bytes,job.id,job.id)
          q("UPDATE image_jobs SET status='done',error=NULL,task=CASE WHEN ? THEN NULL ELSE task END WHERE id=?").run(Number(hasImageUrl),job.id)
          db.exec('COMMIT')
        }catch(e){db.exec('ROLLBACK');throw e}
      }else if(['FAILED','CANCELED'].includes(out.task_status)){
        q("UPDATE image_jobs SET status='failed',error=? WHERE id=?").run(String(out.code||'出图失败').slice(0,80),job.id)
      }else if(out.task_status==='UNKNOWN')throw Error('供应商任务状态未知')
      else q('UPDATE image_jobs SET next=? WHERE id=?').run(clock()+4000,job.id)
    }catch(e){
      if(closed)return
      if(e.review){
        q('UPDATE image_jobs SET status=?,error=? WHERE id=?').run(job.status==='poll'?'withheld':'failed',e.message,job.id)
        return
      }
      const status=sending?(e.rejected?'failed':'unknown'):job.status==='queued'?'failed':clock()-(job.review_started??job.created)<900000?'poll':'unknown'
      const detail=sending && e.rejected?e.message:status==='unknown'?'结果待核对，请勿重复提交':'服务暂不可用'
      q('UPDATE image_jobs SET status=?,error=?,next=? WHERE id=?').run(status,detail,clock()+10000,job.id)
    }finally{busy=false}
  }
  return {reserve,tick,close(){closed=true}}
}
