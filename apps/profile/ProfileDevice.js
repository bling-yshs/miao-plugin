import { parseDevice, refreshDevice } from '../../models/MysDevice.js'

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
    await e.reply(`为米游社账号 ${mysUser.ltuid} 绑定设备，请发送安卓设备信息工具复制的JSON，或发送：\n{"device_id":"设备ID","device_fp":"设备指纹"}\n建议私聊发送，发送“取消”结束绑定。获取方法见 #绑定设备帮助`)
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
      await e.reply('设备信息格式错误，请发送安卓工具复制的完整JSON（deviceName、deviceBoard、deviceModel、oaid、androidVersion、deviceFingerprint、deviceProduct），或包含 device_id 和 device_fp 的JSON。发送“取消”可结束绑定。')
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
   * 说明设备参数的获取方式和绑定命令。
   * @param {object} e 消息事件
   * @returns {Promise<boolean>} 是否已处理命令
   */
  async help (e) {
    await e.reply('方法一（安卓手机）：使用 %绑定设备帮助 中的设备信息工具，复制手机设备JSON。发送 #绑定设备，再粘贴完整JSON，机器人会自动获取设备指纹，有效期七天，过期后请求时自动刷新。\n方法二：抓取本人米游社APP同一请求头中的 x-rpc-device_id 和 x-rpc-device_fp。发送 #绑定设备，再发送：\n{"device_id":"x-rpc-device_id的内容","device_fp":"x-rpc-device_fp的内容"}\n发送 #解绑设备 可解除绑定。星铁使用 #星铁绑定设备、#星铁解绑设备。多账号请先切换到需要绑定的账号。')
    return true
  }
}

export default ProfileDevice
