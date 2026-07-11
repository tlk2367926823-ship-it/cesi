# 商家后台第一版需求

## 目标

后台第一版用于帮助商家查看产品使用情况，不做复杂数据分析，重点是按商家查看核心转化数据。

## 后台入口

当前 H5 演示入口：

```text
/?admin=1
```

示例：

```text
https://你的域名/?admin=1
```

## 商家维度

前台活动页可通过 URL 参数区分商家：

```text
/?merchantId=a90fd384-a296-4a95-98dd-b3e79fc36d93&merchantName=深圳汇职驾校
```

后续接 uniCloud / 后台数据库时，所有数据都按 `merchantId` 聚合。

## 第一版统计字段

每个商家需要统计：

| 字段 | 说明 |
| --- | --- |
| 今日进入产品人数 | 当日进入活动页的用户数 |
| 累计进入产品人数 | 历史累计进入活动页的用户数 |
| 小红书分享次数 | 用户点击小红书发布流程的次数 |
| 美团分享次数 | 用户点击美团发布/评价流程的次数 |
| 大众点评分享次数 | 用户点击大众点评发布/评价流程的次数 |

## 当前前端已实现

当前版本已实现：

- `?admin=1` 商家后台页面
- 商家下拉切换
- 日期选择，可查看不同日期数据
- 今日进入、累计进入、小红书、美团、大众点评数据卡片
- 商家总表
- 前台进入产品时记录进入数据
- 用户点击发布流程时记录对应平台次数
- Netlify Functions + Netlify Blobs 云端统计接口
- 本地 fallback，方便本地开发预览

## 当前真实数据接口

已内置 Netlify 云函数：

```text
/.netlify/functions/analytics
```

### 记录进入

```http
POST /.netlify/functions/analytics
```

```json
{
  "type": "entry",
  "merchantId": "a90fd384-a296-4a95-98dd-b3e79fc36d93",
  "merchantName": "深圳汇职驾校",
  "visitorId": "用户唯一标识",
  "date": "2026-07-11"
}
```

### 记录分享点击

```http
POST /.netlify/functions/analytics
```

```json
{
  "type": "share",
  "merchantId": "a90fd384-a296-4a95-98dd-b3e79fc36d93",
  "merchantName": "深圳汇职驾校",
  "platform": "redbook",
  "date": "2026-07-11"
}
```

### 查询后台统计

```http
GET /.netlify/functions/analytics?date=2026-07-11
```

## 后续接 uniCloud 建议接口

### 记录进入

```http
POST /api/analytics/entry
```

```json
{
  "merchantId": "a90fd384-a296-4a95-98dd-b3e79fc36d93",
  "merchantName": "深圳汇职驾校",
  "source": "nfc",
  "visitorId": "用户唯一标识"
}
```

### 记录分享点击

```http
POST /api/analytics/share
```

```json
{
  "merchantId": "a90fd384-a296-4a95-98dd-b3e79fc36d93",
  "merchantName": "深圳汇职驾校",
  "platform": "redbook"
}
```

`platform` 可选：

- `redbook`
- `meituan`
- `dianping`

### 查询后台统计

```http
GET /api/admin/merchant-stats
```

返回示例：

```json
{
  "merchants": [
    {
      "merchantId": "a90fd384-a296-4a95-98dd-b3e79fc36d93",
      "merchantName": "深圳汇职驾校",
      "todayEntries": 32,
      "totalEntries": 428,
      "redbookShares": 18,
      "meituanShares": 9,
      "dianpingShares": 5,
      "updatedAt": "2026-07-11T10:00:00.000Z"
    }
  ]
}
```

## 注意

当前版本是静态前端演示，数据存在用户浏览器本地。正式上线如需跨设备、跨商家真实统计，需要接入 uniCloud、数据库或其他后端服务。

