const el=document.querySelector('#screen');
const lines=['小兔来到池塘边，看见水中的月亮。','它拿起小碗，想把月亮轻轻舀起来。','水波荡开，月亮变成了弯弯的线。','小兔抬头一看，月亮正在天上笑呢。'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(s,fn,primary=false)=>'<button class="'+(primary?'primary':'')+'" onclick="'+fn+'">'+s+'</button>';
let name='',accounts=new Map(),books=[],draft,book,rec=false,typing='',page=0,idx=0,place='',candidate='',signup=false,screen='';
function art(n,alt=false){const c=document.createElement('canvas');c.width=320;c.height=185;const g=c.getContext('2d');g.fillStyle='#fae7c9';g.fillRect(0,0,320,185);g.strokeStyle='#4a564a';g.lineWidth=3;function oval(x,y,a,b,color,rot=0){g.beginPath();g.ellipse(x,y,a,b,rot,0,2*Math.PI);g.fillStyle=color;g.fill();g.stroke()}const sky=['#ffe1af','#d2e6d6','#d2e3ef','#cfdbeb'][n%4];g.fillStyle=sky;g.fillRect(0,0,320,185);g.fillStyle='#9abe99';g.beginPath();g.moveTo(0,125);g.quadraticCurveTo(80,73,169,113);g.quadraticCurveTo(230,146,320,85);g.lineTo(320,185);g.lineTo(0,185);g.fill();let x=alt?116:84;oval(190,151,122,19,'#96cbbd');oval(243,n%4===3?37:148,15,n%4===2?3:13,'#f6c365');oval(x,129,24,27,'#fff');oval(x-7,70,7,25,'#fff',-.17);oval(x+10,69,7,26,'#fff',.13);oval(x,98,24,23,'#fff');oval(x+10,94,2,2,'#454840');if(n%4===1||n%4===2){g.beginPath();g.arc(x+36,123,14,0,Math.PI);g.closePath();g.fillStyle='#e6dcba';g.fill();g.stroke()}oval(x+4,101,5,3,'#eeb79a');g.strokeStyle='#669680';g.beginPath();g.moveTo(21,157);g.lineTo(17,147);g.moveTo(21,157);g.lineTo(26,144);g.stroke();return c.toDataURL()}
const seedStory = [
  '小芽在窗边发现一颗种子，把它放进红花盆。',
  '她轻轻盖上土，又给种子浇了三滴水。',
  '过了几天，两片小叶子从土里探出头。',
  '小芽把盆转向阳光，叶子中间冒出圆圆的花苞。',
  '清晨，花苞打开了。原来是一朵金色的向日葵！',
  '风一吹，小蜜蜂落在花心。小芽的窗台有客人啦。'
];

function panelArt(cell, alternate = cell.alt) {
  if (cell.story !== 'seed') return art(cell.i, alternate);
  const stage = cell.i;
  const stemTop = [124,124,101,76,69,69][stage];
  const plant = stage < 2 ? '' : '<path d="M160 128 Q165 108 160 '+stemTop+'" fill="none" stroke="#53784e" stroke-width="5"/><path d="M161 113q-24 0-27-19 23 0 27 19m0-7q19-20 31-14-6 19-31 14" fill="#82a968"/>';
  const flower = stage < 4 ? '' : Array.from({length:9},(_,k)=>'<ellipse cx="160" cy="50" rx="8" ry="14" fill="#efb842" transform="rotate('+k*40+' 160 69)"/>').join('')+'<circle cx="160" cy="69" r="12" fill="#976542"/>';
  const scenes = [
    '<ellipse cx="160" cy="103" rx="5" ry="9" transform="rotate(31 160 103)" fill="#996039"/><path d="m157 79 1 8" stroke="#926d55"/>',
    '<g fill="#8cbcc0"><path d="M143 81q-10 13 0 14 9-1 0-14Zm21 10q-10 13 0 14 9-1 0-14Zm18-18q-10 13 0 14 9-1 0-14Z"/></g>',
    '', '<ellipse cx="160" cy="75" rx="11" ry="14" fill="#91ab62"/>', '',
    '<g transform="translate(180 60) rotate(-20)"><ellipse cx="-3" cy="-7" rx="6" ry="7" fill="#fff9dd"/><ellipse rx="12" ry="8" fill="#e6b445"/><path d="M-3-7v14m7-13v12" stroke="#574d39" stroke-width="3"/></g>'
  ];
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 185" width="320" height="185"><rect width="320" height="185" fill="'+(alternate?'#dfecdc':'#f5ecd6')+'"/><rect x="18" y="12" width="284" height="133" rx="9" fill="#cfe3da"/><circle cx="254" cy="45" r="18" fill="#f9d78b"/><path d="M18 123q47-32 105-7t99-8q49-22 80-1v38H18" fill="#a6c3a1"/><rect y="145" width="320" height="40" fill="#e5c9a4"/><g transform="translate('+(alternate?12:0)+' 0)">'+plant+flower+scenes[stage]+'<path d="m128 125 8 43h48l8-43" fill="#cc8261" stroke="#986244" stroke-width="2"/><rect x="124" y="120" width="72" height="11" rx="4" fill="#df9572" stroke="#986244" stroke-width="2"/></g></svg>';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
const logoutButton=document.querySelector('.family-header button')
logoutButton.onclick=()=>{signup=false;login()}
function login(){
  logoutButton.hidden=true
  screen='login';
  el.innerHTML='<div class="login-layout"><div class="cover"><img src="forest.svg" alt="小兔和狐狸在树下翻开一本故事书"><span class="caption">小兔的林间书房</span></div><form class="auth"><h1>'+(signup?'创建家庭账号':'登录我的书架')+'</h1><p class="muted">'+(signup?'起个用户名，开始收藏你们的故事。':'打开书架，一起读上次讲的故事。')+'</p><label>用户名<input id="user" required autocomplete="username" placeholder="输入用户名"></label><label>密码<input id="pwd" required type="password" autocomplete="'+(signup?'new-password':'current-password')+'" placeholder="输入密码"></label><button class="primary full">'+(signup?'注册并进入书架':'登录书架')+'</button><button type="button" class="auth-switch" onclick="signup=!signup;login()">'+(signup?'去登录':'注册账号')+'</button><button type="button" class="sample" onclick="enter(true)">先体验示例书架 →</button><p id="msg" role="status"></p></form></div>';
  el.querySelector('form').onsubmit=e=>{e.preventDefault();enter(false)};
}
function enter(demo){const u=demo?'示例家长':user.value.trim(),p=demo?'demo':pwd.value;if(!u||!p){msg.textContent='请填写用户名和密码';return}if(signup&&!demo&&accounts.has(u)){msg.textContent='用户名已被使用';return}if(!demo&&!signup&&accounts.get(u)?.p!==p){msg.textContent='请先注册，或使用示例账号';return}if(!accounts.has(u))accounts.set(u,{p,books:demo?[{title:'窗台上的小客人',cells:seedStory.map((t,i)=>({t,i,story:'seed'})),saved:true},{title:'小兔捞月亮',cells:lines.map((t,i)=>({t,i})),saved:true}]:[],draft:demo?{cells:seedStory.slice(0,5).map((t,i)=>({t,i,story:'seed'})),start:Date.now()}:null});name=u;books=accounts.get(u).books;home()}
function alive(){const a=accounts.get(name);if(a.draft?.start&&Date.now()>=a.draft.start+86400000)a.draft=null;return a.draft}
function home(){
  logoutButton.hidden=false
  screen='home'; draft=alive();
  const list=books.map((b,i)=>'<button class="book" onclick="readBook('+i+')"><img alt="" src="'+panelArt(b.cells[0])+'"><span><b>'+esc(b.title)+'</b><small>'+b.cells.length+' 格 · '+Math.ceil(b.cells.length/4)+' 页'+(b.date?' · '+esc(b.date):'')+'</small></span></button>').join('');
  el.innerHTML='<div class="shelfHero"><div class="shelfHero-copy"><p>'+esc(name)+'的故事屋</p><h1>我的书架</h1>'+btn('＋ 讲新故事','start()',true)+'</div><img src="forest.svg" alt="树下共读的小兔和狐狸"></div>'+(draft?'<div class="box"><b>未完成的故事</b><p>'+draft.cells.length+' 格 · '+(draft.start?'可续写至 '+new Date(draft.start+86400000).toLocaleString():'等待首次生成')+'</p>'+btn('继续讲','resume()')+'</div>':'')+'<h2>已保存的故事</h2><div class="shelf">'+(list||'<p>讲完故事并为它取名，就能收藏第一本漫画。</p>')+'</div><footer class="row">'+btn('注销账号','deleteAccount()')+'</footer>';
}
function deleteAccount(){
  ask('注销「'+name+'」？','注销后，这个演示账号的故事和草稿将一起移除。','确认注销',()=>{accounts.delete(name);signup=false;login()});
}
function ask(title,text,action,confirmAction){
  const dialog=document.createElement('dialog');
  dialog.innerHTML='<h2>'+esc(title)+'</h2><p>'+esc(text)+'</p><div class="row"><button autofocus>取消</button><button class="danger">'+esc(action)+'</button></div>';
  document.body.append(dialog);
  dialog.querySelector('button').onclick=()=>dialog.close();
  dialog.querySelector('.danger').onclick=()=>{dialog.close();confirmAction()};
  dialog.onclose=()=>dialog.remove();
  dialog.showModal();
}
function start(){if(alive()){if(!confirm('已有未完成的故事。开始新故事会替换这份演示草稿，继续吗？'))return}accounts.get(name).draft={cells:[],start:0};resume()}
function resume(){draft=alive();if(!draft)return home();rec=false;typing='';page=Math.max(0,Math.floor((draft.cells.length-1)/4));compose()}
function tile(c,j){return '<button class="tile" onclick="detail('+j+')">'+(c.pending?'<p>绘制中…</p>':'<img alt="第 '+(j+1)+' 格示例漫画" src="'+panelArt(c)+'">')+'<small>第 '+(j+1)+' 格</small><span class="panel-text">'+esc(c.t)+'</span></button>'}
function compose(){if(!alive())return home();screen='compose';place='draft';const n=draft.cells.length;let entry='<section><h2>讲第 '+(n+1)+' 格</h2><p>'+ (rec?'正在模拟录音…':'讲完一格，就可以继续下一格。')+'</p><div class="row">'+btn(rec?'重新讲':'开始讲',rec?'recordAgain()':'recordNow()')+'</div><label>本格文字<textarea id="words" placeholder="也可以直接输入故事" oninput="typing=this.value">'+esc(typing)+'</textarea></label>'+btn('这格讲完了 · 生成漫画','submitCell()',true)+'</section>';const pageCount=Math.max(1,Math.ceil(n/4));
page=Math.min(page,pageCount-1);
const slots=Array.from({length:4},(_,k)=>{
  const j=page*4+k;
  return j<n?tile(draft.cells[j],j):'<div class="empty">第 '+(j+1)+' 格 · 待讲</div>';
}).join('');
const pager='<div class="row">'+(page?btn('上一页','page--;compose()'):'')+'<small>第 '+(page+1)+' / '+pageCount+' 页</small>'+(page+1<pageCount?btn('下一页','page++;compose()'):'')+'</div>';
const preview='<section><h2>故事四格</h2><div class="grid story-grid">'+slots+'</div>'+pager+'</section>';
el.innerHTML=btn('返回书架','home()')+'<h1>讲故事</h1><div class="wide">'+preview+entry+'</div><hr>'+btn('故事结束','finish()');
}
function sampleLine(){const n=draft.cells.length;return draft.cells[0]?.story==='seed' && n<seedStory.length ? seedStory[n] : lines[n%4]}
function recordNow(){rec=true;typing=sampleLine();compose()}function recordAgain(){rec=true;typing='';compose();words.placeholder='已重新开始。输入新讲述，或提交示例语音。'}
function submitCell(){if(!alive())return home();let t=typing.trim()||(rec?sampleLine():'');if(!t)return alert('请先讲一段或输入文字');let c={t,i:draft.cells.length,pending:true};if(draft.cells[0]?.story==='seed' && c.i<seedStory.length)c.story='seed';draft.start||=Date.now();draft.cells.push(c);page=Math.floor(c.i/4);typing='';rec=false;compose();setTimeout(()=>{c.pending=false;if(screen==='compose')compose();if(screen==='read')reader()},850)}
function finish(){if(!draft.cells.length)return alert('请先完成至少一格');if((typing||rec)&&!confirm('当前格还未提交。跳过当前格，结束整本故事？'))return;screen='finish';el.innerHTML='<h1>给故事起个名字</h1><p>共 '+draft.cells.length+' 格，第一格作为封面。</p><label>故事名称（必填）<input id="titleInput"></label><div class="row">'+btn('继续讲','compose()')+btn('保存到书架','saveBook()',true)+'</div><p id="msg"></p>'}
function saveBook(){if(!alive())return home();let t=titleInput.value.trim();if(!t){msg.textContent='请填写故事名称';return}draft.title=t;draft.date=new Date().toLocaleDateString();books.unshift(draft);accounts.get(name).draft=null;home()}
function readBook(i){book=books[i];page=0;reader()}
function reader(){screen='read';place='book';let pages=Math.ceil(book.cells.length/4);el.innerHTML=btn('返回书架','home()')+'<h1>'+esc(book.title)+'</h1><p>第 '+(page+1)+' / '+pages+' 页 · 点漫画可放大或修改</p><div class="grid story-grid reading-grid">'+book.cells.slice(page*4,page*4+4).map((c,k)=>tile(c,page*4+k)).join('')+'</div><div class="row">'+(page?btn('上一页','page--;reader()'):'')+(page+1<pages?btn('下一页','page++;reader()'):'')+'</div><footer class="row">'+btn('删除故事','removeBook()')+'</footer>'}
function removeBook(){ask('删除《'+book.title+'》？','整本漫画将从你的书架移除。','确认删除',()=>{books.splice(books.indexOf(book),1);home()})}
function cells(){return (place==='book'?book:draft).cells}
function back(){place==='book'?reader():compose()}
function detail(j){idx=j;const c=cells()[j];if(c.pending)return alert('这格正在绘制');screen='detail';el.innerHTML=btn('返回故事','back()')+'<h1>第 '+(j+1)+' 格</h1><img class="art" src="'+panelArt(c)+'"><label>本格正文<textarea id="edit">'+esc(c.t)+'</textarea></label><div class="row">'+btn('重新录音（模拟）','edit.value=lines[(idx+1)%4]')+btn('重新生成这格','compare()',true)+'</div>'}
function compare(){candidate=edit.value.trim();if(!candidate)return alert('请填写本格内容');let c=cells()[idx];el.innerHTML='<h1>采用这次重画？</h1><div class="grid">'+[[c.t,c.alt,'原图'],[candidate,!c.alt,'候选图']].map(([t,a,l])=>'<div><b>'+l+'</b><img class="art" src="'+panelArt(c,a)+'"><p>'+esc(t)+'</p></div>').join('')+'</div><div class="row">'+btn('保留原图','back()')+btn('采用新图','adopt()',true)+'</div>'}
function adopt(){let c=cells()[idx];c.t=candidate;c.alt=!c.alt;back()}
login();
