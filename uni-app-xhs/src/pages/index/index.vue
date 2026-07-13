<template>
  <view class="phone-frame">
    <view class="topbar">
      <view>
        <text class="eyebrow">深圳汇职驾校</text>
        <text class="title">{{ activityConfig.activityName }}</text>
      </view>
      <view class="source-pill">{{ getSourceLabel(campaign.source) }}</view>
    </view>

    <!-- Intro -->
    <view v-if="step === 'intro'" class="screen intro-screen">
      <view class="hero-media">
        <image src="/static/mock-assets/activity-poster.svg" mode="aspectFill" />
        <view class="hero-badge">
          <text>✨</text>
          <text>AI 自动生成</text>
        </view>
      </view>

      <view class="hero-copy">
        <text class="hero-title">{{ activityConfig.heroTitle }}</text>
        <text class="hero-desc">{{ activityConfig.heroDescription }}</text>
      </view>

      <view class="benefit-grid">
        <view>
          <text class="benefit-title">扫码进</text>
          <text class="benefit-desc">直接进入活动</text>
        </view>
        <view>
          <text class="benefit-title">自动备好</text>
          <text class="benefit-desc">文案和图片</text>
        </view>
        <view>
          <text class="benefit-title">去打卡</text>
          <text class="benefit-desc">发布后领奖</text>
        </view>
      </view>

      <view class="info-panel">
        <text class="panel-title">参与流程</text>
        <view v-for="(item, index) in activityConfig.steps" :key="item" class="info-row">
          <text class="info-num">{{ index + 1 }}</text>
          <text>{{ item }}</text>
        </view>
      </view>

      <view class="rule-panel">
        <text class="panel-title">活动规则</text>
        <text v-for="item in activityConfig.rules" :key="item" class="rule-item">{{ item }}</text>
      </view>
    </view>

    <!-- Generating -->
    <view v-if="step === 'generating'" class="screen generating-screen">
      <view class="orbital-loader">
        <text class="loader-icon">⏳</text>
      </view>
      <text class="gen-title">正在准备你的分享草稿</text>
      <text class="gen-desc">通义千问正在结合深圳本地学车场景生成内容。</text>

      <view class="progress-card">
        <view v-for="(item, index) in progressSteps" :key="item" :class="['progress-row', index <= loadingIndex ? 'active' : '']">
          <text class="progress-num">{{ index < loadingIndex ? '✓' : index + 1 }}</text>
          <text>{{ item }}</text>
        </view>
      </view>

      <view v-if="error" class="error-box">
        <text class="error-title">生成遇到问题</text>
        <text class="error-msg">{{ error }}</text>
        <button class="error-btn" @click="handleGenerate">重新生成</button>
      </view>
    </view>

    <!-- Result -->
    <view v-if="step === 'result' && draft" class="screen result-screen">
      <view class="preview-card">
        <image :src="asset.url" mode="aspectFill" />
        <view class="asset-caption">
          <text>{{ asset.title }}</text>
          <view class="asset-actions">
            <button class="asset-btn" @click="downloadCurrentAsset">✨ 保存图片</button>
            <button class="asset-btn" @click="switchAsset">🔄 换一组</button>
          </view>
        </view>
      </view>

      <view class="draft-card">
        <text class="eyebrow">打卡内容已生成</text>
        <text class="draft-title">{{ draft.title }}</text>
        <text class="draft-body">{{ draft.body }}</text>
        <view class="tag-list">
          <text v-for="tag in draft.tags" :key="tag" class="tag-item">#{{ tag }}</text>
        </view>
        <view class="draft-meta">
          <text>{{ activityConfig.brandName }}</text>
          <text>{{ asset.tone }}</text>
        </view>
      </view>

      <view class="action-row">
        <button class="secondary-button" @click="copyDraft">
          <text>📋</text>
          <text>{{ copied ? '已复制' : '复制文案' }}</text>
        </button>
        <button class="secondary-button" @click="handleGenerate">
          <text>🪄</text>
          <text>重新生成</text>
        </button>
      </view>
    </view>

    <!-- Publish -->
    <view v-if="step === 'publish' && draft" class="screen publish-screen">
      <view class="publish-hero">
        <text class="publish-icon">📤</text>
        <text class="publish-hero-title">分享到小红书</text>
        <!-- #ifdef H5 -->
          <text class="publish-hero-desc">文案已自动复制，选择一种方式打开小红书 App 粘贴发布。</text>
        <!-- #endif -->
        <!-- #ifdef MP-WEIXIN -->
        <text class="publish-hero-desc">文案已复制到剪贴板，图片已保存到相册。请打开小红书 App 手动发布。</text>
        <!-- #endif -->
      </view>

      <view class="publish-steps">
        <!-- #ifdef H5 -->
        <button class="recommended-step" @click="recommendedPublish">
          <text>📲</text>
          <text>系统分享到小红书（推荐）</text>
          <text>›</text>
        </button>
        <button @click="openRedbook">
          <text>📤</text>
          <text>打开小红书 App 发布入口</text>
          <text>›</text>
        </button>
        <button @click="openTextNoteFallback">
          <text>📋</text>
          <text>打开文字发布界面（仅文案）</text>
          <text>›</text>
        </button>
        <!-- #endif -->
        <!-- #ifdef MP-WEIXIN -->
        <button class="recommended-step" @click="copyDraft">
          <text>📋</text>
          <text>{{ copied ? '文案已复制' : '复制小红书文案' }}</text>
          <text>›</text>
        </button>
        <button class="recommended-step" @click="saveImageToAlbum">
          <text>🖼️</text>
          <text>保存图片到相册</text>
          <text>›</text>
        </button>
        <!-- #endif -->
        <!-- #ifdef MP-XHS -->
        <view v-if="!uploading">
          <post-note-button
            class="xhs-sdk-step"
            :title="draft?.title"
            :content="noteContent"
            :media-info="mediaInfoJson"
            :tags="draft?.tags?.join(',')"
            @success="onPostNoteSuccess"
            @error="onPostNoteError"
          >
            <text>📕</text>
            <text>打开小红书发布（官方能力）</text>
            <text>›</text>
          </post-note-button>
          <button class="recommended-step" @click="copyDraft">
            <text>📋</text>
            <text>{{ copied ? '文案已复制' : '复制小红书文案' }}</text>
            <text>›</text>
          </button>
        </view>
        <view v-if="uploading" class="loading-mask-inline">
          <text>正在上传图片...</text>
        </view>
        <!-- #endif -->
      </view>

      <view v-if="publishMessage" class="publish-message">{{ publishMessage }}</view>

      <button class="done-button" @click="finishPublish">我已发布，领取奖励</button>
    </view>

    <!-- Reward -->
    <view v-if="step === 'reward'" class="screen reward-screen">
      <view class="reward-card">
        <view class="reward-icon"><text>🎁</text></view>
        <text class="eyebrow">{{ published ? '发布完成' : '活动奖励' }}</text>
        <text class="reward-title">{{ activityConfig.contactHint }}</text>
        <text class="reward-desc">{{ activityConfig.rewardDescription }}感谢你分享深圳汇职驾校的学车体验。</text>
        <view class="reward-code">{{ claimCode || defaultClaimCode }}</view>
        <view class="reward-detail">
          <text>入口：{{ getSourceLabel(campaign.source) }}</text>
          <text>时间：{{ publishedAt || '待确认' }}</text>
          <text>状态：{{ published ? '待工作人员核销' : '待发布确认' }}</text>
        </view>
      </view>
    </view>

    <!-- Bottom CTA -->
    <view class="bottom-cta">
      <button v-if="step === 'intro'" class="primary-button" @click="handleGenerate">
        <text>开始分享打卡</text>
        <text>›</text>
      </button>
      <!-- #ifdef H5 -->
      <button v-if="step === 'result'" class="primary-button" @click="handleGoToPublish">
        <text>去小红书发布</text>
        <text>›</text>
      </button>
      <!-- #endif -->
      <!-- #ifdef MP-WEIXIN -->
      <button v-if="step === 'result'" class="primary-button" @click="handleMiniProgramPublish">
        <text>保存并发布</text>
        <text>›</text>
      </button>
      <!-- #endif -->
      <!-- #ifdef MP-XHS -->
      <button v-if="step === 'result'" class="primary-button" @click="handleMpXhsCopyAndPublish">
        <text>去小红书发布</text>
        <text>›</text>
      </button>
      <!-- #endif -->
      <button v-if="step === 'reward'" class="primary-button" @click="restartActivity">
        <text>重新开始</text>
        <text>›</text>
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { activityConfig, getSourceLabel } from '../../activityConfig'
import { mockAssets, selectAsset } from '../../mockAssets'
import { clearShareState, createClaimCode, saveShareState } from '../../utils/localState'
import { generateShareDraft } from '../../utils/qwen'
import { CopyPublisher, MockPublisher } from '../../utils/publishers'
// #ifdef H5
import { DeeplinkPublisher, NativeSharePublisher, XhsSchemePublisher } from '../../utils/publishers'
// #endif
import type { AppStep, MockAsset, ShareDraft } from '../../types'

