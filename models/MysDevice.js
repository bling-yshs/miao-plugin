import fetch from 'node-fetch'
import { randomUUID } from 'node:crypto'

const androidFields = ['deviceName', 'deviceBoard', 'deviceModel', 'oaid', 'androidVersion', 'deviceFingerprint', 'deviceProduct']

/**
 * 校验并提取手动指纹或安卓设备信息。
 * @param {object} info 用户提交的设备JSON
 * @returns {object|false} 规范化的设备记录，格式错误时返回false
 */
export function parseDevice (info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return false
  if (info.device_id !== undefined || info.device_fp !== undefined) {
    for (const key of ['device_id', 'device_fp']) {
      if (typeof info[key] !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(info[key])) return false
    }
    return { device_id: info.device_id, device_fp: info.device_fp }
  }
  const android = {}
  for (const key of androidFields) {
    const value = key === 'androidVersion' && typeof info[key] === 'number' ? String(info[key]) : info[key]
    if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return false
    android[key] = value.trim()
  }
  return { device_id: randomUUID(), android }
}

/**
 * 根据安卓设备信息请求米游社设备指纹，保留稳定设备ID。
 * @param {object} device 包含device_id和android信息的设备记录
 * @returns {Promise<object>} 包含指纹及七天有效期的新设备记录
 */
export async function refreshDevice (device) {
  const info = device.android
  const uuid = device.device_id
  const brand = info.deviceFingerprint.split('/')[0]
  const display = info.deviceFingerprint.split('/')[3] || ''
  // 保持与ZZZ插件安卓指纹接口的字段一致。
  const ext = {
    proxyStatus: 1, isRoot: 0, romCapacity: '768', deviceName: info.deviceModel,
    productName: info.deviceProduct, romRemain: '727', hostname: 'BuildHost',
    screenSize: '1096x2434', isTablet: 0, aaid: uuid, model: info.deviceModel,
    brand, hardware: 'qcom', deviceType: info.deviceName, devId: 'REL',
    serialNumber: 'unknown', sdCapacity: 224845, buildTime: '1692775759000',
    buildUser: 'BuildUser', simState: 1, ramRemain: '218344', appUpdateTimeDiff: 1740498108042,
    deviceInfo: info.deviceFingerprint, vaid: uuid, buildType: 'user', sdkVersion: '33',
    ui_mode: 'UI_MODE_TYPE_NORMAL', isMockLocation: 0, cpuType: 'arm64-v8a', isAirMode: 0,
    ringMode: 2, chargeStatus: 1, manufacturer: brand, emulatorStatus: 0, appMemory: '768',
    osVersion: info.androidVersion, vendor: 'unknown', accelerometer: '-1.588236x6.8404818x6.999604',
    sdRemain: 218214, buildTags: 'release-keys', packageName: 'com.mihoyo.hyperion',
    networkType: 'WiFi', oaid: info.oaid, debugStatus: 1, ramCapacity: '224845',
    magnetometer: '-47.04375x51.3375x137.96251', display, appInstallTimeDiff: 1740498108042,
    packageVersion: '2.35.0', gyroscope: '-0.22601996x-0.09453133x0.09040799',
    batteryStatus: 88, hasKeyboard: 0, board: info.deviceBoard
  }
  const response = await fetch('https://public-data-api.mihoyo.com/device-fp/api/getFp', {
    method: 'POST',
    timeout: 10000,
    headers: { 'Content-Type': 'application/json', 'x-rpc-device_id': uuid },
    body: JSON.stringify({
      app_name: 'bbs_cn', bbs_device_id: uuid, device_id: uuid,
      device_fp: device.device_fp || '38d805c20d53d',
      ext_fields: JSON.stringify(ext), platform: '2', seed_id: uuid, seed_time: String(Date.now())
    })
  })
  if (!response.ok) throw new Error('获取设备指纹失败')
  const result = await response.json()
  const fp = result?.data?.device_fp
  if (Number(result?.retcode ?? 0) !== 0 || typeof fp !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(fp)) {
    throw new Error('获取设备指纹失败')
  }
  return { ...device, device_fp: fp, expiresAt: Date.now() + 7 * 86400 * 1000 }
}
