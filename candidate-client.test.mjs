import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {runInNewContext} from 'node:vm'

test('候选请求响应丢失，重开编辑页沿用同一请求编号',async()=>{
  const source=readFileSync(new URL('./miniprogram/pages/edit/index.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'')
  const storage=new Map()
  const requests=[]
  let definition
  runInNewContext(stripTypeScriptTypes(source),{
    Page:value=>{definition=value},voiceControls:{},media:async()=>'image',
    wx:{getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v)},
    request:async(route,data)=>{
      if(route==='story/book')return {cells:[{id:1,ready:true,version:0,text:'原稿'}]}
      assert.equal(route,'candidate')
      requests.push(data.requestId)
      if(requests.length===1)throw Error('连接中断')
      return {job:42}
    }
  })
  const page=()=>({...definition,data:{...definition.data},active:true,id:'book',cell:1,
    setData(values){Object.assign(this.data,values)},poll(){}})
  const first=page()
  await first.load()
  first.edit({detail:{value:'新版'}})
  await first.generate()
  const reopened=page()
  await reopened.load()
  assert.equal(reopened.data.text,'新版')
  await reopened.generate()
  assert.equal(reopened.job,42)
  assert.equal(requests.length,2)
  assert.equal(requests[0],requests[1])
})

test('切换接口隔离登录和退出',()=>{
  const source=readFileSync(new URL('./miniprogram/api.ts',import.meta.url),'utf8').replace(/^export /gm,'')
  const storage=new Map()
  function client(local){
    storage.set('story.useLocalApi',local)
    const wx={getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),getDeviceInfo:()=>({platform:'devtools'}),
      getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),reLaunch(){}}
    return runInNewContext(stripTypeScriptTypes(source)+'\n;({accept,leave,session})',{wx})
  }
  client(false).accept('test-token','user')
  const local=client(true)
  assert.equal(local.session(),'')
  local.accept('local-token','user')
  local.leave()
  assert.equal(client(false).session(),'test-token')
})
