import { request, notify } from '../../api'

function loginTimeParts(timestamp: number | null) {
  if (timestamp == null) return { date: '尚无记录', time: '' }
  const login = new Date(timestamp)
  const twoDigits = (n: number) => String(n).padStart(2, '0')
  return {
    date: [login.getFullYear(), twoDigits(login.getMonth() + 1), twoDigits(login.getDate())].join('-'),
    time: [twoDigits(login.getHours()), twoDigits(login.getMinutes())].join(':')
  }
}

Page({
  data: { allowed: false, section: 'users', showKey:false, busy: false, ready: false, visibleUsers: [], userPage:1,userPages:1, config: null,
    models: [], selected: 0, key: '', message: '' },
  revision: 0,
  users: [] as any[],
  pageSize: 1,
  showUsers(target:number){
    const userPages=Math.max(1,Math.ceil(this.users.length/this.pageSize))
    const userPage=Math.max(1,Math.min(userPages,target))
    const start=(userPage-1)*this.pageSize
    this.setData({userPage,userPages,visibleUsers:this.users.slice(start,start+this.pageSize)})
  },
  fitUsers(){
    if(this.data.section!=='users'||!this.data.ready)return
    this.createSelectorQuery().select('.users').boundingClientRect()
      .select('.headings').boundingClientRect().exec((rects:any[])=>{
        if(!rects[0]||!rects[1]||this.data.section!=='users')return
        const unit=wx.getWindowInfo().windowWidth/750
        const space=rects[0].bottom-rects[1].bottom
        const row=132*unit
        const pager=this.users.length*row>space?76*unit:0
        this.pageSize=Math.max(1,Math.floor((space-pager)/row))
        this.showUsers(this.data.userPage)
      })
  },
  onResize(){wx.nextTick(()=>this.fitUsers())},
  previousUsers(){this.showUsers(this.data.userPage-1)},
  nextUsers(){this.showUsers(this.data.userPage+1)},
  async onShow() {
    this.setData({ allowed: false })
    try {
      const me = await request('me')
      if (me.role !== 'admin') { wx.reLaunch({url:'/pages/login/index'}); return }
      this.setData({ allowed: true })
      await this.load(this.data.section)
    } catch (error) { notify(error) }
  },
  onHide() { this.revision++; this.setData({ key: '', ready: false }) },
  async load(section: string) {
    const revision = ++this.revision
    this.setData({ section, ready: false, message: '', key: '' })
    try {
      const result = await request('admin/' + section)
      if (this.revision !== revision) return
      if (section === 'users') {
        this.users = result.users.map((u: any) => ({
          ...u, last: loginTimeParts(u.last_login)
        }))
      } else {
        this.setData({ config: result.config, models: result.models, selected: result.models.indexOf(result.config.model) })
      }
      this.setData({ ready: true },()=>this.fitUsers())
    } catch (error) { if (this.revision === revision) notify(error) }
  },
  switchTab(event: any) { if (!this.data.busy) this.load(event.currentTarget.dataset.section) },
  toggleKey(){this.setData({showKey:!this.data.showKey})},
  choose(event: any) { this.setData({ selected: Number(event.detail.value) }) },
  async save(event: any) {
    if (this.data.busy) return
    const {budget, quota, key} = event.detail.value
    if (!budget.trim() || !quota.trim()) return notify(Error('请填写预算和额度'))
    this.setData({ busy: true, message: '' })
    try {
      const {config} = await request('admin/config', { model: this.data.models[this.data.selected],
        budget: Number(budget), quota: Number(quota), key, version: this.data.config.version })
      this.setData({ config, key: '', message: '配置已保存，新任务将使用此配置。', ready: false })
      wx.nextTick(() => this.setData({ ready: true }))
    } catch (error) { notify(error) }
    finally { this.setData({ busy: false }) }
  },
  async removeUser(event: any) {
    if (this.data.busy) return
    const { name, key } = event.currentTarget.dataset
    this.setData({ busy: true })
    try {
      const answer = await this.selectComponent('#confirmation').ask({
        title: '删除用户',
        content: '确定删除「' + name + '」吗？该账号、所有已保存的故事和未完成的草稿都将永久删除。此操作无法撤销。',
        confirmText: '确认删除', confirmColor: '#ac4038', cancelText: '取消'
      })
      if (!answer.confirm) return
      await request('admin/delete-user', { username: name, accountKey: key })
      this.users=this.users.filter((user:any)=>user.account_key!==key)
      this.showUsers(this.data.userPage)
      this.fitUsers()
      wx.showToast({ title: '用户已删除' })
    } catch (error) { notify(error) }
    finally { this.setData({ busy: false }) }
  },
  async reset(event: any) {
    if (this.data.busy) return
    const username = event.currentTarget.dataset.name
    this.setData({ busy: true })
    try {
      const answer = await this.selectComponent('#confirmation').ask({ title: '重置密码', content: '重置「'+username+'」的密码？该账号将在所有设备退出登录。', confirmText: '确认重置' })
      if (!answer.confirm) return
      const {temporary} = await request('admin/reset', { username })
      await this.selectComponent('#confirmation').ask({ title: username+' 的临时密码', content: temporary+'\n15 分钟内有效，仅可登录一次。请转交给该家长设置新密码。', showCancel: false })
    } catch (error) { notify(error) }
    finally { this.setData({ busy: false }) }
  }
})
