import {randomBytes,argon2,argon2Sync} from 'node:crypto'
import {promisify} from 'node:util'

const derive=promisify(argon2)
function hashOptions(password,nonce){
  return {message:password,nonce,parallelism:1,tagLength:32,memory:19456,passes:2}
}
export function digest(password,nonce){
  return derive('argon2id',hashOptions(password,nonce))
}
export function migrateAccounts(db){
  db.exec('BEGIN IMMEDIATE')
  try{
    db.exec('CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE,salt BLOB,hash BLOB)')
    const columns=db.prepare('PRAGMA table_info(users)').all().map(c=>c.name)
    if(!columns.includes('role'))db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'family'")
    if(!columns.includes('account_key')){
      db.exec("ALTER TABLE users ADD COLUMN account_key TEXT; UPDATE users SET account_key=lower(hex(randomblob(16)))")
      db.exec('CREATE UNIQUE INDEX users_account_key ON users(account_key)')
    }
    if(!columns.includes('last_login'))db.exec('ALTER TABLE users ADD COLUMN last_login INTEGER')
    if(!columns.includes('reset_until'))db.exec('ALTER TABLE users ADD COLUMN reset_until INTEGER')
    if(!columns.includes('reset_used'))db.exec('ALTER TABLE users ADD COLUMN reset_used INTEGER DEFAULT 0')
    db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}
}
export function initAdmin(db){
  migrateAccounts(db)
  db.exec('BEGIN IMMEDIATE')
  try{
    const matches=db.prepare("SELECT role FROM users WHERE lower(trim(name))='admin'").all()
    if(matches.some(row=>row.role!=='admin'))throw Error('历史家庭账号名称冲突，请先处理；未修改任何账号')
    if(!matches.length){
      const salt=randomBytes(16)
      const hash=argon2Sync('argon2id',hashOptions('admin15@',salt))
      db.prepare("INSERT INTO users(name,salt,hash,role) VALUES('admin',?,?,'admin')").run(salt,hash)
    }
    db.exec('COMMIT')
    return !matches.length
  }catch(e){db.exec('ROLLBACK');throw e}
}