const progressSteps = ['分析活动入口', '生成小红书标题', '匹配分享素材', '整理发布草稿']

const campaign = computed(() => ({
  source: 'qrcode',
  campaign: 'huizhi-share',
}))

const step = ref<AppStep>('intro')
const draft = ref<ShareDraft | null>(null)
const asset = ref<MockAsset>(mockAssets[0])
const assetCursor = ref(0)
const loadingIndex = ref(0)
const error = ref('')
const copied = ref(false)
const published = ref(false)
const publishMessage = ref('')
const claimCode = ref('')
const publishedAt = ref('')
const defaultClaimCode = computed(() => `HZ-${new Date().getFullYear()}-${campaign.value.source.toUpperCase()}`)

const noteContent = computed(() => {
  if (!draft.value) return ''
  return `${draft.value.body}\n\n${draft.value.tags.map((t) => `#${t}`).join(' ')}`
})

const uploadedImageUrl = ref('')
const uploading = ref(false)

const mediaInfoJson = computed(() => {
  const url = uploadedImageUrl.value || asset.value.url
  if (!url) return ''
  return JSON.stringify({ image_resources: [{ url }] })
})

function getQueryValue(query: Record<string, unknown>, key: string) {
  const value = query[key]
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function tryApplyHandoffDraft(query: Record<string, unknown>) {
  const rawDraft = getQueryValue(query, 'draft') || getQueryValue(query, 'xhsDraft')
  if (!rawDraft) return

  try {
    let parsed: any
    try {
      parsed = JSON.parse(rawDraft)
    } catch {
      parsed = JSON.parse(decodeURIComponent(rawDraft))
    }
    const nextDraft: ShareDraft = {
      title: String(parsed.title || '').slice(0, 24) || '分享体验',
      body: String(parsed.body || ''),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).filter(Boolean).slice(0, 8) : [],
      materialType: 'image',
      style: 'real_experience',
      cta: '',
    }

    if (!nextDraft.body) return

    draft.value = nextDraft
    const firstAsset = Array.isArray(parsed.assets) ? String(parsed.assets[0] || '') : ''
    if (firstAsset) {
      asset.value = {
        id: 'handoff-asset',
        type: 'image',
        title: '活动页已准备素材',
        keywords: [],
        url: firstAsset,
        tone: '来自活动页',
      }
    }
    copied.value = false
    uploadedImageUrl.value = firstAsset || ''
    publishMessage.value = '内容已从活动页带入，请点击官方发布按钮继续。'
    step.value = 'publish'
  } catch (err) {
    console.log('[handoff-draft] parse failed', err)
  }
}

