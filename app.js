const screen = document.querySelector('#screen')
const message = document.querySelector('#message')
let csrf = '', story = null, page = 0, submitting = false, revision = 0
let retry = null
const escape = text => String(text).replace(/[&<>"']/g, ch => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[ch]))
const button = (action, label, primary=false) =>
  '<button type="button" data-action="'+action+'" class="'+(primary?'primary':'')+'">'+label+'</button>'
async function api(path, body) {
  const result = await fetch('/api/'+path, body ? {
    method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:JSON.stringify(body)
  } : {cache:'no-store'})
  const data = await result.json()
  if (!result.ok) {
    if(result.status===401) login()
    throw Error(data.error)
  }
  if(data.csrf) { csrf=data.csrf; logoutButton.hidden=false }
  return data
}
function reset(){
  revision++
  story=null
  retry=null
  screen.replaceChildren()
  message.textContent=''
}
function login(signup=false){
  logoutButton.hidden=true
  reset()
  csrf=''
  screen.innerHTML='<div class="login-layout"><div class="cover"><img src="/forest.svg" alt="小兔和狐狸在树下读故事"><span class="caption">小兔的林间书房</span></div><form class="auth" data-form="'+(signup?'register':'login')+'"><h1>'+(signup?'创建家庭账号':'登录我的书架')+'</h1><label>用户名<input name="username" autocomplete="username" required maxlength="96"></label><label>密码<input name="password" type="password" autocomplete="'+(signup?'new-password':'current-password')+'" required maxlength="256"></label><button class="primary full">'+(signup?'注册并进入书架':'登录书架')+'</button>'+'<button type="button" class="auth-switch" data-action="'+(signup?'login':'signup')+'">'+(signup?'去登录':'注册账号')+'</button>'+'</form></div>'
}
function shelfTitle(title){
  const chars=Array.from(title)
  return chars.length>10 ? chars.slice(0,10).join('')+'...' : title
}
function limitInput(event){
  const field=event.target
  if(event.isComposing || !field.matches('[data-limit]'))return
  const chars=Array.from(field.value)
  const limit=Number(field.dataset.limit)
  if(chars.length>limit)field.value=chars.slice(0,limit).join('')
}
screen.addEventListener('input',limitInput)
screen.addEventListener('compositionend',limitInput)
async function shelf(){
  reset()
  const data=await api('shelf')
  screen.innerHTML='<div class="shelfHero"><div class="shelfHero-copy"><p>'+escape(data.username)+'的故事屋</p><h1>我的书架</h1>'+button(data.draft?'open':'start',data.draft?(data.draft.state==='ended'?'继续保存':'继续讲'):'＋ 讲新故事',true)+'</div><img src="/forest.svg" alt=""></div><h2>已保存的故事</h2><div class="shelf">'+
    (data.books.map(book=>'<button class="book" data-action="open" data-id="'+book.id+'">'+(book.cover?'<img src="/api/cover/'+book.cover+'" alt="">':'<small data-cover="'+book.id+'">封面生成中</small>')+'<span><b>'+escape(shelfTitle(book.title))+'</b><small>'+book.count+' 格 · '+new Date(book.saved).toLocaleDateString()+'</small></span></button>').join('')||'<p>讲完故事并为它取名，就能收藏第一本漫画。</p>')+'</div>'
  if(data.draft) screen.querySelector('.shelfHero button').dataset.id=data.draft.id
}
function tiles(){
  const panels=story.cells.slice(page*4,page*4+4).map((cell,k)=>'<button class="tile" data-action="detail" data-index="'+(page*4+k)+'">'+(cell.ready?'<img src="/api/media/'+cell.id+'" alt="本格漫画">':'<p>'+escape(cell.error||'绘制中…')+'</p>')+'<small>第 '+(page*4+k+1)+' 格</small><span class="panel-text">'+escape(cell.text)+'</span></button>')
  if(story.state==='draft') while(panels.length<4) panels.push('<div class="empty">第 '+(page*4+panels.length+1)+' 格 · 待讲</div>')
  const total=Math.max(1,Math.ceil(story.cells.length/4))
  const gridClass=story.state==='saved'?'grid story-grid reading-grid':'grid story-grid'
  screen.querySelector('#panels').innerHTML='<div class="'+gridClass+'">'+panels.join('')+'</div><div class="row">'+(page?button('prev','上一页'):'')+'第 '+(page+1)+' / '+total+' 页'+(page+1<total?button('next','下一页'):'')+'</div>'
}
async function openStory(id,last=false){
  reset()
  story=await api('story/'+id)
  page=last?Math.floor(Math.max(0,story.cells.length-1)/4):0
  const back=button('home','返回书架')
  if(story.state==='ended'){
    screen.innerHTML=back+'<h1>给故事起个名字</h1><p>共 '+story.cells.length+' 格，第一格作为封面。</p><form data-form="save"><label>故事名称（必填，最多 10 字）<input name="title" required data-limit="10" placeholder="请输入故事名称"></label><button class="primary">保存到书架</button></form>'
    return
  }
  const draft=story.state==='draft'
  screen.innerHTML=back+'<h1>'+escape(draft?'讲故事':story.title)+'</h1><div class="'+(draft?'wide':'')+'"><section><h2>故事四格</h2><div id="panels"></div></section>'+(draft?'<form data-form="cell"><h2>讲第 '+(story.cells.length+1)+' 格</h2><label>本格文字（最多 100 字）<textarea name="text" required data-limit="100" placeholder="输入这一格的故事"></textarea></label><button class="primary">生成这格</button></form>':'')+'</div>'+(draft?button('finish','故事结束'):'')
  tiles()
}
async function guarded(fn){
  if(submitting)return
  submitting=true
  revision++
  message.textContent=''
  try{await fn()}catch(e){message.textContent=e.message}finally{submitting=false}
}
screen.addEventListener('submit',event=>{
  event.preventDefault()
  const form=event.target
  guarded(async()=>{
    const values=Object.fromEntries(new FormData(form))
    const action=form.dataset.form
    if(action==='cell'){
      if(!retry || retry.text!==values.text) retry={id:story.id,text:values.text,requestId:crypto.randomUUID()}
      const id=story.id
      await api('cell',retry)
      await openStory(id,true)
    }else if(action==='save'){
      await api('save',{id:story.id,...values})
      await shelf()
    }else{
      await api(action,values)
      await shelf()
    }
  })
})
const logoutButton=document.querySelector('.family-header button')
logoutButton.onclick=()=>guarded(async()=>{ await api('logout',{}); login() })
screen.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]')
  if(!target)return
  guarded(async()=>{
    switch(target.dataset.action){
      case 'signup': return login(true)
      case 'login': return login()
      case 'home': return shelf()

      case 'start': return openStory((await api('start',{})).id)
      case 'open': return openStory(target.dataset.id,target.closest('.shelfHero')!==null)
      case 'finish': {
        if(screen.querySelector('textarea')?.value.trim() && !confirm('跳过尚未提交的文字，结束故事？'))return
        const id=story.id
        await api('finish',{id})
        return openStory(id)
      }
      case 'prev': page--;return tiles()
      case 'next': page++;return tiles()
      case 'detail': return viewCell(Number(target.dataset.index))
    }
  })
})
function viewCell(index){
  const dialog=document.createElement('dialog')
  dialog.className='cell-viewer'
  dialog.setAttribute('aria-label','单格阅读')
  dialog.innerHTML='<header><strong aria-live="polite"></strong><button autofocus>返回故事</button></header><div class="viewer-image"></div><p class="viewer-text"></p>'
  const imageArea=dialog.querySelector('.viewer-image')
  const close=dialog.querySelector('button')
  function render(){
    const cell=story.cells[index]
    dialog.querySelector('strong').textContent='第 '+(index+1)+' / '+story.cells.length+' 格'
    dialog.querySelector('.viewer-text').textContent=cell.text
    if(cell.ready){
      const image=new Image()
      image.alt='第 '+(index+1)+' 格漫画'
      image.draggable=false
      image.src='/api/media/'+cell.id
      imageArea.replaceChildren(image)
    }else imageArea.textContent=cell.error||'绘制中…'
  }
  function move(step){
    const target=index+step
    if(target<0 || target>=story.cells.length)return
    index=target
    render()
  }
  let start=null
  imageArea.onpointerdown=e=>{
    if(!e.isPrimary || e.button!==0)return
    start={id:e.pointerId,x:e.clientX,y:e.clientY}
    imageArea.setPointerCapture(e.pointerId)
  }
  imageArea.onpointercancel=()=>{start=null}
  imageArea.onpointerup=e=>{
    if(start?.id!==e.pointerId)return
    const dx=e.clientX-start.x,dy=e.clientY-start.y
    start=null
    if(Math.abs(dx)>=40 && Math.abs(dx)>Math.abs(dy)*1.4)move(-Math.sign(dx))
  }
  dialog.onkeydown=e=>{
    if(e.key==='ArrowRight' || e.key==='ArrowLeft'){
      e.preventDefault()
      move(e.key==='ArrowRight'?1:-1)
    }
  }
  close.onclick=()=>dialog.close()
  dialog.onclose=()=>{
    dialog.remove()
    page=Math.floor(index/4)
    tiles()
    screen.querySelector('[data-index="'+index+'"]')?.focus()
  }
  dialog.addEventListener('storyupdate',render)
  render()
  screen.append(dialog)
  dialog.showModal()
}
let polling=false
setInterval(async()=>{
  if(submitting||polling||document.hidden)return
  const version=revision
  polling=true
  try{
    if(story?.cells.some(c=>!c.ready && !c.error) && screen.querySelector('#panels')){
      const update=await api('story/'+story.id)
      if(version===revision){story=update;tiles();screen.querySelector('.cell-viewer')?.dispatchEvent(new Event('storyupdate'))}
    }else if(screen.querySelector('[data-cover]')){
      const {books}=await api('shelf')
      if(version===revision) for(const book of books){
        const label=screen.querySelector('[data-cover="'+book.id+'"]')
        if(label && book.cover){const image=new Image();image.src='/api/cover/'+book.cover;image.alt='';label.replaceWith(image)}
      }
    }
  }catch(e){if(version===revision)message.textContent=e.message}finally{polling=false}
},1200)
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()})
guarded(shelf)
