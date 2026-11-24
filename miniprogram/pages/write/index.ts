import { request, media, notify } from '../../api'

import {voiceControls} from '../../voice'

Page({
  data: { state: '', loadFailed:false, confirmingFinish:false, cells: [] as any[], text: '', busy: false, voice:'', spoken:false, voiceError:'', editJob:0, editCell:0, editWords:'' },
  ...voiceControls, voiceRevision:0,
  id: '', revision: 0, active: false, timer: 0, retryKey: '', retryText: '',
  paths: {} as Record<number, string>,
  onLoad(options: any) { this.id = options.id; this.paths = {} },
  onShow() { this.active = true; this.refresh() },
  onHide() { this.stop() },
  onUnload() { this.stop() },
  stop() {
    this.active = false; this.revision++; clearTimeout(this.timer)
    this.stopVoice()
  },
  async refresh() {
    clearTimeout(this.timer)
    const revision = ++this.revision
    try {
      const story = await request('story/' + encodeURIComponent(this.id))
      const cells = await Promise.all(story.cells.map(async (cell: any) => {
        if (cell.ready && !this.paths[cell.id]) this.paths[cell.id] = await media(cell.id)
        return { ...cell, path: this.paths[cell.id] || '' }
      }))
      if (!this.active || revision !== this.revision) return
      const enteringNaming = story.state === 'ended' && this.data.state !== 'ended'
      this.setData({ state: story.state, cells, loadFailed:false }, () => {
        if (enteringNaming && this.active) wx.pageScrollTo({scrollTop:0, duration:0})
      })
      if(this.data.editJob && !cells.some(cell=>cell.retryJob===this.data.editJob))this.cancelRetry()
      if (story.state === 'draft' && cells.some(cell => !cell.ready && !cell.error))
        this.timer = setTimeout(() => this.refresh(), 2500)
    } catch (error) { if (this.active && revision === this.revision) { this.setData({ loadFailed:true }); notify(error) } }
  },
  editText(event: any) { this.setData({ text: event.detail.value }) },
  openRetry(event:any) {
    if(this.data.busy || this.data.voice || this.data.editJob)return
    const cell=this.data.cells[event.currentTarget.dataset.index]
    if(cell?.retryJob)this.setData({editJob:cell.retryJob,editCell:cell.id,editWords:cell.text})
  },
  editRetry(event:any) { this.setData({editWords:event.detail.value}) },
  cancelRetry() { this.setData({editJob:0,editCell:0,editWords:''}) },
  async retryCell() {
    if(this.data.busy || this.data.voice || !this.data.editJob)return
    const text=this.data.editWords.trim()
    if(!text || Array.from(text).length>100)return notify(Error('请填写 1 到 100 字的本格文字'))
    this.setData({busy:true})
    try {
      await request('retry-cell',{id:this.id,cell:this.data.editCell,retryJob:this.data.editJob,text})
      this.cancelRetry()
    } catch(error) { notify(error) }
    finally { if(this.active){ await this.refresh(); this.setData({busy:false}) } }
  },
  async submit(event: any) {
    if (this.data.busy || this.data.voice) return
    const action = event.currentTarget.dataset.action
    const data: any = { id: this.id }
    if (action === 'finish' && this.data.text.trim()) {
      await new Promise<void>(resolve=>this.setData({confirmingFinish:true},resolve))
      const choice = await this.selectComponent('#confirmation').ask({title:'结束故事？',content:'当前格文字尚未生成漫画，结束将舍弃这段文字。'})
      this.setData({confirmingFinish:false})
      if (!choice.confirm) return
    }
    if (action === 'cell') {
      data.text = this.data.text.trim()
      if (!data.text) return notify(Error('请输入本格文字'))
      if (Array.from(data.text).length > 100) return notify(Error('请将本格文字缩短到 100 字以内'))
      if (!this.retryKey || this.retryText !== data.text) {
        this.retryText = data.text
        this.retryKey = Date.now() + '-' + Math.random().toString(36).slice(2)
      }
      data.requestId = this.retryKey
    }
    if (action === 'save') {
      data.title = event.detail.value.title.trim()
      if (!data.title) return notify(Error('请填写故事名称'))
    }
    this.setData({ busy: true })
    try {
      await request(action, data)
      if (action === 'save') { wx.navigateBack(); return }
      if (action === 'cell') { this.retryKey = ''; this.setData({ text: '', spoken:false, voiceError:'' }) }
      await this.refresh()
    } catch (error) { notify(error) }
    finally { if (this.active) this.setData({ busy: false }) }
  }
})
