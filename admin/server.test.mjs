import test from 'node:test'
import assert from 'node:assert/strict'
import {createAdmin,protect} from './server.mjs'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

test('管理员配置鉴权、密钥写入、原子校验及重启持久化',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'story-admin-'))
  const file=join(dir,'config.sqlite')
  const demo='offline-fixture-only'
  let server,base
  const open=async()=>{
    server=createAdmin(file,'test-operator',process.platform==='win32'?protect:async()=> 'fixture-ciphertext')
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    base='http://127.0.0.1:'+server.address().port
  }
  const close=()=>new Promise(resolve=>server.close(resolve))
  const call=(body,token='test-operator')=>fetch(base+'/config',{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,origin:base,'content-type':'application/json'},body:body&&JSON.stringify(body)})
  await open()
  try{
    assert.equal((await call(undefined,'family')).status,401)
    assert.equal((await fetch(base+'/')).status,200)
    const config=await (await call()).json()
    const input={...config,key:'',quota:8,budget:1.25}
    assert.equal((await call(input)).status,400)
    const saved=await (await call({...input,key:demo})).json()
    assert.equal(saved.configured,1)
    assert(!JSON.stringify(saved).includes(demo))
    assert.equal((await call({...input,model:'unknown'})).status,400)
    assert.equal((await call({...input,budget:-1})).status,400)
    assert.equal((await call(input)).status,409)
    assert.equal((await call({...input,version:saved.version,quota:9})).status,200)
    await close()
    await open()
    const result=await (await call()).json()
    assert.equal(result.configured,1)
    assert.equal(result.quota,9)
    assert.equal(result.budget,1.25)
  }finally{await close();await rm(dir,{recursive:true,force:true})}
})
