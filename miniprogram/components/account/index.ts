import {request,leave,notify} from '../../api'
Component({
  properties:{family:{type:Boolean,value:false}},
  data:{open:false,closing:false,confirming:false},
  methods:{
    toggle(){this.setData({open:!this.data.open})},
    change(){this.setData({open:false});wx.navigateTo({url:'/pages/password/index'})},
    async logout(){try{await request('logout',{});leave()}catch(e){notify(e)}},
    async closeAccount(){
      if(!this.data.family||this.data.closing)return
      await new Promise<void>(resolve=>this.setData({open:false,confirming:true},resolve))
      const result=await this.selectComponent('#confirmation').ask({title:'注销账号',
        content:'账号、已保存的故事和未完成草稿将永久删除。',confirmText:'确认注销',confirmColor:'#934f3d'})
      this.setData({confirming:false})
      if(!result.confirm)return
      this.setData({closing:true})
      try{await request('close-account',{});leave()}
      catch(e){notify(e);this.setData({closing:false})}
    }
  }
})
