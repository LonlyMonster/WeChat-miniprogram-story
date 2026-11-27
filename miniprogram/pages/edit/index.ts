import {media,notify,request} from '../../api'
import {voiceControls} from '../../voice'

Page({
  ...voiceControls,
  data:{number:0,stage:'loading',original:'',originalPath:'',text:'',newPath:'',error:'',
    busy:false,voice:'',voiceError:'',spoken:false,unknown:false,reviewText:''},
  id:'',cell:0,version:0,job:0,key:'',submitted:'',active:false,voiceRevision:0,timer:0,
  onLoad(options:any){this.id=options.id;this.cell=Number(options.cell)},
  onShow(){this.active=true;if(this.data.stage==='loading')this.load();else if(this.job && this.data.stage==='waiting')this.poll()},
  onHide(){this.stop()},
  onUnload(){this.stop()},
  stop(){this.active=false;clearTimeout(this.timer);this.stopVoice()},
  storage(){return 'story.edit.'+this.id+'.'+this.cell},
  async load(){
    try{
      const book=await request('story/'+encodeURIComponent(this.id))
      const index=book.cells.findIndex((c:any)=>c.id===this.cell)
      const cell=book.cells[index]
      if(!cell?.ready)throw Error('原图暂不可用')
      const originalPath=await media(cell.id)
      if(!this.active)return
      this.version=cell.version
      const pending=wx.getStorageSync(this.storage())
      const saved=pending?.version===this.version?pending:null
      this.job=saved?.job||0
      this.key=saved?.key||''
      this.submitted=saved?.text||''
      this.setData({originalPath,original:cell.text,number:index+1,text:this.submitted||cell.text,stage:this.job?'waiting':'edit',error:''})
      if(this.job)this.poll()
    }catch(e){if(this.active)notify(e)}
  },
  edit(e:any){this.setData({text:e.detail.value})},
  async generate(){
    if(this.data.busy||this.data.voice||this.data.unknown)return
    const text=this.data.text.trim()
    if(!text || Array.from(text).length>100)return notify(Error('本格文字须为 1 到 100 字'))
    this.setData({busy:true,error:''})
    try{
      if(this.job && text===this.data.reviewText){
        await request('retry-candidate-review',{id:this.id,cell:this.cell,job:this.job})
        this.setData({stage:'waiting',reviewText:''})
        if(this.active)this.poll()
        return
      }
      if(this.job){
        await request('discard',{id:this.id,cell:this.cell,job:this.job})
        this.job=0;this.key='';wx.removeStorageSync(this.storage())
      }
      if(!this.key||this.submitted!==text){this.key=Date.now()+'-'+Math.random().toString(36).slice(2);this.submitted=text}
      wx.setStorageSync(this.storage(),{key:this.key,text,version:this.version})
      const {job}=await request('candidate',{id:this.id,cell:this.cell,version:this.version,text,requestId:this.key})
      this.job=job
      wx.setStorageSync(this.storage(),{job,version:this.version})
      this.setData({stage:'waiting'})
      if(this.active)this.poll()
    }catch(e){this.setData({error:(e as Error).message})}
    finally{this.setData({busy:false})}
  },
  async poll(){
    clearTimeout(this.timer)
    const job=this.job
    try{
      const v=await request('candidate-status',{id:this.id,cell:this.cell,job})
      if(!this.active||this.job!==job)return
      if(v.status==='done'){
        const path=await media(job,true)
        if(!this.active||this.job!==job)return
        if(!path)throw Error('新版图片加载失败')
        this.setData({stage:'compare',newPath:path,text:v.text,error:''})
      }else if(['unknown','withheld','failed'].includes(v.status)){
        this.setData({stage:'edit',text:v.text,error:v.error||'生成失败',unknown:v.status==='unknown',reviewText:v.status==='withheld'&&v.error==='适龄审核暂不可用'?v.text:''})
      }else this.timer=setTimeout(()=>this.poll(),1800)
    }catch(e){if(this.active)this.setData({error:(e as Error).message})}
  },
  async decide(e:any){
    if(this.data.busy)return
    this.setData({busy:true})
    try{
      await request(e.currentTarget.dataset.action,{id:this.id,cell:this.cell,job:this.job})
      wx.removeStorageSync(this.storage())
      wx.navigateBack()
    }catch(e){this.setData({error:(e as Error).message,busy:false})}
  }
})
