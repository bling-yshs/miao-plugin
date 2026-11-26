import { Cfg } from '#miao'
import { MysApi } from '#miao.models'
import { miaoPath } from '#miao.path'

/**
 * 根据引用消息获取并发送角色卡片或面板的原图。
 * @param {object} e 消息事件。
 * @returns {Promise<boolean>} 原图记录存在或已回复权限提示时返回 true，查找失败时返回 false。
 */
export async function getOriginalPicture (e) {
  let source
  if (e.reply_id) {
    source = { message_id: e.reply_id }
  } else {
    if (!e.source || e.source.user_id !== e.self_id) {
      return false
    }
    // 获取原消息
    if (e.group?.getChatHistory) {
      source = (await e.group.getChatHistory(e.source.seq, 1)).pop()
    } else if (e.friend?.getChatHistory) {
      source = (await e.friend.getChatHistory(e.source.time, 1)).pop()
    }
    // 引用的不是纯图片
    if (!(source?.message?.length === 1 && source?.message[0]?.type === 'image')) {
      return false
    }
  }
  let originalPic = Cfg.get('originalPic') * 1
  if (source) {
    let imgPath = await redis.get(`miao:original-picture:${source.message_id}`)
    if (imgPath) {
      try {
        if (imgPath[0] === '{') {
          imgPath = JSON.parse(imgPath)
        } else {
          imgPath = { img: imgPath, type: '' }
        }
      } catch (e) {
      }
      if (!e.isMaster) {
        if (imgPath.type === 'character' && [2, 0].includes(originalPic)) {
          e.reply('已禁止获取角色原图...')
          return true
        }
        if (imgPath.type === 'profile' && [1, 0].includes(originalPic)) {
          e.reply('已禁止获取面板原图...')
          return true
        }
      }
      if (imgPath && imgPath.img) {
        let img = imgPath.img
        // 自定义图库源可能返回file://绝对地址（跨盘等），其余按resources相对路径处理
        let url = /^file:\/\//i.test(img)
          ? `file://${decodeURIComponent(img.replace(/^file:\/+/i, ''))}`
          : `file://${miaoPath}/resources/${decodeURIComponent(img)}`
        e.reply(segment.image(url), false, { recallMsg: 30 })
      }
      return true
    }
  }
  return false
}

/* #敌人等级 */
export async function enemyLv (e) {
  let selfUser = await MysApi.initUser(e)
  if (!selfUser || !e.msg) {
    return true
  }
  let ret = /(敌人|怪物)等级\s*(\d{1,3})\s*$/.exec(e.msg)
  if (ret && ret[2]) {
    let lv = ret[2] * 1
    await selfUser.setCfg('char.enemyLv', lv)
    lv = await selfUser.getCfg('char.enemyLv', 103)
    e.reply(`敌人等级已经设置为${lv}`)
    return true
  }
  return true
}
