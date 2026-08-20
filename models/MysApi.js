import { User } from './index.js'
import { Version } from '#miao'
import { Button } from '#miao.models'

const PATCHED_GET_COOKIE = Symbol.for('miao-plugin.mysInfo.getCookie')
const MAX_COOKIE_SELECTIONS = 50

function getGameKey (game) {
  if (game && typeof game === 'object') {
    game = game.game || game.key || (game.isSr ? 'sr' : 'gs')
  }
  return ['sr', 'star'].includes(game) ? 'sr' : 'gs'
}

// Prevent old Yunzai runtimes from recursively selecting the same invalid CK.
function patchMysInfoGetCookie (runtime) {
  const MysInfo = runtime?.MysInfo
  const MysUser = runtime?.MysUser
  const prototype = MysInfo?.prototype
  const original = prototype?.getCookie

  if (typeof original !== 'function' || original[PATCHED_GET_COOKIE]) {
    return false
  }
  if (!/this\.getCookie\s*\(/.test(Function.prototype.toString.call(original))) {
    return false
  }

  let getCookie
  if (typeof MysUser?.getByQueryUid !== 'function') {
    const callDepth = new WeakMap()
    getCookie = async function (game = 'gs', ...args) {
      const depth = (callDepth.get(this) || 0) + 1
      if (depth > MAX_COOKIE_SELECTIONS) {
        return ''
      }
      callDepth.set(this, depth)
      try {
        return await original.call(this, getGameKey(game), ...args)
      } finally {
        if (depth === 1) {
          callDepth.delete(this)
        } else {
          callDepth.set(this, depth - 1)
        }
      }
    }
  } else {
    getCookie = async function (game = 'gs', onlySelfCk = false) {
      game = getGameKey(game)
      if (this.ckUser?.ck) {
        return this.ckUser.ck
      }

      const attempted = new Set()
      for (let count = 0; count < MAX_COOKIE_SELECTIONS; count++) {
        const mysUser = await MysUser.getByQueryUid(this.uid, game, onlySelfCk)
        if (!mysUser) {
          break
        }
        if (mysUser.ck) {
          this.ckInfo = mysUser.getCkInfo(game)
          this.ckUser = mysUser
          await mysUser.addQueryUid(this.uid, game)
          return mysUser.ck
        }

        const ltuid = mysUser.ltuid && String(mysUser.ltuid)
        if (!ltuid || attempted.has(ltuid)) {
          break
        }
        attempted.add(ltuid)
        await mysUser.disable(game)
        if (onlySelfCk) {
          break
        }
      }
      return ''
    }
  }

  Object.defineProperty(getCookie, PATCHED_GET_COOKIE, { value: true })
  prototype.getCookie = getCookie
  return true
}

export default class MysApi {
  constructor(e, uid, mysInfo) {
    this.e = e
    this.mysInfo = mysInfo
    this.ckInfo = mysInfo.ckInfo
    this.ckUser = mysInfo.ckUser
    this.uid = uid
    e.targetUser = this.targetUser
    e.selfUser = this.selfUser
    e.isSelfCookie = this.isSelfCookie
  }

  get isSelfCookie () {
    return this.uid * 1 === this.ckUid * 1 || this?.mysInfo?.isSelf
  }

  get ckUid () {
    return this.ckInfo.uid
  }

  get ck () {
    return this.ckInfo.ck
  }

  get selfUser () {
    return new User({ id: this.e.user_id, uid: this.uid })
  }

  get targetUser () {
    return new User({ id: this.e.user_id, uid: this.uid })
  }

  /**
   * @returns {Promise<MysApi>} 
   */
  static async init (e, auth = 'all') {
    if (!e.runtime) {
      Version.runtime()
      return false
    }
    patchMysInfoGetCookie(e.runtime)
    let mys = await e.runtime.getMysInfo(auth)
    if (!mys) {
      return false
    }
    let uid = mys.uid
    e._mys = new MysApi(e, uid, mys)
    return e._mys
  }

  static async initUser (e, auth = 'all') {
    let { runtime } = e
    if (!runtime) {
      Version.runtime()
      return false
    }
    let uid
    if (runtime.getUid) {
      uid = await runtime.getUid()
    } else {
      // 兼容处理老版本Yunzai
      uid = runtime.uid || e.uid
      if (e.at) {
        // 暂时使用MysApi.init替代
        let mys = await MysApi.init(e, auth)
        if (!mys) {
          return false
        }
        uid = mys.uid || uid
      }
    }
    if (uid) {
      return new User({ id: e.user_id, uid })
    } else {
      e.reply(['请先发送【#绑定+你的UID】来绑定查询目标\n星铁请使用【#星铁绑定+UID】', new Button(e).bindUid()])
      e._replyNeedUid = true
      return false
    }
  }

  async getMysApi (e, targetType = 'all', option = {}) {
    if (this.mys) {
      return this.mys
    }
    this.mys = await e.runtime.getMysApi(targetType, option, e.isSr)
    return this.mys
  }

  async getData (api, data) {
    if (!this.mysInfo) {
      return false
    }
    let e = this.e
    let mys = await this.getMysApi(e, api, { log: false })
    if (!mys) {
      return false
    }
    let mysInfo = this.mysInfo || {}
    let ret
    try {
      ret = await mys.getData(api, data)
      if (mysInfo && mysInfo.checkCode) {
        ret = await mysInfo.checkCode(ret, api, this.mys, data)
      }
    } catch (err) {
      if (err?.isMysCodeError) {
        // 一事件只提示一次错误，与 miao 各 app 的 _isReplyed 约定保持一致
        if (!e._isReplyed) {
          e._isReplyed = true
          e.reply(err.replyMsg, false, err.replyOption)
        }
        ret = err.res || false
      } else {
        throw err
      }
    }
    if (!ret) {
      return false
    }
    if (ret.retcode !== 0) {
      e._retcode = ret.retcode
    }
    return ret.data || ret
  }

  // 获取角色信息
  async getCharacter () {
    return await this.getData('character')
  }

  // 获取角色面板
  async getCharacterDetail (character_ids) {
    return await this.getData('characterDetail', { character_ids: character_ids })
  }

  // 获取角色详情
  async getAvatar (id) {
    return await this.getData('detail', { avatar_id: id })
  }

  // 首页宝箱信息
  async getIndex () {
    return await this.getData('index')
  }

  // 获取深渊信息
  async getSpiralAbyss (type = 1) {
    return await this.getData('spiralAbyss', { schedule_type: type })
  }

  // 获取幻想真境剧诗信息
  async getRoleCombat (need_detail = false) {
    return await this.getData('role_combat', { need_detail: need_detail })
  }

  // 获取幽境危战信息
  async getHardChallenge () {
    return await this.getData('hard_challenge')
  }

  // 获取幽境危战赋光之人信息
  async getHardChallengePopularity () {
    return await this.getData('hard_challenge_popularity')
  }

  async getDetail (id) {
    if (this.e.isSr) { return await this.getData('detail', { avatar_id: id, tab_from: 'TabOwned' }) }
    return await this.getData('detail', { avatar_id: id })
  }

  async getCompute (data) {
    return await this.getData('compute', data)
  }

  async getAvatarSkill (id) {
    return await this.getData('avatarSkill', { avatar_id: id })
  }
}
