const storage='story.session.v1'
const local=wx.getDeviceInfo().platform==='devtools'
const base=local?'http://127.0.0.1:3085/api/mini':'https://story-test.linjiangushiwu.cn/api/mini'
export const session=()=>wx.getStorageSync(storage)||''
export function leave(){
  wx.removeStorageSync(storage)
  wx.reLaunch({url:'/pages/login/index'})
}
export function accept(token:string,role:string,mustChange=false){
  wx.setStorageSync(storage,token)
  wx.reLaunch({url:mustChange?'/pages/password/index?setup=1':role==='admin'?'/pages/admin/index':'/pages/shelf/index'})
}
export async function request(path:string,data?:object):Promise<any>{
  const token=session()
  return new Promise((resolve,reject)=>wx.request({
    url:base+'/'+path, method:data?'POST':'GET',data,
    header:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    success:r=>{
      if(r.statusCode===401 && token && session()===token)leave()
      if(r.statusCode!==200)return reject(Error((r.data as any)?.error||'请求失败'))
      if(token!==session())return reject(Error('账号已切换'))
      resolve(r.data)
    },fail:()=>reject(Error('连接失败，请检查服务地址和网络'))
  }))
}
export function media(id:number,candidate=false):Promise<string>{
  const token=session()
  return new Promise(resolve=>wx.downloadFile({url:base+(candidate?'/candidate-media/':'/media/')+id,header:{Authorization:'Bearer '+token},
    success:r=>resolve(r.statusCode===200 && token===session()?r.tempFilePath:''),fail:()=>resolve('')
  }))
}
export const notify=(error:any)=>wx.showToast({title:error.message||'请求失败',icon:'none'})

