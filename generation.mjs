import {spawn} from 'node:child_process'
import {sceneFor,reviewImage,recurringAppearance} from './scene.mjs'
const root='https://dashscope.aliyuncs.com/api/v1'
const prices=new Map([['wanx2.0-t2i-turbo',4],['wan2.2-t2i-flash',14]])
function problem(message){return Object.assign(new Error(message),{status:409})}
export async function unlock(cipher){
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
async function call(path,key,body){
  const response=await fetch(root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','X-DashScope-Async':'enable'},body:body&&JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)})
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
export function generation(db,clock,readCredential=unlock){
  const q=sql=>db.prepare(sql)
  db.exec(`CREATE TABLE IF NOT EXISTS image_jobs(id INTEGER PRIMARY KEY,cell INTEGER,uid INTEGER,month TEXT,model TEXT,cents INTEGER,status TEXT,task TEXT,error TEXT,next INTEGER,created INTEGER);
  CREATE INDEX IF NOT EXISTS image_jobs_cell ON image_jobs(cell);
  CREATE INDEX IF NOT EXISTS image_jobs_due ON image_jobs(status,next);`)
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
  function reserve(cell,uid){
    if(!q("SELECT name FROM sqlite_master WHERE type='table' AND name='model_settings'").get())return
    const cfg=q('SELECT model,budget_cents,quota,credential IS NOT NULL AS configured FROM model_settings WHERE id=1').get()
    if(!cfg?.configured)return
    const month=new Date(clock()+8*3600000).toISOString().slice(0,7)
    const cents=prices.get(cfg.model)
    if(!cents)throw problem('模型价格未配置')
    const used=q("SELECT coalesce(sum(cents),0) AS total,count(CASE WHEN uid=? THEN 1 END) AS count FROM image_jobs WHERE month=? AND status!='failed'").get(uid,month)
    if(used.total+cents>cfg.budget_cents || used.count>=cfg.quota)throw problem('本月生成额度已用完')
    return Number(q("INSERT INTO image_jobs(cell,uid,month,model,cents,status,next,created) VALUES(?,?,?,?,?,'queued',?,?)").run(cell,uid,month,cfg.model,cents,clock(),clock()).lastInsertRowid)
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
        const previous=q(`SELECT p.id,p.text,p.art FROM cells c JOIN cells p ON p.story=c.story AND p.id<c.id
          WHERE c.id=? ORDER BY p.id DESC LIMIT 1`).get(job.cell)
        if(previous && !previous.art && q("SELECT 1 FROM image_jobs WHERE cell=? AND status IN ('queued','sending','poll')").get(previous.id)){
          q('UPDATE image_jobs SET next=? WHERE id=?').run(clock()+3000,job.id)
          return
        }
        let scene=await sceneFor(key,job.text)
        const type=previous?.art && mediaType(previous.art)
        if(type){
          const appearance=await recurringAppearance(key,previous.text,job.text,previous.art,type)
          if(appearance)scene+='\n连续画格的角色造型：'+appearance
        }
        if(closed)return
        if(!q("UPDATE image_jobs SET status='sending' WHERE id=? AND status='queued'").run(job.id).changes)return
        sending=true
        const out=await call('/services/aigc/text2image/image-synthesis',key,{
          model:job.model,
          input:{
            prompt:'原创儿童简笔漫画，画一个独立的单格场景。用细细的灰黑色墨线勾出轮廓，线宽均匀，转折圆润；用几段简洁的弧线概括身体和四肢。角色五官小巧，点状眼睛，小弧线表现嘴角，用姿势讲清动作。用少量清爽的纯色平涂，总配色控制在五种以内，一种主色配少量点缀色。用简练的色块交代环境，背景疏朗，多留空。角色、数量、物品、动作、场景及明确指定的颜色均以故事原文为准。情节：'+scene,
            negative_prompt:'粗黑描边、草稿重线、铅笔排线、蜡笔颗粒、写实解剖、毛发细节、照片感、三维渲染、立体高光、投影、渐变、厚涂、水彩晕染、过密背景、贴纸白边、多格拼图、分格线、漫画边框、文字、签名、水印、对话框'
          },
          parameters:{size:'1024*1024',n:1}
        })
        if(!out.task_id)throw Error('缺少任务编号')
        if(!closed)q("UPDATE image_jobs SET status='poll',task=?,next=? WHERE id=?").run(out.task_id,clock()+3000,job.id)
        return
      }
      const out=await call('/tasks/'+encodeURIComponent(job.task),key)
      if(closed)return
      if(out.task_status==='SUCCEEDED'){
        const bytes=await download(out.results?.[0]?.url)
        await reviewImage(key,bytes,mediaType(bytes))
        if(closed)return
        db.exec('BEGIN IMMEDIATE')
        try{
          if(job.is_candidate)q('UPDATE candidates SET art=? WHERE job=?').run(bytes,job.id)
          else q('UPDATE cells SET art=? WHERE id=(SELECT cell FROM image_jobs WHERE id=?)').run(bytes,job.id)
          q("UPDATE image_jobs SET status='done',error=NULL WHERE id=?").run(job.id)
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
      const status=sending?(e.rejected?'failed':'unknown'):job.status==='queued'?'failed':clock()-job.created<900000?'poll':'unknown'
      const detail=sending && e.rejected?e.message:status==='unknown'?'结果待核对，请勿重复提交':'服务暂不可用'
      q('UPDATE image_jobs SET status=?,error=?,next=? WHERE id=?').run(status,detail,clock()+10000,job.id)
    }finally{busy=false}
  }
  return {reserve,tick,close(){closed=true}}
}