onLoad((query) => {
  tryApplyHandoffDraft((query || {}) as Record<string, unknown>)
})

async function uploadAssetToCloud(): Promise<string> {
  if (!asset.value.url) return ''
  const ext = asset.value.url.split('.').pop() || 'jpg'
  const cloudPath = `huizhi/${Date.now()}.${ext}`

  function doUpload(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      uniCloud.uploadFile({
        filePath,
        cloudPath,
        success(upRes) {
          let fileUrl = upRes.fileID
          if (fileUrl && !fileUrl.startsWith('https://')) {
            uniCloud.getTempFileURL({
              fileList: [fileUrl],
              success(r) {
                const list = r.fileList || []
                resolve(list[0]?.tempFileURL || list[0]?.url || fileUrl)
              },
              fail() { resolve(fileUrl) }
            })
          } else {
            resolve(fileUrl)
          }
        },
        fail: reject
      })
    })
  }

  try {
    return await doUpload(asset.value.url)
  } catch (_) {
    const dlRes = await new Promise<any>((resolve, reject) => {
      uni.downloadFile({ url: asset.value.url, success: resolve, fail: reject })
    })
    return await doUpload(dlRes.tempFilePath)
  }
}

clearShareState()

function getDownloadName(url: string) {
  const cleanUrl = url.split('?')[0]
  return cleanUrl.split('/').pop() || 'huizhi-share.png'
}

