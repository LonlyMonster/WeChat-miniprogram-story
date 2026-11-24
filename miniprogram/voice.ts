import { request, notify } from './api'
let recorder: any
let owner: any
function microphone() {
  if (recorder) return recorder
  recorder = wx.getRecorderManager()
  recorder.onStart(() => {
    if (owner?.active) owner.setData({voice:'recording'})
    else recorder.stop()
  })
  recorder.onError(() => {
    const page = owner
    owner = null
    if (page?.active) { page.setData({voice:''}); notify(Error('录音失败，请检查麦克风权限或输入文字')) }
  })
  recorder.onStop((result: any) => {
    const page = owner
    owner = null
    if (page?.active && page.data.voice) page.transcribe(result.tempFilePath)
    else if (result.tempFilePath) wx.getFileSystemManager().unlink({filePath:result.tempFilePath,fail:()=>{}})
  })
  return recorder
}

export const voiceControls = {
  stopVoice() {
    this.voiceRevision++; this.setData({voice:''})
    if(owner===this)recorder.stop()
  },
  async record() {
    if (owner || this.data.voice || this.data.busy) return
    const revision = ++this.voiceRevision
    this.setData({voice:'starting',voiceError:''})
    try {
      await new Promise((resolve,reject)=>wx.authorize({scope:'scope.record',success:resolve,fail:reject}))
      if (!this.active || revision !== this.voiceRevision) return
      const mic = microphone()
      owner = this
      mic.start({format:'mp3',sampleRate:16000,numberOfChannels:1,duration:60000,encodeBitRate:48000})
    } catch {
      if (owner === this) owner = null
      if (this.active && revision === this.voiceRevision) {
        this.setData({voice:''}); notify(Error('请允许使用麦克风，或直接输入文字'))
      }
    }
  },
  endRecording() { if (owner === this && this.data.voice === 'recording') { this.setData({voice:'stopping'}); recorder.stop() } },
  async transcribe(path:string) {
    const revision = this.voiceRevision
    this.setData({voice:'processing'})
    const fs = wx.getFileSystemManager()
    try {
      const audio = await new Promise<string>((resolve,reject)=>fs.readFile({filePath:path,encoding:'base64',success:r=>resolve(r.data as string),fail:reject}))
      if (!this.active || revision !== this.voiceRevision) return
      const result = await request('transcribe',{id:this.id,audio,format:'mp3'})
      if (this.active && revision === this.voiceRevision) this.setData({text:result.text,spoken:true})
    } catch(error) {
      if (this.active && revision === this.voiceRevision)
        this.setData({voiceError:(error as Error).message || '转写失败，请重新讲'})
    }
    finally {
      if (path) fs.unlink({filePath:path,fail:()=>{}})
      if (this.active && revision === this.voiceRevision) this.setData({voice:''})
    }
  },

}
