import {request,leave,notify} from '../../api'
Page({data:{busy:false,setup:false,shown:{}},toggleEye(e:any){const name=e.currentTarget.dataset.name;this.setData({["shown."+name]:!this.data.shown[name]})},onLoad(options:any){this.setData({setup:options.setup==="1"})},async submit(e:any){
 if(this.data.busy)return
 const fields=e.detail.value
 if(fields.newPassword!==fields.confirmPassword)return notify(Error('两次新密码不一致'))
 this.setData({busy:true})
 try{await request('password',fields);leave();wx.showToast({title:'密码已修改，请重新登录',icon:'none'})}
 catch(error){notify(error)}finally{this.setData({busy:false})}
},cancel(){if(this.data.setup)leave();else wx.navigateBack()}})
