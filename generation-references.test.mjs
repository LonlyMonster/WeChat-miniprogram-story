import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {sceneFor,describeImage} from './scene.mjs'
import {generation} from './generation.mjs'

test('纯文字生图：续格接收同故事已采用的画面描述，不上传参考图',async t=>{
  const db=new DatabaseSync(':memory:')
  t.after(()=>db.close())
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE stories(id TEXT PRIMARY KEY);
    CREATE TABLE cells(id INTEGER PRIMARY KEY,story TEXT,text TEXT,art BLOB);
    CREATE TABLE model_settings(id INTEGER PRIMARY KEY,model TEXT,budget_cents INTEGER,quota INTEGER,credential TEXT);
    INSERT INTO model_settings VALUES(1,'qwen-image-2.0',1000,10,'test');
    INSERT INTO stories VALUES('first'),('second');`)
  let now=Date.now()
  const jobs=generation(db,()=>now,async()=>'test')
  const histories=[]
  let failFirstObservation=true
  const originals=[]
  const prompts=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    url=String(url)
    if(url.endsWith('/chat/completions')){
      const {messages}=JSON.parse(options.body)
      let result={approved:true}
      if(typeof messages[1].content==='string' && messages[1].content.startsWith('{"较早画格"')){
        const {本格原文,较早画格,待修改画面}=JSON.parse(messages[1].content)
        histories.push(较早画格)
        originals.push(待修改画面)
        result={action:本格原文,features:'背景主色浅蓝，中央有一棵红枫。'}
      }else if(messages[0].content.includes('matches'))result={matches:true}
      else if(messages[0].content.includes('画法描述'))result.style='细棕色轮廓，带颗粒的明暗过渡。'
      else if(Array.isArray(messages[1].content)){
        if(failFirstObservation){
          failFirstObservation=false
          return new Response(null,{status:503})
        }
        result.appearance='蓝色短靴，黑色点眼。'
      }
      return Response.json({choices:[{message:{content:JSON.stringify(result)}}]})
    }
    if(url.endsWith('/text2image/image-synthesis')){
      const {model,input}=JSON.parse(options.body)
      assert.equal(model,'wanx2.0-t2i-turbo')
      assert.equal(options.headers['X-DashScope-Async'],'enable')
      assert.ok(Array.from(input.prompt).length<=800)
      assert.match(input.prompt,/连续特征：背景主色浅蓝/)
      assert.ok(input.prompt.isWellFormed())
      return Response.json({output:{task_id:'wan-test'}})
    }
    if(url.endsWith('/tasks/wan-test'))return Response.json({output:{task_status:'SUCCEEDED',results:[{url:'https://test.aliyuncs.com/image'}]}})
    if(url.endsWith('/multimodal-generation/generation')){
      const body=JSON.parse(options.body)
      assert.equal(body.model,prompts.length===10?'qwen-image-2.1-turbo':'qwen-image-2.0')
      assert.equal(body.parameters.prompt_extend,false)
      const content=body.input.messages[0].content
      assert.equal(content.length,1)
      assert.deepEqual(Object.keys(content[0]),['text'])
      prompts.push(body.input.messages[0].content.at(-1).text)
      return Response.json({output:{choices:[{message:{content:[{image:'https://test.aliyuncs.com/image'}]}}]}})
    }
    assert.equal(url,'https://test.aliyuncs.com/image')
    return new Response(Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from([prompts.length])]))
  })
  db.exec("INSERT INTO stories VALUES('alien')")
  for(const [story,text] of [['alien','外星人来到了地球'],['alien','他看到了一只兔子，很好奇这是什么'],['first','小猫看书'],['first','小狗捡球'],['first','小猫拍手'],['first','小狗把球递给小猫'],['second','游泳池'],['second','小兔子来到了这个游泳池'],['second','小猫看书'],['second','小兔子回到这个游泳池']]){
    const cell=db.prepare('INSERT INTO cells(story,text) VALUES(?,?)').run(story,text).lastInsertRowid
    jobs.reserve(cell,1)
    await jobs.tick()
    now+=5000
    await jobs.tick()
    assert.ok(db.prepare('SELECT art FROM cells WHERE id=?').get(cell).art)
    if(histories.length===1){
      const observed=db.prepare('SELECT scene_description,appearance_error FROM scene_requests WHERE cell=?').get(cell)
      assert.equal(observed.scene_description,null)
      assert.equal(observed.appearance_error,'HTTP 503')
    }
  }
  assert.equal(prompts[0].split('\n')[0],'一幅完整的彩色插画，一个场景铺满整张画布，镜头只呈现一个瞬间，四周没有分隔线。儿童绘本简笔画风格，细墨线勾形，主体和道具填满清晰的纯色色块，背景简洁浅色。动作略夸张，画面无文字。')
  assert.match(prompts[1],/首格画风：细棕色轮廓/)
  assert.doesNotMatch(prompts[1],/填满清晰的纯色色块/)
  assert.equal(histories.length,10)
  assert.deepEqual(histories[1],[{原文:'外星人来到了地球',画面描述:'蓝色短靴，黑色点眼。'}])
  assert.deepEqual(histories[2],[])
  assert.deepEqual(histories[5].map(frame=>frame.原文),['小猫看书','小狗捡球','小猫拍手'])
  for(const prompt of prompts){
    assert.match(prompt,/^一幅完整的彩色插画，一个场景铺满整张画布，镜头只呈现一个瞬间，四周没有分隔线。/)
    assert.match(prompt,/背景主色浅蓝，中央有一棵红枫/)
    assert.doesNotMatch(prompt,/参考图/)
  }
  db.exec("UPDATE cells SET scene_description=NULL WHERE id=1; UPDATE model_settings SET quota=11,model='qwen-image-2.1-turbo'")
  const retry=jobs.reserve(2,1)
  db.prepare('UPDATE image_jobs SET is_candidate=1 WHERE id=?').run(retry)
  db.prepare("INSERT INTO candidates(job,cell,base,request,text) VALUES(?,2,0,'edit','他蹲下来')").run(retry)
  await jobs.tick()
  assert.equal(db.prepare('SELECT cents FROM image_jobs WHERE id=?').get(retry).cents,10)
  assert.equal(prompts.length,11)
  assert.equal(histories.at(-1)[0].画面描述,'蓝色短靴，黑色点眼。')
  assert.equal(originals.at(-1).画面描述,'蓝色短靴，黑色点眼。')
  db.exec("UPDATE model_settings SET quota=12,model='wanx2.0-t2i-turbo'")
  const cell=db.prepare('INSERT INTO cells(story,text) VALUES(?,?)').run('second','小兔🐇'.repeat(260)).lastInsertRowid
  await jobs.tick()
  const wan=jobs.reserve(cell,1)
  await jobs.tick()
  await jobs.tick()
  assert.deepEqual({...db.prepare('SELECT cents,status FROM image_jobs WHERE id=?').get(wan)},{cents:4,status:'done'})
})

test('旧动作校对失败后重写，再次失败时回退原文',async t=>{
  const actions=['指着萝卜','咬住萝卜','指着萝卜','指着萝卜']
  const checks=[false,true,false,false]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const {messages}=JSON.parse(options.body)
    if(messages[0].content.includes('resolved')){
      const context=JSON.parse(messages[1].content)
      const features=context.较早画格.at(-1)?.画面描述
      return Response.json({choices:[{message:{content:JSON.stringify({resolved:!!features,features})}}]})
    }
    const result=messages[0].content.includes('matches')
      ? {matches:checks.shift(),reason:'应画吃萝卜'}
      : {action:actions.shift(),features:'白兔，蓝背带裤'}
    return Response.json({choices:[{message:{content:JSON.stringify(result)}}]})
  })
  assert.equal((await sceneFor('test','它大口吃了起来')).action,'咬住萝卜')
  const features='白兔，浅蓝背带裤、红领结，橙红色萝卜'
  assert.deepEqual(await sceneFor('test','然后他趴在萝卜上大口大口的吃了起来',[{原文:'小兔来了',画面描述:features}],{画面描述:'错误旧图'}),{action:'',features})
  await assert.rejects(sceneFor('test','他趴在萝卜上吃'),/未能确认本格主体/)
})

test('回退时用早格穿着校对，拒绝将胡萝卜的红色转成上衣',async t=>{
  const history=[{原文:'小兔来到湖边',画面描述:'白兔，穿着：无衣物；手持物：红色胡萝卜。'}]
  let checked
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const {messages}=JSON.parse(options.body)
    let result={}
    if(messages[0].content.includes('resolved'))result={resolved:true,features:'小兔穿红衣'}
    if(messages[0].content.includes('matches')){
      checked=JSON.parse(messages[1].content)
      result={matches:false}
    }
    return Response.json({choices:[{message:{content:JSON.stringify(result)}}]})
  })
  await assert.rejects(sceneFor('test','他落到了湖里',history),/穿着与前格/)
  assert.deepEqual(checked.较早画格,history)
  assert.equal(checked.特征,'小兔穿红衣')
})

test('确认角色时区分限流、超时和异常格式，允许格式重试一次',async t=>{
  const replies=[()=>new Response(null,{status:429}),()=>{throw new DOMException('timeout','TimeoutError')},()=>({resolved:true}),()=>({resolved:true}),()=>({}),()=>({resolved:true,features:'白兔，无衣物'})]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const rule=JSON.parse(options.body).messages[0].content
    const result=rule.includes('resolved')?replies.shift()():{}
    if(result instanceof Response)return result
    return Response.json({choices:[{message:{content:JSON.stringify(result)}}]})
  })
  const run=()=>sceneFor('test','他落水了',[{原文:'小兔来到湖边'}])
  await assert.rejects(run(),/确认角色：文字服务限流/)
  await assert.rejects(run(),/确认角色：文字服务超时/)
  await assert.rejects(run(),/确认角色：文字模型返回格式异常/)
  assert.deepEqual(await run(),{action:'',features:'白兔，无衣物'})
  assert.equal(replies.length,0)
})

test('后台自动修正穿着冲突后继续生成',async t=>{
  const history=[{原文:'小兔来到湖边',画面描述:'白兔，穿着：无衣物；手持物：红色胡萝卜。'}]
  const corrected='白兔，穿着：无衣物；手持物：红色胡萝卜。'
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const {messages}=JSON.parse(options.body)
    const context=JSON.parse(messages[1].content)
    let result={}
    if(messages[0].content.includes('resolved'))result={resolved:true,features:context.修订意见?corrected:'小兔穿红衣'}
    if(messages[0].content.includes('matches'))result={matches:context.特征===corrected,reason:'红色属于胡萝卜。'}
    return Response.json({choices:[{message:{content:JSON.stringify(result)}}]})
  })
  assert.deepEqual(await sceneFor('test','他落到了湖里',history),{action:'',features:corrected})
})

test('重画校验拒绝后重新取上下文，二次校验和回退均隔离旧版',async t=>{
  const history=[{原文:'小白兔来到湖边',画面描述:'小白兔，穿着：无衣物。'}]
  const text='小兔子想捞湖里的月亮'
  const calls=[]
  const replies=[{action:'旧动作',features:'旧配饰'},{matches:false,reason:'旧修订'},
    {action:'伸爪',features:'白兔'},{matches:false,reason:'再次拒绝'},
    {resolved:true,features:'小白兔，穿着：无衣物。'},{matches:true}]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const {messages}=JSON.parse(options.body)
    calls.push(JSON.parse(messages[1].content))
    return Response.json({choices:[{message:{content:JSON.stringify(replies.shift())}}]})
  })
  assert.equal((await sceneFor('test',text,history,{原文:'旧原文',画面描述:'旧图描述'})).features,'小白兔，穿着：无衣物。')
  assert.equal(calls.length,6)
  assert.equal(calls[0].待修改画面.原文,'旧原文')
  for(const input of calls.slice(2)){
    assert.equal(input.本格原文,text)
    assert.deepEqual(input.较早画格,history)
    assert.doesNotMatch(JSON.stringify(input),/旧原文|旧图描述|旧动作|旧配饰|旧修订|再次拒绝/)
  }
})

test('将稳定外观和可延续的物件状态分开保存',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({choices:[{message:{content:JSON.stringify({
    appearance:'木屋，蓝色窗框',state:'窗户已打开，窗台有水滴'
  })}}]}))
  const description=await describeImage('test',Buffer.from('image'),'image/png','雨停了，窗户打开了')
  assert.equal(description,'稳定外观：木屋，蓝色窗框\n情节状态：窗户已打开，窗台有水滴')
})

test('结构化外观与状态可以读取，缺少外观会显式报错',async t=>{
  const replies=[{appearance:{角色:'白兔',地标:['湖岸']},state:{位置:'浅滩'}},{state:'走近湖边'}]
  t.mock.method(globalThis,'fetch',async()=>Response.json({choices:[{message:{content:JSON.stringify(replies.shift())}}]}))
  assert.match(await describeImage('test',Buffer.from('image'),'image/png'),/白兔.*湖岸[\s\S]*情节状态：.*浅滩/)
  await assert.rejects(describeImage('test',Buffer.from('image'),'image/png'),/缺少稳定外观/)
})
