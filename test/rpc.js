const chaiAsPromised = require('chai-as-promised')
const chai = require('chai')

const frida = require('frida')
const { FridaUtil } = require('../lib/utils')
const { connect, proxy } = require('../lib/rpcv2')

chai.use(chaiAsPromised)
const { expect } = chai


describe('RPC', () => {
  let device, session, rpc
  beforeEach(async () => {
    device = await frida.getUsbDevice()
    try {
      session = await device.attach(process.env.APP || 'Safari')
    } catch (_) {
      session = await FridaUtil.spawn(device, { identifier: process.env.BUNDLE || 'com.apple.mobilesafari' })
    }
    const __exports = await connect(session)
    // console.log(await __exports.interfaces())
    rpc = proxy(__exports)
  })

  it('should handle basic RPC usage', async () => {
    expect(await rpc('cookies/list')).to.be.an('array')

    expect(await rpc.cookies.list()).to.be.an('array')
    expect(await rpc.checksec()).to.be.an('object')
      .and.to.has.keys(['entitlements', 'encrypted', 'arc', 'canary', 'pie'])

    expect(rpc.non.exist()).to.be.rejected
    expect(() => delete rpc.symbol).to.be.throw
    expect(() => rpc.foo = 'bar').to.be.throw
  })

  it('should cover modules', async () => {
    await rpc.syslog.start()

    expect(await rpc.info.info()).to.be.an('object')
      .and.to.has.keys(['tmp', 'home', 'json', 'id', 'bundle', 'binary', 'urls', 'minOS', 'name', 'semVer', 'version'])
    expect(await rpc.info.userDefaults()).to.be.an('object')
    expect(await rpc.symbol.modules()).to.be.an('array')
    expect(await rpc.symbol.imports('MobileSafari')).to.be.an('array')
    expect(await rpc.symbol.exports('WebKit')).to.be.an('array')

    const BOOKMARKS = '/var/mobile/Library/Safari/Bookmarks.db'
    expect(await rpc.sqlite.tables(BOOKMARKS)).to.be.an('array')
    expect(await rpc.sqlite.query(BOOKMARKS, 'select count(*) from bookmarks')).to.be.an('array').and.have.lengthOf(1)
    expect(await rpc.sqlite.data(BOOKMARKS, 'bookmarks')).to.be.an('object').and.have.keys(['header', 'data'])

    expect(await rpc.keychain.list()).to.be.an('array')

    await rpc.syslog.stop()
  })

  it('should dump classes', async () => {
    const main = await rpc.classdump.dump()
    const withFrameworks = await rpc.classdump.ownClasses()

    expect(main).to.be.an('array')
    expect(withFrameworks).to.be.an('array')
    expect(main.length).to.lte(withFrameworks.length)

    const isTree = node => expect(node).to.be.an('object')

    // app scope
    isTree(await rpc.classdump.hierarchy('__app__'))
    // main module
    isTree(await rpc.classdump.hierarchy('__main__'))
    // all classes (pretty slow)
    isTree(await rpc.classdump.hierarchy('__global__'))
    // single module
    isTree(await rpc.classdump.hierarchy('/System/Library/Frameworks/UIKit.framework/UIKit'))
    // selected modules
    isTree(await rpc.classdump.hierarchy([
      '/System/Library/Frameworks/UIKit.framework/UIKit',
      '/System/Library/Frameworks/CFNetwork.framework/CFNetwork'
    ]))
  }).timeout(5000)

  it('should capture a screenshot', async () => {
    const { writeFile } = require('fs')
    const { tmpdir } = require('os')
    const { join } = require('path')
    const { promisify } = require('util')

    const write = promisify(writeFile)
    const filename = join(tmpdir(), `${Math.random().toString(36)}.png`)
    const str = await rpc.screenshot()
    expect(str).to.be.a('string')

    if (process.env.DEBUG_SAVE_SCREENSHOT) {
      await write(filename, Buffer.from(str, 'base64'))
      console.info(`\t[INFO] open ${filename} to see the picture`)
    }
  })

  afterEach(async () => {
    if (session)
      await session.detach()
  })
})