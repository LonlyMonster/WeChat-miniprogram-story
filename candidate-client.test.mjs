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
