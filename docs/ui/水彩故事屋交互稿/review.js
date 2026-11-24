const $=s=>document.querySelector(s),screenEl=$('#screen'),pop=$('#pop');
const pages=['登录','注册','我的书架','讲故事','故事命名','阅读故事','修改这格','版本对照','修改密码','用户管理','模型配置'];
const icons={account:'账号',lock:'密码',eye:'显示密码','eye-off':'隐藏密码',delete:'删除',mic:'录音',stop:'停止',retell:'重新讲',plus:'新增',back:'上一格',next:'下一格',down:'展开',close:'关闭',logout:'退出','remove-account':'注销账号',edit:'修改',check:'确认',warning:'提醒'};
let page=0,user='小禾',admin=false,books=['湖边的小兔','狐狸与枫叶','森林里的花','松鼠的苹果','湖畔的早晨'].map((title,i)=>({title,cells:[{text:title,img:i%4+1},{text:'沿着林间小径，一起回家。',img:(i+1)%4+1}]})),cells=[],words='',idx=0,cell=0,pn=0,record=false,users=['小禾','团团','admin'],cfg=['wanx2.0-t2i-turbo','2','20'];
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const ic=k=>'<img class="ic" alt="" src="assets/'+k+'.png">';
const btn=(s,action,k='',cl='')=>'<button class="btn '+cl+'" data-act="'+action+'">'+(k?ic(k):'')+s+'</button>';
const panel=(title,body)=>'<section class="panel"><h2>'+esc(title)+'</h2>'+body+'</section>';
const field=(id,label,pass=false)=>'<label>'+label+'<span class="field">'+ic(pass?'lock':'account')+'<input id="'+id+'" '+(pass?'type="password"':'')+' autocomplete="off" placeholder="'+label+'">'+(pass?'<button type="button" aria-label="显示或隐藏密码" data-act="eye:'+id+'">'+ic('eye')+'</button>':'')+'</span></label>';
const art=n=>'assets/sample-'+n+'.png';
function go(n){page=n;pop.innerHTML='';record=false;render();screenEl.scrollTop=0}
function modal(title,body,actions){pop.innerHTML='<div class="shade"><section class="modal"><h2>'+esc(title)+'</h2><p>'+body+'</p><div class="actions">'+actions+'</div></section></div>'}
const cancel=()=>btn('取消','dismiss');
function accountMenu() {
  const actions = btn('修改密码','pass','lock') + btn('退出账号','exit','logout')
    + (admin ? '' : btn('注销','closeacct','remove-account','close-account'));
  return '<div class="account-anchor"><button class="btn small" data-act="menu" popovertarget="account-options">'
    + ic('account') + '账号</button><div id="account-options" popover class="account-actions" aria-label="账号操作">'
    + actions + '</div></div>';
}
function render(){let h='',book=books[idx]||{title:'故事',cells:[{text:'小兔来到了湖边。',img:1}]};$('#jump').value=page;screenEl.classList.toggle('writing',[3,4,6,7].includes(page));
if(page<2)h=panel(page?'创建家庭账号':'登录我的书架',field('username','用户名')+field('pwd','密码',true)+btn(page?'注册并进入书架':'登录书架','login','','primary wide')+btn(page?'去登录':'注册账号','switch','','link'));
if(page===2){pn=Math.max(0,Math.min(pn,Math.ceil(books.length/4)-1));h='<div class="shelf"><div class="toolbar"><b>'+esc(user)+'的书架</b>'+accountMenu()+'</div><div class="new">'+btn(cells.length||words?'继续讲':'讲新故事','write','plus','primary')+'</div><div class="case"><div class="books">'+books.slice(pn*4,pn*4+4).map((b,i)=>'<div class="book"><button class="book-open" data-act="read:'+(pn*4+i)+'"><img class="binding" src="assets/book.png"><img class="art" src="'+art(b.cells[0].img)+'"><b>'+esc(b.title)+'</b></button><button class="trash" aria-label="删除故事" data-act="delete:'+(pn*4+i)+'">'+ic('delete')+'</button></div>').join('')+'</div>'+(!books.length?'<p class="empty">讲完故事并为它取名，<br>就能收藏第一本漫画。</p>':'')+'</div>'+ (books.length?'<div class="pager">'+btn('上一页','prev')+'<select id="pick">'+Array.from({length:Math.ceil(books.length/4)},(_,i)=>'<option '+(i===pn?'selected':'')+' value="'+i+'">第 '+(i+1)+' 页</option>').join('')+'</select>'+btn('下一页','next')+'</div>':'')+'</div>'}
if(page===3||page===6){h=panel(page===3?'讲第 '+(cells.length+1)+' 格':'修改第 '+(cell+1)+' 格','<small>'+ (record?'正在听…':'每格最多讲 60 秒')+'</small>'+btn(record?'这格讲完了':page===6?'重新讲':'开始讲','voice',record?'stop':'mic','wide '+(record?'danger':''))+'<label>本格文字（最多 100 字）<textarea id="words" maxlength="100" placeholder="也可以直接输入故事">'+esc(words)+'</textarea></label>'+btn(page===3?'生成这格':'重新生成这格','generate','','wide primary'))+(page===3?cells.map((c,i)=>panel('第 '+(i+1)+' 格','<img class="story" src="'+art(c.img)+'"><p>'+esc(c.text)+'</p>')).join('')+btn('故事结束','finish','','wide'):'')}
if(page===4)h=panel('给故事起个名字','<input id="name" aria-label="故事名称（最多 10 字）" maxlength="10" placeholder="输入故事名称（最多 10 字）">'+btn('保存到书架','save','','wide primary'));
if(page===5)h=panel(book.title,book.cells.map((c,i)=>'<div class="read-art"><button class="story-tile" data-act="view:'+i+'"><img class="story" src="'+art(c.img)+'"></button><button class="edit-badge" aria-label="修改这格" data-act="edit:'+i+'">'+ic('edit')+'</button></div><p class="caption">第 '+(i+1)+' 格 · '+esc(c.text)+'</p>').join('<hr>'));
if(page===7)h=panel('第 '+(cell+1)+' 格 · 版本对照',['原版','新版'].map((s,i)=>'<h3>'+s+'</h3><div class="comparison-frame"><img class="story" src="'+art(i?alt():book.cells[cell].img)+'"></div><p>'+esc(i?words:book.cells[cell].text)+'</p>').join('')+'<div class="actions">'+btn('保留原版','discard')+btn('采用新版','adopt','','primary')+'</div>');
if(page===8)h=panel('修改密码',field('old','当前密码',true)+field('new','新密码',true)+field('repeat','确认新密码',true)+btn('确认修改','password','','primary wide'));
if(page>=9){h='<div class="toolbar"><b>故事屋管理</b>'+accountMenu()+'</div><div class="tabs">'+btn('用户管理','users','',page===9?'active':'')+btn('模型配置','config','',page===10?'active':'')+'</div>';h+=page===9?panel('用户管理','<div class="user"><b>用户名</b><b>最近登录时间</b><b>操作</b></div>'+users.map((u,i)=>'<div class="user"><b>'+u+'</b><span>2026-11-24<br>09:21</span><span>'+(u==='admin'?'管理员':btn('重置密码','reset:'+i)+btn('删除用户','remove:'+i))+'</span></div>').join('')):panel('模型配置',['百炼模型','全站月预算（元）','每账号月额度（张）'].map((s,i)=>'<label>'+s+'<input id="cfg'+i+'" value="'+esc(cfg[i])+'"></label>').join('')+field('key','API Key（演示）',true)+btn('保存配置','configsave','','primary wide'))}
screenEl.innerHTML='<div class="body">'+h+'</div>';if(page===2&&$('#pick')){let bs=screenEl.querySelectorAll('.pager button');bs[0].disabled=pn===0;bs[1].disabled=pn+1>=Math.ceil(books.length/4)}}
function alt(){return (books[idx]?.cells[cell]?.img||1)%4+1}
function view(i) {
  cell=i;
  const panels=books[idx].cells, current=panels[i];
  pop.innerHTML='<div class="full"><button class="close" aria-label="关闭" data-act="dismiss">'+ic('close')+'</button>'
    +'<img class="story" draggable="false" src="'+art(current.img)+'"><p>'+esc(current.text)+'</p>'
    +'<div class="cell-count">'+(i+1)+' / '+panels.length+'</div></div>';
  const image=pop.querySelector('.story');
  let start;
  image.onpointerdown=e=>{
    if (!e.isPrimary || e.button!==0) return;
    start={x:e.clientX,y:e.clientY,id:e.pointerId};
    image.setPointerCapture(e.pointerId);
  };
  image.onpointercancel=image.onlostpointercapture=()=>{start=null};
  image.onpointerup=e=>{
    if (!start || start.id!==e.pointerId) return;
    const dx=e.clientX-start.x, dy=e.clientY-start.y;
    start=null;
    if (Math.abs(dx)<40 || Math.abs(dx)<=Math.abs(dy)) return;
    const next=i+(dx<0?1:-1);
    if (next>=0 && next<panels.length) view(next);
  };
}
function info(t){modal('提示',t,btn('知道了','dismiss'))}
function act(v){let [a,k]=v.split(':'),i=Number(k);switch(a){
case 'eye':{let f=document.getElementById(k);f.type=f.type==='password'?'text':'password';break}
case 'login':user=$('#username').value.trim()||'小禾';admin=user==='admin';go(admin?9:2);break;
case 'switch':go(1-page);break;case 'users':go(9);break;case 'config':go(10);break;
case 'write':go(3);break;case 'prev':pn--;render();break;case 'next':pn++;render();break;
case 'pass':go(8);break;case 'exit':go(0);break;case 'closeacct':$('#account-options')?.hidePopover();modal('注销账号','账号、已保存的故事和未完成草稿将永久删除。',cancel()+btn('确认注销','erase','','danger'));break;
case 'erase':books=[];cells=[];words='';go(0);break;
case 'password':if(!$('#old').value||!$('#new').value||$('#new').value!==$('#repeat').value)return info('请填写当前密码，并确保两次新密码一致。');go(admin?9:2);break;
case 'delete':modal('删除故事','确定删除《'+esc(books[i].title)+'》吗？',cancel()+btn('确认删除','del:'+i,'delete','danger'));break;
case 'del':books.splice(i,1);go(2);break;
case 'voice':words=$('#words').value;if(record)words='小兔沿着湖边走，看见了盛开的雏菊。';record=!record;render();break;
case 'generate':words=$('#words').value.trim();if(!words)return info('请先讲述或输入本格故事。');if(page===6)return go(7);cells.push({text:words,img:cells.length%4+1});words='';go(3);break;
case 'finish':if(!cells.length)return info('先完成一格故事，再给它取名字。');go(4);break;
case 'save':{let t=$('#name').value.trim();if(!t)return info('请输入故事名称。');books.unshift({title:t,cells:[...cells]});cells=[];words='';pn=0;go(2);break}
case 'read':idx=i;cell=0;go(5);break;case 'view':view(i);break;case 'edit':cell=i;words=books[idx].cells[i].text;go(6);break;
case 'discard':words='';go(5);break;case 'adopt':books[idx].cells[cell]={text:words,img:alt()};words='';go(5);break;
case 'remove':modal('删除用户','确定删除「'+users[i]+'」及其已保存的故事和草稿吗？',cancel()+btn('确认删除','rm:'+i,'delete','danger'));break;case 'rm':users.splice(i,1);go(9);break;
case 'reset':modal('重置密码','重置「'+users[i]+'」的演示密码？',cancel()+btn('确认重置','resetdone'));break;case 'resetdone':info('演示密码已重置。');break;
case 'configsave':cfg=cfg.map((_,j)=>$('#cfg'+j).value);info('本次预览配置已保存。');break;case 'dismiss':pop.innerHTML='';break}}
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)act(b.dataset.act)});
document.addEventListener('input',e=>{if(e.target.id==='words')words=e.target.value});
document.addEventListener('change',e=>{if(e.target.id==='pick'){pn=Number(e.target.value);render()}});
$('#jump').innerHTML=pages.map((s,i)=>'<option value="'+i+'">'+s+'</option>').join('');
$('#jump').onchange=e=>{let n=Number(e.target.value);if([5,6,7].includes(n)&&!books.length){return go(2)}idx=0;cell=0;if([6,7].includes(n))words=books[0].cells[0].text;admin=n>=9;go(n)};
$('#back').onclick=()=>go(page===8&&admin?9:[0,1,9,10].includes(page)?0:[6,7].includes(page)?5:page===4?3:2);
const files={'forest-original.png':'共用背景（原图）','writing.png':'讲述背景','book.png':'空白书本','cabinet.png':'空木架',...Object.fromEntries(Object.entries(icons).map(([k,v])=>[k+'.png',v])),...Object.fromEntries([1,2,3,4].map(i=>['sample-'+i+'.png','示例封面 '+i]))};
$('#items').innerHTML=Object.entries(files).map(([f,s])=>'<a download href="assets/'+f+'"><img src="assets/'+f+'">'+s+'</a>').join('');$('#gallery').onclick=()=>$('#library').showModal();$('#dismiss').onclick=()=>$('#library').close();go(0);
