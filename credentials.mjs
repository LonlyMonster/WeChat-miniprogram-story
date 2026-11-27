import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto'

function key(value){
  const bytes=Buffer.from(value||'','base64')
  if(bytes.length!==32 || bytes.toString('base64')!==value)
    throw Error('请为服务配置有效的 STORY_CREDENTIAL_MASTER_KEY')
  return bytes
}

export function sealCredential(secret,master=process.env.STORY_CREDENTIAL_MASTER_KEY){
  const iv=randomBytes(12)
  const cipher=createCipheriv('aes-256-gcm',key(master),iv)
  const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()])
  return 'v1:'+Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64')
}

export function openCredential(value,master=process.env.STORY_CREDENTIAL_MASTER_KEY){
  const bytes=Buffer.from(value.slice(3),'base64')
  const cipher=createDecipheriv('aes-256-gcm',key(master),bytes.subarray(0,12))
  cipher.setAuthTag(bytes.subarray(12,28))
  return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8')
}
