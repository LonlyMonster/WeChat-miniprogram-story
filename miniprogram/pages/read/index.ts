import { request, media, notify } from '../../api'

Page({
  data: { title: '', cells: [], viewing:false, current:0 },

  id:'',
  onLoad(options:any){this.id=options.id},
  edit(event:any){wx.navigateTo({url:'/pages/edit/index?id='+encodeURIComponent(this.id)+'&cell='+event.currentTarget.dataset.cell})},
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

  preview(event:any){this.setData({current:Number(event.currentTarget.dataset.index),viewing:true})},
  slide(event:any){this.setData({current:event.detail.current})},
  closeViewer(){this.setData({viewing:false})}
})
