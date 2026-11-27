import { request, media, notify } from '../../api'

Page({
  data: { title: '', editing:false, removing:false, editingTitle:false, editingCaption:0, savingTitle:false, cells: [], viewing:false, current:0 },

  id:'',
  onLoad(options:any){this.id=options.id},
  swipeStart: null as {x:number, y:number} | null,
  leaving:false,
  startSwipe(event:any) {
    const { editingTitle, editingCaption, removing } = this.data
    const touch = event.touches[0]
    this.swipeStart = event.touches.length === 1 && !editingTitle && !editingCaption && !removing
      ? {x:touch.clientX, y:touch.clientY} : null
  },
  cancelSwipe() { this.swipeStart = null },
  async finishSwipe(event:any) {
    const start = this.swipeStart
    this.cancelSwipe()
    const end = event.changedTouches[0]
    if (!start || !end || this.leaving || event.touches.length) return
    const dx = end.clientX - start.x
    const dy = Math.abs(end.clientY - start.y)
    if (dx < 80 || dx < dy * 2) return
    this.leaving = true
    try {
      const pages = getCurrentPages()
      const previous = pages[pages.length - 2]
      if (previous?.route === 'pages/shelf/index') await wx.navigateBack()
      else await wx.reLaunch({url:'/pages/shelf/index'})
    } catch (error) { notify(error) }
    finally { this.leaving = false }
  },
  toggleEditing() {
    this.setData({editing: !this.data.editing})
  },
  async remove() {
    if (this.data.removing || !this.data.title) return
    this.setData({removing:true})
    try {
      const result = await this.selectComponent('#confirmation').ask({
        title: '删除故事', content: '确定删除《' + this.data.title + '》吗？删除后无法恢复。',
        confirmText: '确认删除', confirmColor: '#a74434'
      })
      if (!result.confirm) return
      await request('delete', {id:this.id})
      await wx.navigateBack()
    } catch (error) { notify(error) }
    finally { this.setData({removing:false}) }
  },
  edit(event:any){
    if (!this.data.cells[event.currentTarget.dataset.index]?.ready) return
    wx.navigateTo({url:'/pages/edit/index?id='+encodeURIComponent(this.id)+'&cell='+event.currentTarget.dataset.cell})},
  editTitle(){this.setData({editingTitle:true})},
  editCaption(event:any) {
    const cell = this.data.cells[event.currentTarget.dataset.index]
    if (this.data.editing && !cell.saving) this.setData({editingCaption:cell.id})
  },
  async saveCaption(event:any) {
    const index = event.currentTarget.dataset.index
    const cell = this.data.cells[index]
    const text = event.detail.value.trim()
    if (this.data.editingCaption === cell.id) this.setData({editingCaption:0})
    if (text === cell.text) return
    if (!text || Array.from(text).length > 100) return notify(Error('本格文字须为 1 到 100 字'))
    const key = 'cells[' + index + ']'
    this.setData({[key + '.saving']:true})
    try {
      const result = await request('caption', {id:this.id, cell:cell.id, version:cell.version, text})
      this.setData({[key + '.text']:text, [key + '.version']:result.version})
    } catch (error) { notify(error) }
    finally { this.setData({[key + '.saving']:false}) }
  },
  async saveTitle(event:any){
    const title = event.detail.value.trim()
    this.setData({editingTitle:false})
    if (!title) return notify(Error('请填写故事名称'))
    if (title === this.data.title) return
    this.setData({savingTitle:true})
    try {
      await request('rename', {id:this.id, title})
      this.setData({title})
    } catch (error) { notify(error) }
    finally { this.setData({savingTitle:false}) }
  },
  async onShow() {
    try {
      const book = await request('story/' + encodeURIComponent(this.id))
      const cells = await Promise.all(book.cells.map(async (cell: any) => ({
        ...cell,
        path: cell.ready ? await media(cell.id) : ''
      })))
      this.setData({
        title: book.title,
        cells
      })
    } catch (error) {
      notify(error)
    }
  },

  preview(event:any){
    if (!this.data.cells[event.currentTarget.dataset.index]?.path) return
    this.setData({current:Number(event.currentTarget.dataset.index),viewing:true})},
  slide(event:any){this.setData({current:event.detail.current})},
  closeViewer(){this.setData({viewing:false})}
})
