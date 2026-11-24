type DialogOptions = {
  title:string, content:string, confirmText?:string, cancelText?:string,
  confirmColor?:string, showCancel?:boolean
}
Component({
  data:{visible:false,title:'',content:'',confirmText:'确定',cancelText:'取消',destructive:false,showCancel:true},
  lifetimes:{detached(){this.finish(false)}},
  pageLifetimes:{hide(){this.finish(false)}},
  methods:{
    ask(options:DialogOptions):Promise<{confirm:boolean}> {
      if(this.resolveDialog)return Promise.resolve({confirm:false})
      return new Promise(resolve=>{
        this.resolveDialog=resolve
        this.setData({visible:true,title:options.title,content:options.content,
          confirmText:options.confirmText||'确定',cancelText:options.cancelText||'取消',
          destructive:!!options.confirmColor,showCancel:options.showCancel!==false})
      })
    },
    finish(confirm:boolean){
      const resolve=this.resolveDialog
      if(!resolve)return
      this.resolveDialog=null
      this.setData({visible:false})
      resolve({confirm})
    },
    cancel(){this.finish(false)},
    confirm(){this.finish(true)}
  }
})