async function handleGenerate() {
  step.value = 'generating'
  error.value = ''
  copied.value = false
  loadingIndex.value = 0

  const timer = setInterval(() => {
    loadingIndex.value = Math.min(loadingIndex.value + 1, progressSteps.length - 1)
  }, 520)

  try {
    const generated = await generateShareDraft(campaign.value)
    const selected = selectAsset(generated, 0)
    draft.value = generated
    asset.value = selected
    assetCursor.value = 0
    claimCode.value = ''
    publishedAt.value = ''
    published.value = false
    saveShareState({ draft: generated, asset: selected, claimCode: '', publishedAt: '' })
    setTimeout(() => { step.value = 'result' }, 450)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '生成失败，请稍后重试'
  } finally {
    clearInterval(timer)
  }
}

async function copyDraft() {
  if (!draft.value) return
  const publisher = new CopyPublisher()
  const result = await publisher.publish({
    title: draft.value.title,
    body: draft.value.body,
    tags: draft.value.tags,
    assets: [asset.value.url],
  })
  copied.value = result.success
}

function switchAsset() {
  if (!draft.value) return
  const nextCursor = assetCursor.value + 1
  const nextAsset = selectAsset(draft.value, nextCursor)
  asset.value = nextAsset
  assetCursor.value = nextCursor
  saveShareState({ draft: draft.value, asset: nextAsset })
}

function downloadCurrentAsset() {
  // #ifdef H5
  const link = document.createElement('a')
  link.href = asset.value.url
  link.download = getDownloadName(asset.value.url)
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // #endif
  // #ifdef MP-WEIXIN
  uni.downloadFile({
    url: asset.value.url,
    success: (res) => {
      uni.saveImageToPhotosAlbum({
        filePath: res.tempFilePath,
        fail: () => {
          uni.showToast({ title: '保存失败，请手动保存', icon: 'none' })
        },
      })
    },
  })
  // #endif
}

// #ifdef H5
async function openTextNoteFallback() {
  if (!draft.value) return
  const payload = getPayload()
  if (!payload) return
  const result = await new DeeplinkPublisher('note').publish(payload)
  publishMessage.value = result.message || ''
}

function getPayload() {
  if (!draft.value) return null
  return {
    title: draft.value.title,
    body: draft.value.body,
    tags: draft.value.tags,
    assets: [asset.value.url],
  }
}

async function androidSystemShareFirst() {
  const payload = getPayload()
  if (!payload) return
  publishMessage.value = ''

  await new CopyPublisher().publish(payload)
  copied.value = true

  const shareResult = await new NativeSharePublisher().publish(payload).catch(() => ({ success: false } as any))

  if (shareResult.success) {
    publishMessage.value = '文案已复制，已调起系统分享。请选择小红书；如果文案没有自动带入，请长按粘贴。'
    return
  }

  const deepResult = await new DeeplinkPublisher().publish(payload)
  publishMessage.value = deepResult.message || ''
}

async function nativeShareToRedbook() {
  const payload = getPayload()
  if (!payload) return
  publishMessage.value = ''

  const result = await new NativeSharePublisher().publish(payload).catch(() => null)
  if (result?.success) return

  await new CopyPublisher().publish(payload)
  copied.value = true
  const deepResult = await new DeeplinkPublisher().publish(payload)
  publishMessage.value = deepResult.message || ''
}

async function openRedbook() {
  const payload = getPayload()
  if (!payload) return
  const result = await new DeeplinkPublisher().publish(payload)
  publishMessage.value = result.message || ''
}

async function recommendedPublish() {
  if (/Android/i.test(navigator.userAgent)) {
    await androidSystemShareFirst()
    return
  }
  await nativeShareToRedbook()
}

