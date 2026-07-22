import { Check, ChevronRight, Clipboard, Loader2, RefreshCw, Send, Share2, Sparkles, Wand2 } from "lucide-react";
import { Download, Grid3X3, Upload } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { activityConfig, getSourceLabel } from "./activityConfig";
import { AdminDashboard } from "./AdminDashboard";
import { getMerchantFromUrl, trackProductEntry, trackShareClick } from "./analytics";
import { clearShareState, saveShareState } from "./localState";
import { defaultMerchantProfile, fetchMerchantProfile } from "./merchantProfile";
import { getMerchantAssets, selectAsset } from "./mockAssets";
import { CopyPublisher, DeeplinkPublisher, NativeSharePublisher, XhsSchemePublisher, openReviewAppFirst } from "./publishers";
import { generateShareDraft } from "./qwen";
import type { AppStep, KeywordSelection, MockAsset, ShareDraft, SharePlatform } from "./types";

const progressSteps = ["分析活动入口", "生成平台文案", "匹配分享素材", "整理发布草稿"];

const platformOptions: Array<{ id: SharePlatform; label: string; hint: string; tagline: string; logo: string }> = [
  { id: "redbook", label: "小红书", hint: "图文种草", tagline: "种草传播 · 内容分享", logo: "小" },
  { id: "meituan", label: "美团", hint: "门店评价", tagline: "提升评分 · 增加曝光", logo: "美" },
  { id: "dianping", label: "大众点评", hint: "探店评价", tagline: "探店推荐 · 口碑传播", logo: "评" },
];

const flowDescriptions = ["选择想发布的平台", "系统自动生成文案和配图", "保存图片和文案到本地", "前往对应平台完成发布"];

const flowIcons = [Grid3X3, Clipboard, Download, Upload];
const xhsMiniProgramDefaultUrl = import.meta.env.VITE_XHS_MINI_PROGRAM_URL || "";

function isAndroidBrowser() {
  const previewMode = new URLSearchParams(window.location.search).get("preview");
  if (previewMode === "android") return true;
  return /Android/i.test(navigator.userAgent);
}

function isWechatBrowser() {
  const previewMode = new URLSearchParams(window.location.search).get("preview");
  if (previewMode === "wechat") return true;
  return /MicroMessenger/i.test(navigator.userAgent);
}

function shouldShowBrowserGuide() {
  const search = new URLSearchParams(window.location.search);
  const entry = search.get("entry") || search.get("source") || "";
  if (entry === "nfc") return false;
  if (entry === "qr" || entry === "qrcode") return isWechatBrowser();
  return false;
}

function isQrEntrySource(source: string) {
  const normalized = source.toLowerCase();
  return normalized === "qr" || normalized === "qrcode";
}

function isNoKeywordQrEntry() {
  const search = new URLSearchParams(window.location.search);
  const entry = search.get("entry") || search.get("source") || "";
  const keywordMode = search.get("keyword") || search.get("mode") || "";
  return isQrEntrySource(entry) && ["off", "none", "quick"].includes(keywordMode.toLowerCase());
}

function getEntryVariant() {
  const search = new URLSearchParams(window.location.search);
  const entry = search.get("entry") || search.get("source") || "";
  if (entry.toLowerCase() === "nfc") return "nfc";
  if (isNoKeywordQrEntry()) return "qrcode-simple";
  if (isQrEntrySource(entry)) return "qrcode-keyword";
  return "nfc";
}

function isAdminRoute() {
  const search = new URLSearchParams(window.location.search);
  return search.get("admin") === "1" || window.location.pathname.replace(/\/$/, "").endsWith("/admin");
}

function useCampaign() {
  return useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    const merchant = getMerchantFromUrl();
    return {
      source: search.get("source") || search.get("entry") || "nfc",
      campaign: search.get("campaign") || "huizhi-share",
      ...merchant,
    };
  }, []);
}

function formatCopy(draft: ShareDraft) {
  return `${draft.title}\n\n${draft.body}\n\n${draft.tags.map((tag) => `#${tag}`).join(" ")}`;
}

function getDownloadName(url: string) {
  const cleanUrl = url.split("?")[0];
  return cleanUrl.split("/").pop() || "huizhi-share.png";
}

