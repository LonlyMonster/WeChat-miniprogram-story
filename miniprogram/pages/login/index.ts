import {session,accept,request,notify} from '../../api'
Page({
 data:{signup:false,showPassword:false,busy:false,checking:true},
 async onLoad(){try{if(session()){const me=await request('me');accept(session(),me.role,me.mustChange)}}catch(e){if(session())notify(e)}finally{this.setData({checking:false})}},
 toggleVisibility(){this.setData({showPassword:!this.data.showPassword})},
 toggle(){this.setData({signup:!this.data.signup,showPassword:false})},
 async submit(e:any){
  if(this.data.busy)return
  this.setData({busy:true})
  try{const result=await request(this.data.signup?'register':'login',e.detail.value);accept(result.token,result.role,result.mustChange)}
  catch(error){notify(error)}finally{this.setData({busy:false})}
 }
})