async function handleGoToPublish() {
  if (!draft.value) return
  await openRedbook()
  step.value = 'publish'
}

// #endif

// #ifdef MP-WEIXIN
async function saveImageToAlbum() {
  if (!draft.value) return
  uni.downloadFile({
    url: asset.value.url,
    success: (res) => {
      uni.saveImageToPhotosAlbum({
        filePath: res.tempFilePath,
        success: () => {
          publishMessage.value = '图片已保存到相册，请打开小红书 App 选择此图片发布。'
        },
        fail: () => {
          publishMessage.value = '保存失败，请长按图片手动保存到相册。'
        },
      })
    },
    fail: () => {
      publishMessage.value = '下载失败，请重试。'
    },
  })
}

async function handleMiniProgramPublish() {
  if (!draft.value) return
  await copyDraft()
  saveImageToAlbum()
  step.value = 'publish'
}
// #endif

// #ifdef MP-XHS
async function handleMpXhsPublish() {
  if (!draft.value) return
  uploading.value = true
  publishMessage.value = '正在准备图片，请稍等...'
  try {
    const url = await uploadAssetToCloud()
    uploadedImageUrl.value = url
    publishMessage.value = '图片和文案已准备好，请点击官方发布按钮继续。'
    step.value = 'publish'
  } catch (err: any) {
    publishMessage.value = ''
    uni.showToast({ title: '图片上传失败: ' + (err.errMsg || String(err)), icon: 'none' })
  } finally {
    uploading.value = false
  }
}

async function handleMpXhsCopyAndPublish() {
  if (!draft.value) return
  await copyDraft()
  await handleMpXhsPublish()
}

function onPostNoteSuccess(e: any) {
  console.log('[post-note-button] success', JSON.stringify(e))
  published.value = true
  publishedAt.value = new Date().toLocaleString()
  publishMessage.value = '已调起小红书官方发布流程，请按页面提示确认发布。'
  uni.showToast({ title: '正在打开发布流程', icon: 'none' })
}

function onPostNoteError(e: any) {
  console.log('[post-note-button] error', JSON.stringify(e))
  const msg = e.detail?.errMsg || e.errMsg || '发布失败'
  uni.showToast({ title: msg, icon: 'none' })
}
// #endif

async function finishPublish() {
  published.value = false
  const result = await new MockPublisher().publish({
    title: draft.value?.title || '',
    body: draft.value?.body || '',
    tags: draft.value?.tags || [],
    assets: [asset.value.url],
  })
  const nextClaimCode = createClaimCode(campaign.value.source)
  const now = new Date()
  const nextPublishedAt = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
  claimCode.value = nextClaimCode
  publishedAt.value = nextPublishedAt
  published.value = result.success
  saveShareState({ draft: draft.value, asset: asset.value, claimCode: nextClaimCode, publishedAt: nextPublishedAt })
  step.value = 'reward'
}

function restartActivity() {
  clearShareState()
  draft.value = null
  asset.value = mockAssets[0]
  assetCursor.value = 0
  copied.value = false
  published.value = false
  claimCode.value = ''
  publishedAt.value = ''
  publishMessage.value = ''
  step.value = 'intro'
}
</script>

<style>
.phone-frame {
  width: 100%;
  min-height: 100vh;
  background: #fbf8f0;
  position: relative;
  overflow: hidden;
}

