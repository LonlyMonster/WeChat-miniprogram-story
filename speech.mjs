import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const local = name => fileURLToPath(new URL(name, import.meta.url))
let running = 0
export async function transcribePCM(audio,format='pcm') {
  const fail = (status,message) => Object.assign(Error(message),{status})
  if(typeof audio !== 'string' || audio.length > 2560000) throw fail(400,'录音无效，请重新讲')
  const pcm = Buffer.from(audio,'base64')
  if(!['pcm','mp3'].includes(format) || !pcm.length || pcm.toString('base64') !== audio) throw fail(400,'录音数据无效，请重新讲')
  if(format==='pcm' && (pcm.length < 3200 || pcm.length % 2)) throw fail(400,'PCM 录音太短或不完整，请重新讲')
  if(running >= 2) throw fail(429,'转写服务繁忙，请稍后重新讲')
  running++
  try {
    const python = process.env.VOSK_PYTHON || local(process.platform === 'win32' ? '.voice-env/Scripts/python.exe' : '.voice-env/bin/python')
    const model = process.env.VOSK_MODEL || local('.voice-env/vosk-model-small-cn-0.22')
    const text = await new Promise((resolve,reject) => {
      const child = execFile(python,[local('recognize.py'),model,format],{timeout:45000,windowsHide:true},(err,out) => {
        if(err?.code===2) reject(fail(422,'无法解码录音，请重新讲'))
        else if(err?.code===3) reject(fail(422,'未录到声音，请检查麦克风后重讲'))
        else if(err) reject(fail(503,'本地转写暂不可用，请改用文字'))
        else resolve(out.trim())
      })
      child.stdin.on('error',()=>{})
      child.stdin.end(pcm)
    })
    if(!text) throw fail(422,'未听清，请重新讲')
    return text
  } finally { running-- }
}
