const form=document.querySelector('form')
const fields=form.elements
const status=document.querySelector('#status')
const token=location.hash.slice(1) || sessionStorage.getItem('operator')
if(location.hash){
  history.replaceState(null,'',location.pathname)
  sessionStorage.setItem('operator',token)
}
let version
async function request(body){
  const response=await fetch('/config',{
    method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+(token||''),'Content-Type':'application/json'},
    body:body && JSON.stringify(body)
  })
  const data=await response.json()
  if(!response.ok)throw Error(data.error)
  version=data.version
  fields.model.replaceChildren(...data.models.map(m=>new Option(m,m)))
  fields.model.value=data.model
  fields.budget.value=data.budget
  fields.quota.value=data.quota
  fields.key.value=''
  fields.key.required=!data.configured
  document.querySelector('#key-state').textContent=data.configured?'已保存密钥。留空沿用，填写新值可替换。':'尚未配置密钥。'
  form.querySelector('fieldset').disabled=false
}
form.onsubmit=async event=>{
  event.preventDefault()
  const submit=form.querySelector('button')
  submit.disabled=true
  status.textContent='保存中…'
  try{
    await request({version,model:fields.model.value,budget:fields.budget.valueAsNumber,quota:fields.quota.valueAsNumber,key:fields.key.value.trim()})
    status.textContent='配置已保存'
  }catch(e){status.textContent=e.message}finally{submit.disabled=false}
}
request().catch(e=>{status.textContent=e.message})
