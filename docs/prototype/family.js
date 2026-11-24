const el=document.querySelector('#screen');
const lines=['小兔来到池塘边，看见水中的月亮。','它拿起小碗，想把月亮轻轻舀起来。','水波荡开，月亮变成了弯弯的线。','小兔抬头一看，月亮正在天上笑呢。'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(s,fn,primary=false)=>'<button class="'+(primary?'primary':'')+'" onclick="'+fn+'">'+s+'</button>';
let name='',accounts=new Map(),books=[],draft,book,rec=false,typing='',page=0,idx=0,place='',candidate='',signup=false,screen='';
function art(n,alt=false){const c=document.createElement('canvas');c.width=320;c.height=185;const g=c.getContext('2d');g.fillStyle='#f3f2ec';g.fillRect(0,0,320,185);g.strokeStyle='#424740';g.lineWidth=3;function oval(x,y,a,b,color,rot=0){g.beginPath();g.ellipse(x,y,a,b,rot,0,2*Math.PI);g.fillStyle=color;g.fill();g.stroke()}let x=alt?115:90;oval(190,151,122,19,'#d5dedb');oval(243,n%4===3?37:148,15,n%4===2?3:13,'#e8deb8');oval(x,129,24,27,'#fff');oval(x-7,70,7,25,'#fff',-.17);oval(x+10,69,7,26,'#fff',.13);oval(x,98,24,23,'#fff');oval(x+10,94,2,2,'#454840');if(n%4===1||n%4===2){g.beginPath();g.arc(x+36,123,14,0,Math.PI);g.closePath();g.fillStyle='#e6dcba';g.fill();g.stroke()}return c.toDataURL()}
function login(){screen='login';el.innerHTML='<h1>'+ (signup?'注册账号':'登录我的书架')+'</h1><label>用户名<input id="user" autocomplete="off"></label><label>密码<input id="pwd" type="password" autocomplete="off"></label><div class="row">'+btn(signup?'注册并进入':'登录','enter(false)',true)+btn(signup?'已有账号':'注册账号','signup=!signup;login()')+btn('用示例账号体验','enter(true)')+'</div><p id="msg" role="status"></p>'}
function enter(demo){const u=demo?'示例家长':user.value.trim(),p=demo?'demo':pwd.value;if(!u||!p){msg.textContent='请填写用户名和密码';return}if(signup&&!demo&&accounts.has(u)){msg.textContent='用户名已被使用';return}if(!demo&&!signup&&accounts.get(u)?.p!==p){msg.textContent='请先注册，或使用示例账号';return}if(!accounts.has(u))accounts.set(u,{p,books:demo?[{title:'小兔捞月亮',cells:lines.map((t,i)=>({t,i})),saved:true}]:[],draft:null});name=u;books=accounts.get(u).books;home()}
function alive(){const a=accounts.get(name);if(a.draft?.start&&Date.now()>=a.draft.start+86400000)a.draft=null;return a.draft}
function home(){screen='home';draft=alive();el.innerHTML='<h1>我的书架</h1><p class="muted">'+esc(name)+'</p><div class="row">'+btn('＋ 讲新故事','start()',true)+btn('退出账号','signup=false;login()')+'</div>'+(draft?'<div class="box"><b>未完成的故事</b><p>'+draft.cells.length+' 格 · '+(draft.start?'可续写至 '+new Date(draft.start+86400000).toLocaleString():'等待首次生成')+'</p>'+btn('继续讲','resume()')+'</div>':'')+'<h2>已保存的故事</h2>'+(books.map((b,i)=>'<button class="book" onclick="readBook('+i+')"><img src="'+art(b.cells[0].i,b.cells[0].alt)+'"><span><b>'+esc(b.title)+'</b><br>'+b.cells.length+' 格 · '+Math.ceil(b.cells.length/4)+' 页</span></button>').join('')||'<p>书架空着，讲完并命名后，故事会出现在这里。</p>')}
function start(){if(alive()){if(!confirm('已有未完成的故事。开始新故事会替换这份演示草稿，继续吗？'))return}accounts.get(name).draft={cells:[],start:0};resume()}
function resume(){draft=alive();if(!draft)return home();rec=false;typing='';page=Math.max(0,Math.floor((draft.cells.length-1)/4));compose()}
function tile(c,j){return '<button class="tile" onclick="detail('+j+')">'+(c.pending?'<p>绘制中…</p>':'<img alt="第 '+(j+1)+' 格示例漫画" src="'+art(c.i,c.alt)+'">')+'<small>第 '+(j+1)+' 格</small>'+esc(c.t)+'</button>'}
function compose(){if(!alive())return home();screen='compose';place='draft';const n=draft.cells.length;let entry='<section><h2>讲第 '+(n+1)+' 格</h2><p>'+ (rec?'正在模拟录音…':'讲完一格，就可以继续下一格。')+'</p><div class="row">'+btn(rec?'重新讲':'开始讲',rec?'recordAgain()':'recordNow()')+'</div><label>本格文字<textarea id="words" placeholder="也可以直接输入故事" oninput="typing=this.value">'+esc(typing)+'</textarea></label>'+btn('这格讲完了 · 生成漫画','submitCell()',true)+'</section>';const pageCount=Math.max(1,Math.ceil(n/4));
page=Math.min(page,pageCount-1);
const slots=Array.from({length:4},(_,k)=>{
  const j=page*4+k;
  return j<n?tile(draft.cells[j],j):'<div class="empty">第 '+(j+1)+' 格 · 待讲</div>';
}).join('');
const pager='<div class="row">'+(page?btn('上一页','page--;compose()'):'')+'<small>第 '+(page+1)+' / '+pageCount+' 页</small>'+(page+1<pageCount?btn('下一页','page++;compose()'):'')+'</div>';
const preview='<section><h2>故事四格</h2><div class="grid">'+slots+'</div>'+pager+'</section>';
el.innerHTML=btn('返回书架','home()')+'<h1>讲故事</h1><div class="wide">'+preview+entry+'</div><hr>'+btn('整本讲完了','finish()');
}
function recordNow(){rec=true;typing=lines[draft.cells.length%4];compose()}function recordAgain(){rec=true;typing='';compose();words.placeholder='已重新开始。输入新讲述，或提交示例语音。'}
function submitCell(){if(!alive())return home();let t=typing.trim()||(rec?lines[draft.cells.length%4]:'');if(!t)return alert('请先讲一段或输入文字');let c={t,i:draft.cells.length,pending:true};draft.start||=Date.now();draft.cells.push(c);page=Math.floor(c.i/4);typing='';rec=false;compose();setTimeout(()=>{c.pending=false;if(screen==='compose')compose();if(screen==='read')reader()},850)}
function finish(){if(!draft.cells.length)return alert('请先完成至少一格');if((typing||rec)&&!confirm('当前格还未提交。跳过当前格，结束整本故事？'))return;screen='finish';el.innerHTML='<h1>给故事起个名字</h1><p>共 '+draft.cells.length+' 格，第一格作为封面。</p><label>故事名称（必填）<input id="titleInput"></label><div class="row">'+btn('继续讲','compose()')+btn('保存到书架','saveBook()',true)+'</div><p id="msg"></p>'}
function saveBook(){if(!alive())return home();let t=titleInput.value.trim();if(!t){msg.textContent='请填写故事名称';return}draft.title=t;books.unshift(draft);accounts.get(name).draft=null;home()}
function readBook(i){book=books[i];page=0;reader()}
function reader(){screen='read';place='book';let pages=Math.ceil(book.cells.length/4);el.innerHTML=btn('返回书架','home()')+'<h1>'+esc(book.title)+'</h1><p>第 '+(page+1)+' / '+pages+' 页 · 点漫画可放大或修改</p><div class="grid">'+book.cells.slice(page*4,page*4+4).map((c,k)=>tile(c,page*4+k)).join('')+'</div><div class="row">'+(page?btn('上一页','page--;reader()'):'')+(page+1<pages?btn('下一页','page++;reader()'):'')+'</div><footer class="row">'+btn('删除故事','removeBook()')+'</footer>'}
function removeBook(){if(confirm('确认删除《'+book.title+'》？整本漫画将从书架移除。')){books.splice(books.indexOf(book),1);home()}}
function cells(){return (place==='book'?book:draft).cells}
function back(){place==='book'?reader():compose()}
function detail(j){idx=j;const c=cells()[j];if(c.pending)return alert('这格正在绘制');screen='detail';el.innerHTML=btn('返回故事','back()')+'<h1>第 '+(j+1)+' 格</h1><img class="art" src="'+art(c.i,c.alt)+'"><label>本格正文<textarea id="edit">'+esc(c.t)+'</textarea></label><div class="row">'+btn('重新录音（模拟）','edit.value=lines[(idx+1)%4]')+btn('重新生成这格','compare()',true)+'</div>'}
function compare(){candidate=edit.value.trim();if(!candidate)return alert('请填写本格内容');let c=cells()[idx];el.innerHTML='<h1>采用这次重画？</h1><div class="grid">'+[[c.t,c.alt,'原图'],[candidate,!c.alt,'候选图']].map(([t,a,l])=>'<div><b>'+l+'</b><img class="art" src="'+art(c.i,a)+'"><p>'+esc(t)+'</p></div>').join('')+'</div><div class="row">'+btn('保留原图','back()')+btn('采用新图','adopt()',true)+'</div>'}
function adopt(){let c=cells()[idx];c.t=candidate;c.alt=!c.alt;back()}
login();
