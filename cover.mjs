import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'

const script=fileURLToPath(new URL('./cover.py',import.meta.url))

export function coverThumbnails(){
  const cache=new Map()
  return function thumbnail(art){
    const key=createHash('sha256').update(art).digest('hex')
    if(cache.has(key))return cache.get(key)
    const pending=new Promise((resolve,reject)=>{
      const python=process.env.STORY_COVER_PYTHON || (process.platform==='win32'?'python':'python3')
      const child=execFile(python,[script],{
        encoding:'buffer',timeout:10000,maxBuffer:512*1024,windowsHide:true
      },(error,bytes)=>error?reject(error):resolve(bytes))
      child.stdin.on('error',()=>{})
      child.stdin.end(art)
    })
    cache.set(key,pending)
    if(cache.size>128)cache.delete(cache.keys().next().value)
    pending.catch(()=>{
      if(cache.get(key)===pending)cache.delete(key)
    })
    return pending
  }
}