function triggerImageDownload(href: string, fileName: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function isReviewPlatform(platform: SharePlatform) {
  return platform === "meituan" || platform === "dianping";
}

function getReviewPlatformName(platform: SharePlatform) {
  return platform === "meituan" ? "美团" : "大众点评";
}

function getPlatformPayload(draft: ShareDraft, platform: SharePlatform) {
  return {
    title: draft.title,
    body: draft.body,
    tags: draft.tags,
  };
}

function getAbsoluteAssetUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
}

function buildXhsMiniProgramUrl(
  baseUrl: string,
  draft: ShareDraft,
  assetUrl: string,
  merchantProfile: typeof defaultMerchantProfile,
  campaign: ReturnType<typeof useCampaign>,
) {
  const handoffDraft = {
    title: draft.title,
    body: draft.body,
    tags: draft.tags,
    assets: [getAbsoluteAssetUrl(assetUrl)],
    merchantId: merchantProfile.id || campaign.merchantId,
    merchantName: merchantProfile.name || campaign.merchantName,
    source: campaign.source,
    campaign: campaign.campaign,
  };

  const encodedDraft = encodeURIComponent(JSON.stringify(handoffDraft));

  try {
    const target = new URL(baseUrl);
    target.searchParams.set("draft", JSON.stringify(handoffDraft));
    target.searchParams.set("source", campaign.source || "h5");
    return target.toString();
  } catch {
    if (/^xhsdiscover:\/\//i.test(baseUrl)) {
      const separator = baseUrl.includes("?") ? "&" : "?";
      return `${baseUrl}${separator}draft=${encodedDraft}&source=${encodeURIComponent(campaign.source || "h5")}`;
    }

    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}draft=${encodedDraft}&source=${encodeURIComponent(campaign.source || "h5")}`;
  }
}

export default function App() {
  const isAdmin = useMemo(() => isAdminRoute(), []);
  const campaign = useCampaign();
  const isAndroid = useMemo(() => isAndroidBrowser(), []);
  const showBrowserGuide = useMemo(() => shouldShowBrowserGuide(), []);
  const entryVariant = useMemo(() => getEntryVariant(), []);
  const [step, setStep] = useState<AppStep>("intro");
  const [draft, setDraft] = useState<ShareDraft | null>(null);
  const [merchantProfile, setMerchantProfile] = useState(defaultMerchantProfile);
  const [asset, setAsset] = useState<MockAsset>(getMerchantAssets(defaultMerchantProfile)[0]);
  const [assetCursor, setAssetCursor] = useState(0);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharePlatform, setSharePlatform] = useState<SharePlatform>("redbook");
  const [publishMessage, setPublishMessage] = useState("");
  const [keywordModalOpen, setKeywordModalOpen] = useState(false);
  const [keywordSelection, setKeywordSelection] = useState<KeywordSelection>({
    services: [],
    features: [],
    length: defaultMerchantProfile.lengthOptions[0] || "详细一点",
  });
  const platformPayload = draft ? getPlatformPayload(draft, sharePlatform) : null;

  useEffect(() => {
    if (isAdmin) return;
    clearShareState();
    trackProductEntry(campaign.merchantId, campaign.merchantName);
  }, [campaign.merchantId, campaign.merchantName, isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    let mounted = true;
    fetchMerchantProfile({ merchantId: campaign.merchantId, merchantName: campaign.merchantName }).then((profile) => {
      if (!mounted) return;
      setMerchantProfile(profile);
      setAsset(getMerchantAssets(profile)[0]);
    });
    return () => {
      mounted = false;
    };
  }, [campaign.merchantId, campaign.merchantName, isAdmin]);

  function getDefaultKeywordSelection(profile = merchantProfile): KeywordSelection {
    return {
      services: [],
      features: [],
      length: profile.lengthOptions[0] || "详细一点",
    };
  }

  function openKeywordModal() {
    const selection = getDefaultKeywordSelection();
    setKeywordSelection(selection);
    setKeywordModalOpen(true);
  }

  function quickGenerate() {
    const selection = getDefaultKeywordSelection();
    setKeywordSelection(selection);
    setKeywordModalOpen(false);
    void handleGenerate(selection);
  }

  function startByEntryVariant() {
    if (entryVariant === "qrcode-keyword") {
      openKeywordModal();
      return;
    }

    quickGenerate();
  }

  function toggleKeyword(group: "services" | "features", value: string) {
    setKeywordSelection((current) => {
      const exists = current[group].includes(value);
      const nextValues = exists ? current[group].filter((item) => item !== value) : [...current[group], value].slice(0, 4);
      return { ...current, [group]: nextValues };
    });
  }

  function confirmKeywordGenerate() {
    const selection = {
      ...keywordSelection,
      length: keywordSelection.length || merchantProfile.lengthOptions[0] || "详细一点",
    };
    setKeywordSelection(selection);
    setKeywordModalOpen(false);
    void handleGenerate(selection);
  }

  async function handleGenerate(preferences = keywordSelection) {
    setStep("generating");
    setError("");
    setCopied(false);
    setLoadingIndex(0);

    const timer = window.setInterval(() => {
      setLoadingIndex((index) => Math.min(index + 1, progressSteps.length - 1));
    }, 520);

    try {
      const generated = await generateShareDraft({ ...campaign, platform: sharePlatform, profile: merchantProfile, preferences });
      const nextCursor = draft ? assetCursor + 1 : 0;
      const selected = selectAsset(generated, nextCursor, merchantProfile);
      setDraft(generated);
      setAsset(selected);
      setAssetCursor(nextCursor);
      saveShareState({ draft: generated, asset: selected });
      window.setTimeout(() => setStep("result"), 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请稍后重试");
    } finally {
      window.clearInterval(timer);
    }
  }

  async function copyDraft() {
    if (!draft) return;
    setPublishMessage("");
    const publisher = new CopyPublisher();
    const platformPayload = getPlatformPayload(draft, sharePlatform);
    const result = await publisher.publish({
      ...platformPayload,
      assets: [asset.url],
    });
    setCopied(result.success);
    if (step === "publish") {
      setPublishMessage(
        result.success
          ? isReviewPlatform(sharePlatform)
            ? `${getReviewPlatformName(sharePlatform)}评价文案已复制，到 App 后长按粘贴即可。`
            : "全部文案已复制，到小红书后长按粘贴即可。"
          : result.message || "当前浏览器不支持自动复制，请手动复制文案。",
      );
    }
  }

  async function preparePublishMaterials() {
    await copyDraft();
    const downloaded = await downloadCurrentAsset(false);
    setPublishMessage(
      downloaded
        ? isReviewPlatform(sharePlatform)
          ? `${getReviewPlatformName(sharePlatform)}评价文案已复制，图片已开始保存。保存完成后点击“打开${getReviewPlatformName(sharePlatform)}”。`
          : "全部文案已复制，图片已开始保存。保存完成后点击“一键发布小红书”。"
        : "文案已复制。当前浏览器可能拦截下载，如没有自动保存，请长按图片预览手动保存。",
    );
  }

  function switchAsset() {
    if (!draft) return;
    const nextCursor = assetCursor + 1;
    const nextAsset = selectAsset(draft, nextCursor, merchantProfile);
    setAsset(nextAsset);
    setAssetCursor(nextCursor);
    saveShareState({ draft, asset: nextAsset });
  }

  async function downloadCurrentAsset(showMessage = true) {
    const fileName = getDownloadName(asset.url);
    const imageUrl = new URL(asset.url, window.location.href).toString();

    try {
      const response = await fetch(imageUrl, { mode: "cors" });
      if (!response.ok) throw new Error("image unavailable");

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerImageDownload(objectUrl, fileName);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);

      if (showMessage) {
        setPublishMessage("图片已开始保存。如果手机没有弹出下载提示，请长按上方图片手动保存。");
      }
      return true;
    } catch {
      triggerImageDownload(imageUrl, fileName);
      if (showMessage) {
        setPublishMessage("当前浏览器可能拦截下载。如果没有保存成功，请长按上方图片手动保存。");
      }
      return false;
    }
  }

  async function prepareAndroidAsset() {
    if (!draft) return;
    setPublishMessage("");

    const payload = {
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      assets: [asset.url],
    };

    try {
      await new CopyPublisher().publish(payload);
      setCopied(true);
      const downloaded = await downloadCurrentAsset(false);
      setPublishMessage(
        downloaded
          ? "文案已复制，图片已开始保存。请等手机提示下载完成后，再点击“我已保存，打开相册发布”。"
          : "文案已复制。当前浏览器可能拦截下载，请长按图片手动保存后，再打开相册发布。",
      );
    } catch {
      setPublishMessage("图片已开始保存。如文案没有自动复制，请先点“复制小红书文案”。");
    }
  }

  async function openAndroidAlbumAfterSaved() {
    if (!draft) return;
    setPublishMessage("");

    const payload = {
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      assets: [asset.url],
    };

    try {
      await new CopyPublisher().publish(payload);
      setCopied(true);
      const deeplinkResult = await new DeeplinkPublisher().publish(payload);
      setPublishMessage(
        deeplinkResult.success
          ? "正在尝试打开小红书相册发布入口。进入后选择刚保存的图片，并粘贴文案。"
          : "正在准备跳转小红书，请按页面提示继续操作。",
      );
      window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await new XhsSchemePublisher().publish(payload);
          setPublishMessage("正在换一种方式尝试打开小红书相册发布入口。");

          window.setTimeout(async () => {
            if (document.visibilityState === "visible") {
              await new DeeplinkPublisher("home").publish(payload);
              setPublishMessage("相册入口未打开时，正在改为打开小红书 App 首页。进入后点底部 + 发布。");
            }
          }, 1600);
        }
      }, 1400);
    } catch {
      setPublishMessage("文案已复制。如果发布入口打不开，请手动打开小红书点底部 + 发布。");
    }
  }

  async function androidSystemShareFirst() {
    if (!draft) return;
    setPublishMessage("");

    const payload = {
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      assets: [asset.url],
    };

    try {
      await new CopyPublisher().publish(payload);
      setCopied(true);
      const shareResult = await new NativeSharePublisher().publish(payload);

      if (shareResult.success) {
        setPublishMessage("文案已复制，已调起系统分享。请选择小红书；如果没有进入发布页，会继续尝试打开相册入口。");
        window.setTimeout(async () => {
          if (document.visibilityState === "visible") {
            await openAndroidAlbumAfterSaved();
          }
        }, 2500);
        return;
      }

      await openAndroidAlbumAfterSaved();
    } catch {
      await openAndroidAlbumAfterSaved();
    }
  }

  async function openReviewPlatformPublish(platform: Extract<SharePlatform, "meituan" | "dianping">) {
    if (!draft) return;
    setPublishMessage("");
    const platformName = getReviewPlatformName(platform);
    const platformPayload = getPlatformPayload(draft, platform);

    await new CopyPublisher().publish({
      ...platformPayload,
      assets: [asset.url],
    });
    setCopied(true);
    setPublishMessage(`${platformName}评价文案已复制。正在优先打开官方分享链接的 App 版本，请进入门店后粘贴发布评价。`);

    const customUrl = platform === "meituan" ? merchantProfile.meituanUrl : merchantProfile.dianpingUrl;
    await openReviewAppFirst(platform, customUrl);
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        setPublishMessage(`如果没有进入${platformName} App，会继续尝试备用入口；仍打不开时会停留在门店分享页。`);
      }
    }, 2600);
  }

  async function openTextNoteFallback() {
    if (!draft) return;
    const payload = {
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      assets: [asset.url],
    };
    await new CopyPublisher().publish(payload);
    setCopied(true);
    await new DeeplinkPublisher("note").publish(payload);
    setPublishMessage("文案已复制，正在打开小红书文字发布界面。进入后直接粘贴文案即可。");
  }

  async function nativeShareToRedbook() {
    if (!draft) return;
    setPublishMessage("");

    const payload = {
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      assets: [asset.url],
    };

    try {
      await new CopyPublisher().publish(payload);
      setCopied(true);
      const result = await new NativeSharePublisher().publish(payload);

      if (!result.success) {
        const deeplinkResult = await new DeeplinkPublisher().publish(payload);
        setPublishMessage(deeplinkResult.success ? "文案已复制，正在打开小红书。" : "文案已复制，请返回页面重试或手动打开小红书。");
        return;
      }

      setPublishMessage("文案已复制，已调起 iPhone 系统分享。请选择小红书完成发布。");
    } catch (err) {
      await new CopyPublisher().publish(payload);
      const deeplinkResult = await new DeeplinkPublisher().publish(payload);
      setCopied(true);
      setPublishMessage(deeplinkResult.success ? "文案已复制，正在打开小红书。" : "文案已复制，请返回页面重试或手动打开小红书。");
    }
  }

  async function openXhsMiniProgramOfficialPublish() {
    if (!draft) return false;

    const miniProgramUrl = merchantProfile.xiaohongshuUrl || xhsMiniProgramDefaultUrl;
    if (!miniProgramUrl) return false;

    const payload = {
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      assets: [asset.url],
    };

    await new CopyPublisher().publish(payload);
    setCopied(true);
    const targetUrl = buildXhsMiniProgramUrl(miniProgramUrl, draft, asset.url, merchantProfile, campaign);
    setPublishMessage("文案已复制，正在优先打开小红书官方发布入口。进入后点击官方发布按钮即可。");
    window.location.href = targetUrl;
    return true;
  }

  async function openRedbook() {
    if (!draft) return;
    if (isAndroid) {
      await openAndroidAlbumAfterSaved();
      return;
    }
    await copyDraft();
    await new DeeplinkPublisher().publish({
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      assets: [asset.url],
    });
  }

  async function recommendedPublish() {
    trackShareClick(campaign.merchantId, campaign.merchantName, sharePlatform);

    if (sharePlatform === "meituan" || sharePlatform === "dianping") {
      await openReviewPlatformPublish(sharePlatform);
      return;
    }

    if (!isAndroid) {
      await nativeShareToRedbook();
      return;
    }

    await androidSystemShareFirst();
  }

  async function oneTapCopyAndPublish() {
    if (!draft) return;
    const platformPayload = getPlatformPayload(draft, sharePlatform);
    const copyResult = await new CopyPublisher().publish({
      ...platformPayload,
      assets: [asset.url],
    });
    setCopied(copyResult.success);
    setPublishMessage(
      copyResult.success
        ? "文案已复制，正在打开发布页面。进入后长按粘贴即可发布。"
        : copyResult.message || "正在打开发布页面。如文案没有自动复制，请返回页面手动复制。",
    );

    window.setTimeout(() => {
      void recommendedPublish();
    }, 350);
  }

  function restartActivity() {
    clearShareState();
    setDraft(null);
    setAsset(getMerchantAssets(merchantProfile)[0]);
    setAssetCursor(0);
    setCopied(false);
    setPublishMessage("");
    setStep("intro");
  }

  if (isAdmin) {
    return <AdminDashboard />;
  }

  if (showBrowserGuide) {
    return (
      <main className="browser-open-shell">
        <section className="browser-open-card">
          <div className="guide-top-dots">
            <span />
            <span />
            <span />
          </div>
          <div className="guide-arrow" aria-hidden="true" />
          <h1>还差1步即可发布</h1>
          <p>
            由于微信限制，请点击右上角 <strong>...</strong>
            <br />
            选择 <em>“在浏览器打开”</em>
          </p>
          <div className="guide-phone">
            <div className="guide-notch" />
            <div className="guide-browser-bubble">
              <span>🌐</span>
              在浏览器打开
            </div>
            <div className="guide-grid">
              {Array.from({ length: 8 }).map((_, index) => (
                <i key={index} />
              ))}
            </div>
          </div>
          <div className="guide-note">打开后可正常保存图片、复制文案并跳转 App</div>
        </section>
      </main>
    );
  }

  const selectedKeywordLabels = [...keywordSelection.services, ...keywordSelection.features];
  const selectedKeywordText =
    selectedKeywordLabels.length > 0
      ? `${selectedKeywordLabels.slice(0, 4).join("、")} · ${keywordSelection.length || "详细一点"}`
      : `默认按商家资料生成 · ${keywordSelection.length || "详细一点"}`;

  return (
    <main className="app-shell">
      <div className="phone-frame">
        {keywordModalOpen && (
          <div className="keyword-modal-backdrop" role="dialog" aria-modal="true">
            <section className="keyword-modal-card">
              <button className="keyword-close" type="button" onClick={() => setKeywordModalOpen(false)} aria-label="关闭">
                ×
              </button>
              <span className="eyebrow">生成前选择</span>
              <h2>想重点分享什么？</h2>
              <p>选择 1-4 个关键词，系统会按你的选择生成更贴近真实体验的文案。</p>

              <div className="keyword-group">
                <strong>产品 / 套餐 / 服务</strong>
                <div className="keyword-chip-list">
                  {merchantProfile.serviceKeywords.map((item) => (
                    <button
                      type="button"
                      className={keywordSelection.services.includes(item) ? "active" : ""}
                      key={item}
                      onClick={() => toggleKeyword("services", item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="keyword-group">
                <strong>特色 / 宣传点</strong>
                <div className="keyword-chip-list">
                  {merchantProfile.featureKeywords.map((item) => (
                    <button
                      type="button"
                      className={keywordSelection.features.includes(item) ? "active" : ""}
                      key={item}
                      onClick={() => toggleKeyword("features", item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="keyword-group">
                <strong>文案长度</strong>
                <div className="keyword-chip-list keyword-chip-list-compact">
                  {merchantProfile.lengthOptions.map((item) => (
                    <button
                      type="button"
                      className={keywordSelection.length === item ? "active" : ""}
                      key={item}
                      onClick={() => setKeywordSelection((current) => ({ ...current, length: item }))}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="keyword-confirm-note">
                <strong>已选 {selectedKeywordLabels.length} 个重点</strong>
                <span>{selectedKeywordText}</span>
              </div>

              <button className="keyword-confirm" type="button" onClick={confirmKeywordGenerate}>
                <span>生成打卡文案</span>
                <small>按上方选择生成，更像真实顾客体验</small>
                <ChevronRight size={18} />
              </button>
            </section>
          </div>
        )}
        <header className="topbar">
          <div>
            <strong>{activityConfig.activityName}</strong>
          </div>
          <div className="source-pill">{getSourceLabel(campaign.source)}</div>
        </header>

        {step === "intro" && (
          <section className="screen intro-screen">
            <div className="platform-panel platform-panel-home">
              <div className="section-heading">
                <Sparkles size={16} />
                <span>选择发布平台</span>
                <Sparkles size={16} />
              </div>
              <div className="platform-toggle">
                {platformOptions.map((platform) => (
                  <button
                    className={sharePlatform === platform.id ? "active" : ""}
                    key={platform.id}
                    onClick={() => {
                      setSharePlatform(platform.id);
                      setCopied(false);
                      setPublishMessage("");
                    }}
                  >
                    {sharePlatform === platform.id && (
                      <span className="selected-badge">
                        <Check size={13} />
                      </span>
                    )}
                    <span className={`platform-logo ${platform.id}`}>{platform.logo}</span>
                    <strong>{platform.label}</strong>
                    <span>{platform.hint}</span>
                    <em>{platform.tagline}</em>
                  </button>
                ))}
              </div>
            </div>

            <div className="flow-panel">
              <div className="section-heading">
                <Sparkles size={16} />
                <span>参与流程</span>
                <Sparkles size={16} />
              </div>
              {activityConfig.steps.map((item, index) => (
                <div className="flow-step" key={item}>
                  <span className="flow-index">{index + 1}</span>
                  <div className="flow-icon">
                    {(() => {
                      const Icon = flowIcons[index] || Check;
                      return <Icon size={24} />;
                    })()}
                  </div>
                  <strong>{item}</strong>
                  <small>{flowDescriptions[index]}</small>
                </div>
              ))}
            </div>
          </section>
        )}

        {step === "generating" && (
          <section className="screen generating-screen">
            <div className="orbital-loader">
              <Loader2 size={44} />
            </div>
            <h2>正在准备你的分享草稿</h2>
            <p>通义千问正在结合{merchantProfile.name}的商家资料生成内容。</p>

            <div className="progress-card">
              {progressSteps.map((item, index) => (
                <div className={`progress-row ${index <= loadingIndex ? "active" : ""}`} key={item}>
                  <span>{index < loadingIndex ? <Check size={15} /> : index + 1}</span>
                  {item}
                </div>
              ))}
            </div>

            {error && (
              <div className="error-box">
                <strong>生成遇到问题</strong>
                <span>{error}</span>
                <button onClick={() => handleGenerate()}>重新生成</button>
              </div>
            )}
          </section>
        )}

        {step === "result" && draft && (
          <section className="screen result-screen">
            <button className="page-back-button" onClick={restartActivity}>
              <ArrowLeft size={18} />
              返回
            </button>

            <div className="preview-card">
              <img src={asset.url} alt={asset.title} />
              <div className="asset-caption">
                <span>{asset.title}</span>
                <div className="asset-actions">
                  <button onClick={() => void downloadCurrentAsset()}>
                    <Sparkles size={15} />
                    保存图片
                  </button>
                  <button onClick={switchAsset}>
                    <RefreshCw size={15} />
                    换一组
                  </button>
                </div>
              </div>
            </div>

            <article className="draft-card">
              <span className="eyebrow">打卡内容已生成</span>
              <h2>{platformPayload?.title}</h2>
              <p>{platformPayload?.body}</p>
              <div className="tag-list">
                {platformPayload?.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
              <div className="draft-meta">
                <span>案例：{merchantProfile.name}</span>
                <span>{asset.tone}</span>
              </div>
            </article>

            <div className="action-row">
              <button className="secondary-button" onClick={copyDraft}>
                <Clipboard className="action-main-icon" size={28} />
                <span>
                  <strong>{copied ? "文案已复制" : "复制文案"}</strong>
                  <small>文案会自动复制，进入平台后长按粘贴发布</small>
                </span>
                <ChevronRight className="action-arrow" size={18} />
              </button>
              <button className="secondary-button" onClick={() => handleGenerate()}>
                <Wand2 className="action-main-icon" size={28} />
                <span>
                  <strong>重新生成</strong>
                  <small>换一版内容，获得更多灵感</small>
                </span>
                <ChevronRight className="action-arrow" size={18} />
              </button>
            </div>

            {publishMessage && <div className="publish-message">{publishMessage}</div>}
          </section>
        )}

        {step === "publish" && draft && (
          <section className="screen publish-screen">
            <div className="publish-hero">
              {isAndroid ? <Send size={30} /> : <Share2 size={30} />}
              <h2>
                {sharePlatform === "dianping"
                  ? "同步到大众点评"
                  : sharePlatform === "meituan"
                    ? "同步到美团"
                  : isAndroid
                    ? "安卓系统分享发布"
                    : "手机端一键分享到小红书"}
              </h2>
              <p>
                {isReviewPlatform(sharePlatform)
                  ? `先复制评价文案并保存图片，再打开${getReviewPlatformName(sharePlatform)}搜索门店，由用户本人确认发布评价。`
                  : isAndroid
                    ? "优先调用手机系统分享，把图片交给小红书。若系统分享不可用，再保存图片并打开小红书相册发布。"
                    : "客户试用时请用手机打开活动页。优先使用系统分享；也可以直接尝试打开小红书 App 的发布入口。"}
              </p>
            </div>

            <div className="publish-steps">
              {isAndroid && (
                <button className="recommended-step" onClick={preparePublishMaterials}>
                  <Clipboard size={20} />
                  <span>
                    {copied
                      ? "文案和图片已准备"
                      : isReviewPlatform(sharePlatform)
                        ? "复制评价文案并保存图片"
                        : "复制文案并保存图片"}
                  </span>
                  <ChevronRight size={18} />
                </button>
              )}
              <button className={isAndroid ? "" : "recommended-step"} onClick={recommendedPublish}>
                <Send size={20} />
                <span>去发布</span>
                <ChevronRight size={18} />
              </button>
            </div>

            {publishMessage && <div className="publish-message">{publishMessage}</div>}
          </section>
        )}

        <footer className="bottom-cta">
          {step === "intro" && (
            <div className="intro-cta-stack">
              <button className="primary-button hero-start-button quick-start-button" onClick={startByEntryVariant}>
                {entryVariant === "qrcode-keyword" ? "开始分享打卡" : "立即生成文案"}
                <ChevronRight size={20} />
              </button>
              {entryVariant === "qrcode-keyword" && (
                <button className="custom-keyword-button" type="button" onClick={quickGenerate}>
                  不想选择关键词？直接生成
                </button>
              )}
            </div>
          )}
          {step === "result" && (
            <>
              <div className="publish-cta-tip">点击后会自动复制文案，并打开对应平台发布页面</div>
              <button className="primary-button publish-primary-button" onClick={oneTapCopyAndPublish}>
                <span>
                  <strong>一键复制并发布</strong>
                  <small>进入平台后长按粘贴文案，再确认发布</small>
                </span>
                <span className="publish-send-icon">
                  <Send size={24} />
                </span>
              </button>
            </>
          )}
        </footer>
      </div>

      <aside className="desktop-note">
        <strong>Mobile Web App Preview</strong>
        <span>请使用手机尺寸查看最佳体验。</span>
        <textarea
          readOnly
          value={
            platformPayload
              ? `${platformPayload.title}\n\n${platformPayload.body}\n\n${platformPayload.tags.map((tag) => `#${tag}`).join(" ")}`
              : "生成后这里会同步展示可复制文案。"
          }
        />
      </aside>
    </main>
  );
}