.topbar {
  height: 78px;
  padding: 18px 20px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.topbar .title {
  display: block;
  margin-top: 3px;
  font-size: 17px;
  font-weight: bold;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  color: #64716a;
  font-size: 12px;
  font-weight: 700;
}

.source-pill {
  flex: 0 0 auto;
  padding: 8px 10px;
  border-radius: 999px;
  color: #17201b;
  background: #e0ff6c;
  font-size: 12px;
  font-weight: 800;
}

.screen {
  padding: 0 20px 104px;
  animation: enter 360ms ease both;
}

@keyframes enter {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

.hero-media {
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  aspect-ratio: 3 / 4;
  max-height: 448px;
  background: #17201b;
}

.hero-media image {
  width: 100%;
  height: 100%;
}

.hero-badge {
  position: absolute;
  left: 14px;
  bottom: 14px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  border-radius: 999px;
  color: #17201b;
  background: rgba(251, 248, 240, 0.92);
  font-size: 13px;
  font-weight: 800;
}

.hero-copy {
  margin-top: 20px;
}

.hero-title {
  display: block;
  color: #17201b;
  font-size: 30px;
  line-height: 1.1;
  font-weight: bold;
}

.hero-desc {
  display: block;
  margin-top: 12px;
  color: #64716a;
  font-size: 15px;
  line-height: 1.65;
}

.benefit-grid {
  margin-top: 18px;
  display: flex;
  gap: 8px;
}

.benefit-grid > view {
  flex: 1;
  min-width: 0;
  padding: 14px 10px;
  border: 1px solid rgba(23, 32, 27, 0.08);
  border-radius: 16px;
  background: #ffffff;
}

.benefit-title {
  display: block;
  text-align: center;
  font-size: 15px;
  font-weight: bold;
}

.benefit-desc {
  display: block;
  text-align: center;
  margin-top: 4px;
  color: #7c877f;
  font-size: 11px;
  line-height: 1.3;
}

.info-panel,
.rule-panel {
  margin-top: 14px;
  padding: 15px;
  border: 1px solid rgba(23, 32, 27, 0.08);
  border-radius: 18px;
  background: #ffffff;
}

.panel-title {
  display: block;
  margin-bottom: 10px;
  color: #17201b;
  font-size: 14px;
  font-weight: 900;
}

.info-row {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #3f4a43;
  font-size: 13px;
  font-weight: 700;
}

.info-num {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #17201b;
  background: #e0ff6c;
  font-size: 12px;
  font-weight: 900;
}

.rule-item {
  display: block;
  margin-top: 8px;
  color: #6d7871;
  font-size: 12px;
  line-height: 1.5;
}

.generating-screen {
  min-height: 660px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.orbital-loader {
  width: 92px;
  height: 92px;
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e0ff6c;
  box-shadow: 0 18px 44px rgba(95, 128, 30, 0.18);
}

.loader-icon {
  font-size: 36px;
  animation: spin 900ms linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.gen-title {
  display: block;
  color: #17201b;
  font-size: 30px;
  line-height: 1.1;
  font-weight: bold;
}

.gen-desc {
  display: block;
  margin-top: 12px;
  color: #64716a;
  font-size: 15px;
  line-height: 1.65;
}

.progress-card,
.draft-card,
.publish-steps,
.reward-card {
  margin-top: 22px;
  padding: 16px;
  border: 1px solid rgba(23, 32, 27, 0.08);
  border-radius: 22px;
  background: #ffffff;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 42px;
  color: #8a948d;
  font-size: 14px;
  font-weight: 700;
}

.progress-num {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #eef1ea;
  font-size: 12px;
}

.progress-row.active {
  color: #17201b;
}

.progress-row.active .progress-num {
  background: #e0ff6c;
}

.error-box {
  margin-top: 18px;
  padding: 14px;
  border-radius: 18px;
  color: #8c2d20;
  background: #fff0ed;
}

.error-title {
  display: block;
  font-weight: bold;
}

.error-msg {
  display: block;
  margin-top: 4px;
  font-size: 13px;
}

.error-btn {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  color: #ffffff;
  background: #17201b;
  border: 0;
  font-size: 14px;
}

.preview-card {
  overflow: hidden;
  border-radius: 24px;
  background: #17201b;
}

.preview-card image {
  width: 100%;
  aspect-ratio: 3 / 4;
  max-height: 390px;
  display: block;
}

.asset-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  color: #f8f5ec;
  font-size: 13px;
  font-weight: 800;
}

.asset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 999px;
  color: #17201b;
  background: #e0ff6c;
  font-size: 12px;
  font-weight: 800;
  border: 0;
}

.asset-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.draft-card .draft-title {
  display: block;
  margin-top: 6px;
  color: #17201b;
  font-size: 24px;
  line-height: 1.1;
  font-weight: bold;
}

.draft-body {
  display: block;
  max-height: 168px;
  overflow: auto;
  margin-top: 12px;
  color: #3e4741;
  font-size: 14px;
  line-height: 1.68;
  white-space: pre-line;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.tag-item {
  padding: 7px 9px;
  border-radius: 999px;
  color: #415044;
  background: #eef1ea;
  font-size: 12px;
  font-weight: 700;
}

.draft-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.draft-meta text {
  padding: 7px 9px;
  border-radius: 10px;
  color: #64716a;
  background: #f5f6f1;
  font-size: 11px;
  font-weight: 800;
}

.action-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.action-row button {
  flex: 1;
}

.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  border-radius: 16px;
  font-weight: 900;
  color: #17201b;
  background: #ffffff;
  border: 1px solid rgba(23, 32, 27, 0.08);
  font-size: 14px;
}

.publish-hero {
  margin-top: 92px;
  padding: 24px 0 10px;
}

.publish-icon {
  font-size: 36px;
  display: block;
  width: 60px;
  height: 60px;
  line-height: 60px;
  text-align: center;
  border-radius: 20px;
  background: #e0ff6c;
}

.publish-hero-title {
  display: block;
  margin-top: 12px;
  color: #17201b;
  font-size: 30px;
  line-height: 1.1;
  font-weight: bold;
}

.publish-hero-desc {
  display: block;
  margin-top: 12px;
  color: #64716a;
  font-size: 15px;
  line-height: 1.65;
}

.publish-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.publish-steps button {
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  color: #17201b;
  background: transparent;
  text-align: left;
  font-weight: 800;
  font-size: 14px;
  border: 0;
}

.publish-steps button.recommended-step {
  padding: 0 12px;
  border-radius: 16px;
  color: #17201b;
  background: #e0ff6c;
}

.publish-steps button.xhs-sdk-step,
.publish-steps post-note-button.xhs-sdk-step {
  margin-bottom: 6px;
  padding: 0 14px;
  border-radius: 16px;
  color: #ffffff;
  background: #ff2442;
  font-size: 15px;
  font-weight: 900;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  text-align: left;
  border: 0;
}

.publish-message {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  color: #425044;
  background: #eef1ea;
  font-size: 13px;
  line-height: 1.5;
}

.done-button {
  width: 100%;
  margin-top: 16px;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 16px;
  font-weight: 900;
  color: #ffffff;
  background: #17201b;
  border: 0;
  font-size: 16px;
}

.reward-screen {
  min-height: 660px;
  display: flex;
  align-items: center;
}

.reward-card {
  width: 100%;
  padding: 26px 20px;
}

.reward-icon {
  width: 82px;
  height: 82px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 26px;
  background: #e0ff6c;
  font-size: 36px;
}

.reward-title {
  display: block;
  margin-top: 4px;
  color: #17201b;
  font-size: 30px;
  line-height: 1.1;
  font-weight: bold;
}

.reward-desc {
  display: block;
  margin-top: 12px;
  color: #64716a;
  font-size: 15px;
  line-height: 1.65;
}

.reward-code {
  margin-top: 20px;
  padding: 16px;
  border-radius: 16px;
  color: #17201b;
  background: #f1f3ec;
  text-align: center;
  font-size: 18px;
  font-weight: 900;
}

.reward-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.reward-detail text {
  padding: 10px 12px;
  border-radius: 12px;
  color: #526058;
  background: #f8f9f5;
  font-size: 13px;
  font-weight: 700;
}

.bottom-cta {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 20px calc(18px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(251, 248, 240, 0) 0%, #fbf8f0 28%);
}

.primary-button {
  width: 100%;
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 16px;
  font-weight: 900;
  color: #ffffff;
  background: #17201b;
  box-shadow: 0 18px 34px rgba(23, 32, 27, 0.18);
  border: 0;
  font-size: 16px;
}

/* #ifdef MP-WEIXIN */
page {
  background: #fbf8f0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #17201b;
  font-size: 14px;
}
/* #endif */
/* #ifdef MP-XHS */
page {
  background: #fbf8f0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #17201b;
  font-size: 14px;
}
/* #endif */

.loading-mask-inline {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: #eef1ea;
  color: #64716a;
  font-size: 14px;
  font-weight: 700;
}

/* #ifdef H5 */
body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: radial-gradient(circle at 14% 12%, rgba(217, 255, 102, 0.3), transparent 28%),
              linear-gradient(135deg, #f6f1e7 0%, #e7edf0 48%, #f7efe7 100%);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #17201b;
}

.app-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 24px;
}

button {
  border: 0;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
/* #endif */
</style>
