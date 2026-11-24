import { request, media, notify } from '../../api'

const pageSize = 4
Page({
  data: { username: '', loaded: false, visibleBooks: [], page: 1, pageNumbers: [], draft: null, opening: false },
  books: [] as any[],
  revision: 0,

  async onShow() {
    try {
      const shelf = await request('shelf')
      this.books = shelf.books.map((book: any) => ({
        ...book, date: new Date(book.saved).toLocaleDateString(),
        label: Array.from(book.title).slice(0, 10).join('') + (Array.from(book.title).length > 10 ? '…' : '')
      }))
      this.setData({ username: shelf.username, draft: shelf.draft, loaded: true })
      this.showPage(this.data.page)
    } catch (error) { notify(error) }
  },

  async showPage(target: number) {
    const count = Math.ceil(this.books.length / pageSize)
    const page = Math.max(1, Math.min(count, target))
    const revision = ++this.revision
    const visibleBooks = this.books.slice((page - 1) * pageSize, page * pageSize)
    this.setData({ page, visibleBooks, pageNumbers: Array.from({ length: count }, (_, i) => i + 1) })
    await Promise.all(visibleBooks.map(async (book, index) => {
      if (!book.cover || book.coverPath) return
      book.coverPath = await media(book.cover)
      if (revision === this.revision) this.setData({ ['visibleBooks[' + index + '].coverPath']: book.coverPath })
    }))
  },
  prev() { this.showPage(this.data.page - 1) },
  next() { this.showPage(this.data.page + 1) },
  jump(event: any) { this.showPage(Number(event.detail.value) + 1) },

  async start() {
    if (this.data.opening) return
    this.setData({ opening: true })
    try {
      const draft = this.data.draft || await request('start', {})
      await wx.navigateTo({ url: '/pages/write/index?id=' + encodeURIComponent(draft.id) })
    } catch (error) { notify(error) }
    finally { this.setData({ opening: false }) }
  },
  open(event: any) { wx.navigateTo({ url: '/pages/read/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }) },
  async remove(event: any) {
    const book = this.books.find(item => item.id === event.currentTarget.dataset.id)
    if (!book) return
    try {
      const result = await this.selectComponent('#confirmation').ask({ title: '删除故事', content: '确定删除《' + book.title + '》吗？删除后无法恢复。', confirmText: '删除', confirmColor: '#a74434' })
      if (!result.confirm) return
      await request('delete', { id: book.id })
      this.books = this.books.filter(item => item.id !== book.id)
      this.showPage(this.data.page)
    } catch (error) { notify(error) }
  }
})
