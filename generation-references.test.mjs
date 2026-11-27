import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
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
  const originals=[]
  const prompts=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    url=String(url)
    if(url.endsWith('/chat/completions')){
      const {messages}=JSON.parse(options.body)
      let result={approved:true}
      if(messages[0].content.includes('插画师只收到本格文字')){
        const {本格原文,较早画格,待修改画面}=JSON.parse(messages[1].content)
        histories.push(较早画格)
        originals.push(待修改画面)
        result={scene:本格原文+'。背景主色浅蓝，中央有一棵红枫。'}
      }else if(Array.isArray(messages[1].content))result.appearance='蓝色短靴，黑色点眼。'
      return Response.json({choices:[{message:{content:JSON.stringify(result)}}]})
    }
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
  }
  assert.equal(histories.length,10)
  assert.deepEqual(histories[1],[{原文:'外星人来到了地球',画面描述:'蓝色短靴，黑色点眼。'}])
  assert.deepEqual(histories[2],[])
  assert.deepEqual(histories[5].map(frame=>frame.原文),['小猫看书','小狗捡球','小猫拍手'])
  for(const prompt of prompts){
    assert.match(prompt,/儿童画风格/)
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
  assert.match(histories.at(-1)[0].画面描述,/外星人来到了地球。背景主色浅蓝/)
  assert.equal(originals.at(-1).画面描述,'蓝色短靴，黑色点眼。')
})
