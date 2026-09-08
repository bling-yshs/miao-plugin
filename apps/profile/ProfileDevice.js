import { parseDevice, refreshDevice } from '../../models/MysDevice.js'
import common from '../../../../lib/common/common.js'

const deviceGuide = '请下载安装设备信息工具：\nhttps://cnb.cool/bling-team/release/-/releases/download/device-info-app/copy_device_info.apk\n然后复制并发送设备信息。发送“取消”结束绑定。'

const ProfileDevice = {
  /**
   * 为发送者当前游戏的米游社账号开始绑定或解除设备绑定。
   * @param {object} e 消息事件
   * @returns {Promise<boolean>} 是否已处理命令
   */
  async bind (e) {
    const game = e.isSr || /星铁/.test(e.msg) ? 'sr' : 'gs'
    const user = e.runtime?.user
    const mysUser = user?.getMysUser(game)
    if (!mysUser?.ck || !mysUser.ltuid) {
      await e.reply('请先绑定当前游戏账号的米游社Cookie')
      return true
    }
    const key = `miao:device:${mysUser.ltuid}`
    if (/解绑设备/.test(e.msg)) {
      this.finish('profileDeviceInput')
      await redis.del(key)
      await e.reply('解绑设备成功')
      return true
    }
    e.profileDeviceAccount = String(mysUser.ltuid)
    e.profileDeviceGame = game
    this.setContext('profileDeviceInput')
    await e.reply(deviceGuide)
    return true
  },

  /**
   * 校验设备信息并保存到开始绑定时选定的本人账号。
   * @param {object} e 消息事件
   * @returns {Promise<boolean>} 是否已处理消息
   */
  async input (e) {
    const context = this.getContext()?.profileDeviceInput
    if (!context) return false
    const msg = e.msg?.trim() || ''
    if (msg === '取消') {
      this.finish('profileDeviceInput')
      await e.reply('已取消绑定设备')
      return true
    }
    const account = context.profileDeviceAccount
    const accounts = e.runtime?.user?.getCkUidList(context.profileDeviceGame) || []
    if (!accounts.some(ds => String(ds.ltuid) === account)) {
      this.finish('profileDeviceInput')
      await e.reply('账号绑定已变更，请重新发送 #绑定设备')
      return true
    }
    let info
    try {
      info = JSON.parse(msg)
    } catch {}
    let device = parseDevice(info)
    if (!device) {
      await e.reply('设备信息格式错误，请重新复制并发送工具中的设备信息。发送“取消”结束绑定。')
      return true
    }
    if (device.android) {
      await e.reply('正在根据手机设备信息获取米游社设备指纹…')
      try {
        device = await refreshDevice(device)
      } catch {
        await e.reply('获取设备指纹失败，请稍后重新发送设备信息，或发送“取消”')
        return true
      }
      if (this.getContext()?.profileDeviceInput !== context) return true
    }
    await redis.set(`miao:device:${account}`, JSON.stringify(device))
    this.finish('profileDeviceInput')
    await e.reply(`绑定设备成功，请发送 ${context.profileDeviceGame === 'sr' ? '#星铁' : '#'}米游社更新面板${e.isGroup ? '\n请撤回设备信息' : ''}`)
    return true
  },

  /**
   * 通过转发消息说明设备信息获取方式及绑定、解绑步骤。
   * @param {object} e 消息事件
   * @returns {Promise<boolean>} 是否已处理命令
   */
  async help (e) {
    const prefix = e.isSr || /星铁/.test(e.msg) ? '#星铁' : '#'
    const msgs = [
      '[绑定设备]',
      '方法一：',
      '1. 使用抓包软件抓取米游社APP的请求',
      '2. 在请求头内找到【x-rpc-device_id】和【x-rpc-device_fp】',
      '3. 自行构造如下格式的信息：',
      '    {"device_id": "x-rpc-device_id的内容", "device_fp": "x-rpc-device_fp的内容"}',
      `4. 给机器人发送“${prefix}绑定设备”指令`,
      '5. 机器人会提示发送设备信息',
      '6. 粘贴自行构造的信息发送',
      '7. 提示绑定成功',
      '--------------------------------',
      '方法二（仅适用于安卓设备）：',
      '1. 使用常用米游社手机下载下面链接的APK文件，并安装',
      'https://cnb.cool/bling-team/release/-/releases/download/device-info-app/copy_device_info.apk',
      '2. 打开后点击按钮复制',
      `3. 给机器人发送“${prefix}绑定设备”指令`,
      '4. 机器人会提示发送设备信息',
      '5. 粘贴设备信息发送',
      '6. 提示绑定成功',
      '发送“取消”结束绑定。',
      '--------------------------------',
      '[解绑设备]',
      `发送 ${prefix}解绑设备 即可`
    ]
    await e.reply(await common.makeForwardMsg(e, [msgs.join('\n')], '绑定设备帮助'))
    return true
  }
}

export default ProfileDevice
