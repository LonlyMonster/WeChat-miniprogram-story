import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {sealCredential,openCredential} from './credentials.mjs'

test('部署主密钥支持凭据轮换且拒绝错误密钥',()=>{
  const master=randomBytes(32).toString('base64')
  const encrypted=sealCredential('test-secret',master)
  assert.ok(!encrypted.includes('test-secret'))
  assert.equal(openCredential(encrypted,master),'test-secret')
  assert.throws(()=>openCredential(encrypted,randomBytes(32).toString('base64')))
  assert.throws(()=>sealCredential('test-secret',''))
})
