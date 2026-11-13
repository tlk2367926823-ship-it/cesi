import { ArrowLeft, Check, CheckCircle2, ChevronRight, Clipboard, Download, ExternalLink, ImageOff, Loader2, RefreshCw, Send, Share2, Smartphone, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSourceLabel } from "./activityConfig";
import { AdminDashboard } from "./AdminDashboard";
import { getMerchantFromUrl, trackProductEntry, trackShareClick } from "./analytics";
import { clearShareState, loadSavedShareState, saveShareState } from "./localState";
import { defaultMerchantProfile, fetchMerchantProfile } from "./merchantProfile";
import { getMerchantAssets, selectAsset } from "./mockAssets";
import { CopyPublisher, DeeplinkPublisher, NativeSharePublisher, getFullShareText, openReviewAppFirst, prepareShareFiles } from "./publishers";
import { generateShareDraft } from "./qwen";
import { invokeXhsShare, prepareXhsShare, type XhsPreparation } from "./xhsShare";
import { createXhsMiniappHandoff, openXhsMiniapp } from "./xhsMiniapp";
import type { AppStep, KeywordSelection, MockAsset, PublishResult, ShareDraft, SharePlatform } from "./types";

const platforms: Array<{ id: SharePlatform; label: string; hint: string; logo: string }> = [
  { id: "redbook", label: "小红书", hint: "图文分享", logo: "小" },
  { id: "meituan", label: "美团", hint: "门店评价", logo: "美" },
  { id: "dianping", label: "大众点评", hint: "探店评价", logo: "评" },
];
const progressSteps = ["读取商家资料", "整理分享内容", "匹配商家素材"];
const platformName = (platform: SharePlatform) => platforms.find(item => item.id === platform)!.label;
type PublishMode = "recommended" | "official" | "native" | "manual";

export default function App() {
  const context = useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    const source = search.get("source") || search.get("entry") || "nfc";
    return {
      ...getMerchantFromUrl(),
      source,
      campaign: search.get("campaign") || "huizhi-share",
      isAdmin: search.get("admin") === "1" || window.location.pathname.replace(/\/$/, "").endsWith("/admin"),
      keywordEntry: !["off", "none", "quick"].includes((search.get("keyword") || search.get("mode") || "").toLowerCase()),
    };
  }, []);
  const scope = `${context.merchantId}:${context.campaign}`;
  const [step, setStep] = useState<AppStep>("intro");
  const [profile, setProfile] = useState(defaultMerchantProfile);
  const [profileState, setProfileState] = useState<"loading" | "ready" | "error">("loading");
  const [profileError, setProfileError] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);
  const [draft, setDraft] = useState<ShareDraft | null>(null);
  const [asset, setAsset] = useState<MockAsset>(getMerchantAssets(defaultMerchantProfile)[0]);
  const [assetCursor, setAssetCursor] = useState(0);
  const [platform, setPlatform] = useState<SharePlatform>("redbook");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [keywordOpen, setKeywordOpen] = useState(false);
  const [preferences, setPreferences] = useState<KeywordSelection>({ services: [], features: [], length: "简短自然" });
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [mediaState, setMediaState] = useState<"loading" | "ready" | "error">("loading");
  const [mediaError, setMediaError] = useState("");
  const [mediaRetry, setMediaRetry] = useState(0);
  const [xhs, setXhs] = useState<XhsPreparation | null>(null);
  const [xhsError, setXhsError] = useState("");
  const [xhsRetry, setXhsRetry] = useState(0);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishMode, setPublishMode] = useState<PublishMode | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const generationTimer = useRef<number>();
  const generationController = useRef<AbortController>();
  const generating = useRef(false);
  const publishLock = useRef(false);
  const downloadLock = useRef(false);
  const copyLock = useRef(false);
  const draftRevision = useRef(0);
  const operation = useRef(0);
  const publishTimer = useRef<number>();
  const publishController = useRef<AbortController>();
  const lastPublishMode = useRef<PublishMode | null>(null);
  const awaitingReturn = useRef(false);
  const mounted = useRef(true);
  const restored = useRef(false);
  const payload = draft ? { ...draft, assets: [asset.url] } : null;
  const assets = useMemo(() => getMerchantAssets(profile), [profile]);

  useEffect(() => {
    mounted.current = true;
    let leftPage = false;
    const onVisibility = () => {
      if (document.hidden) {
        leftPage = true;
        if (publishLock.current) awaitingReturn.current = true;
        return;
      }
      if (!leftPage) return;
      leftPage = false;
      if (!awaitingReturn.current) return;
      awaitingReturn.current = false;
      operation.current += 1;
      publishController.current?.abort();
      publishController.current = undefined;
      publishLock.current = false;
      setPublishBusy(false);
      setPublishMode(null);
      window.clearTimeout(publishTimer.current);
      const returnedMode = lastPublishMode.current;
      lastPublishMode.current = null;
      setMessage(returnedMode === "recommended"
        ? "已返回滔田 AI，草稿仍保留。是否发布成功请在小红书内确认。"
        : "已返回，草稿已保留。发布结果请在目标平台确认。");
    };
    const onPageHide = () => {
      leftPage = true;
      if (publishLock.current) awaitingReturn.current = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      mounted.current = false;
      generation.current += 1;
      window.clearInterval(generationTimer.current);
      generationController.current?.abort();
      operation.current += 1;
      publishController.current?.abort();
      window.clearTimeout(publishTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (context.isAdmin) return;
    const controller = new AbortController();
    setProfileState("loading");
    setProfileError("");
    fetchMerchantProfile({ merchantId: context.merchantId, signal: controller.signal })
      .then(next => {
        if (controller.signal.aborted) return;
        setProfile(next);
        setProfileState("ready");
        setPreferences({ services: [], features: [], length: next.lengthOptions[0] || "简短自然" });
        const saved = loadSavedShareState(scope);
        const currentAssets = getMerchantAssets(next);
        const savedAsset = currentAssets.find(item => item.url === saved.asset?.url);
        if (!restored.current && saved.draft && savedAsset && saved.platform) {
          draftRevision.current += 1;
          setDraft(saved.draft);
          setAsset(savedAsset);
          setPlatform(saved.platform);
          setStep("result");
          setMessage("已恢复上次草稿");
        } else if (!restored.current) {
          setAsset(currentAssets[0]);
        }
        restored.current = true;
        trackProductEntry(next.id, next.name);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setProfileState("error");
        setProfileError(err instanceof Error ? err.message : "商家资料加载失败");
      });
    return () => controller.abort();
  }, [context, profileRetry, scope]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (keywordOpen && !dialog.open) dialog.showModal();
    if (!keywordOpen && dialog.open) dialog.close();
  }, [keywordOpen]);

  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    let objectUrl = "";
    setFiles([]);
    setPreviewUrl("");
    setMediaState("loading");
    setMediaError("");
    prepareShareFiles([asset.url], controller.signal).then(next => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(next[0]);
      setPreviewUrl(objectUrl);
      setFiles(next);
      setMediaState("ready");
    }).catch(err => {
      if (controller.signal.aborted) return;
      setMediaState("error");
      setMediaError(err instanceof Error ? err.message : "图片读取失败");
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [draft, asset.url, mediaRetry]);

  useEffect(() => {
    if (!draft || platform !== "redbook" || profileState !== "ready") return;
    const controller = new AbortController();
    setXhs(null);
    setXhsError("");
    const timeout = window.setTimeout(() => controller.abort("timeout"), 15000);
    prepareXhsShare(profile.id, controller.signal).then(next => {
      if (!controller.signal.aborted) setXhs(next);
    }).catch(err => {
      if (!controller.signal.aborted || controller.signal.reason === "timeout") {
        setXhsError(err instanceof Error && err.name !== "AbortError" ? err.message : "小红书通道准备超时，可重试");
      }
    }).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [draft, platform, profile.id, profileState, xhsRetry]);

  function persist(nextDraft: ShareDraft, nextAsset: MockAsset) {
    const saved = saveShareState({ draft: nextDraft, asset: nextAsset, platform }, scope);
    setStorageNotice(saved ? "" : "浏览器未能保存草稿，请在离开前复制文案。");
  }

  async function handleGenerate(selection = preferences) {
    if (generating.current || profileState !== "ready") return;
    generating.current = true;
    draftRevision.current += 1;
    const id = ++generation.current;
    const controller = new AbortController();
    generationController.current = controller;
    setKeywordOpen(false);
    setStep("generating");
    setError("");
    setCopied(false);
    setMessage("");
    setLoadingIndex(0);
    const timer = window.setInterval(() => {
      if (mounted.current && generation.current === id) setLoadingIndex(index => Math.min(index + 1, progressSteps.length - 1));
    }, 800);
    generationTimer.current = timer;
    try {
      const generated = await generateShareDraft({ ...context, platform, profile, preferences: selection, signal: controller.signal });
      if (!mounted.current || generation.current !== id) return;
      const cursor = draft ? assetCursor + 1 : 0;
      const nextAsset = selectAsset(generated, cursor, profile);
      setDraft(generated);
      setAsset(nextAsset);
      setAssetCursor(cursor);
      persist(generated, nextAsset);
      setStep("result");
    } catch (err) {
      if (mounted.current && generation.current === id) setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      window.clearInterval(timer);
      if (generation.current === id) generating.current = false;
    }
  }

  function cancelGeneration() {
    generation.current += 1;
    generationController.current?.abort();
    window.clearInterval(generationTimer.current);
    generating.current = false;
    setStep(draft ? "result" : "intro");
    setError("");
  }

  function toggleKeyword(group: "services" | "features", value: string) {
    setPreferences(current => {
      const exists = current[group].includes(value);
      if (!exists && current.services.length + current.features.length >= 4) return current;
      return { ...current, [group]: exists ? current[group].filter(item => item !== value) : [...current[group], value] };
    });
  }

  async function copyDraft() {
    if (!payload || copyLock.current) return;
    copyLock.current = true;
    const revision = draftRevision.current;
    try {
      const result = await new CopyPublisher().publish(payload);
      if (!mounted.current || draftRevision.current !== revision) return;
      setCopied(result.success);
      setMessage(result.message || "");
    } finally {
      copyLock.current = false;
    }
  }

  async function downloadAsset() {
    if (downloadLock.current || mediaState !== "ready" || !files[0]) return;
    downloadLock.current = true;
    setDownloadBusy(true);
    const url = URL.createObjectURL(files[0]);
    const link = document.createElement("a");
    try {
      link.href = url;
      link.download = files[0].name;
      document.body.appendChild(link);
      link.click();
      setMessage("已发起图片下载，请检查手机保存结果。");
    } catch {
      setMessage("图片下载未完成，可长按图片保存。");
    } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      downloadLock.current = false;
      setDownloadBusy(false);
    }
  }

  function switchAsset() {
    if (!draft || publishLock.current) return;
    const cursor = assetCursor + 1;
    const next = selectAsset(draft, cursor, profile);
    setAssetCursor(cursor);
    setAsset(next);
    setMessage("");
    persist(draft, next);
  }

  async function publish(mode: PublishMode = "recommended") {
    if (!payload || publishLock.current) return;
    publishLock.current = true;
    setPublishBusy(true);
    setPublishMode(mode);
    lastPublishMode.current = mode;
    const id = ++operation.current;
    const current = () => mounted.current && operation.current === id;
    const controller = new AbortController();
    publishController.current?.abort();
    publishController.current = controller;
    setMessage("");
    publishTimer.current = window.setTimeout(() => {
      if (!current()) return;
      controller.abort("timeout");
      operation.current += 1;
      publishController.current = undefined;
      publishLock.current = false;
      setPublishBusy(false);
      setPublishMode(null);
      setMessage(mode === "recommended"
        ? "连接小红书超时，草稿已保留。请检查网络后重试。"
        : "尚未收到分享结果，草稿已保留。关闭分享窗口后可重试。");
    }, 30000);
    let awaitingOfficial = false;
    try {
      let result: PublishResult;
      if (platform !== "redbook") {
        await openReviewAppFirst(platform, platform === "meituan" ? profile.meituanUrl : profile.dianpingUrl);
        result = { success: true, mode: "deeplink", outcome: "requested", message: `已请求打开${platformName(platform)}门店链接，尚未确认发布` };
      } else if (mode === "manual") {
        result = await new DeeplinkPublisher("home").publish(payload);
      } else if (mode === "recommended") {
        const handoff = await createXhsMiniappHandoff({
          merchantId: profile.id,
          source: context.source,
          payload,
          signal: controller.signal,
        });
        result = {
          success: true,
          mode: "api",
          outcome: "requested",
          message: "内容已交给小红书小程序，最终发布仍需你确认。",
        };
        openXhsMiniapp(handoff.launchUrl);
      } else if (mode === "official" && xhs?.enabled) {
        if (!copied) throw new Error("文案尚未复制");
        if (Date.now() >= (xhs.validUntil || 0)) {
          setXhsRetry(value => value + 1);
          throw new Error("正在更新官方通道，请准备完成后再次点击分享");
        }
        let failedSynchronously = false;
        invokeXhsShare(payload, xhs, () => {
          failedSynchronously = true;
          if (current()) {
            setMessage("小红书官方分享未完成，可重试或主动选择备用方式。");
            publishLock.current = false;
            setPublishBusy(false);
            setPublishMode(null);
            window.clearTimeout(publishTimer.current);
          }
        });
        if (failedSynchronously) return;
        awaitingOfficial = true;
        result = { success: true, mode: "api", outcome: "requested", message: "已请求小红书官方分享，正文请粘贴已复制的文案；最终发布仍需你确认。" };
      } else {
        result = await new NativeSharePublisher(files).publish(payload);
      }
      if (!current()) return;
      setMessage(result.message || "");
      if (result.success) trackShareClick(profile.id, profile.name, platform);
    } catch (err) {
      if (current() && !(err instanceof DOMException && err.name === "AbortError")) {
        setMessage(err instanceof Error ? err.message : "分享未完成，请重试");
      }
    } finally {
      if (current() && !awaitingOfficial) {
        window.clearTimeout(publishTimer.current);
        publishTimer.current = window.setTimeout(() => {
          if (!current()) return;
          publishController.current = undefined;
          publishLock.current = false;
          setPublishBusy(false);
          setPublishMode(null);
        }, 1000);
      }
    }
  }

  function restart() {
    draftRevision.current += 1;
    operation.current += 1;
    publishController.current?.abort();
    publishController.current = undefined;
    awaitingReturn.current = false;
    lastPublishMode.current = null;
    window.clearTimeout(publishTimer.current);
    publishLock.current = false;
    setPublishBusy(false);
    setPublishMode(null);
    clearShareState(scope);
    setDraft(null);
    setAsset(assets[0]);
    setAssetCursor(0);
    setCopied(false);
    setMessage("");
    setStep("intro");
  }

  if (context.isAdmin) return <AdminDashboard />;
  const mediaPreview = (
    <div className="preview-card">
      {mediaState === "error" ? (
        <div className="asset-error"><ImageOff size={32} /><span>{mediaError}</span>
          <button onClick={() => setMediaRetry(value => value + 1)}><RefreshCw size={16} />重试图片</button>
        </div>
      ) : mediaState === "loading" || !previewUrl ? <div className="asset-error"><Loader2 className="spin" size={28} /><span>正在准备图片</span></div>
        : <img key={previewUrl} src={previewUrl} alt={asset.title}
        onError={() => { setMediaState("error"); setMediaError("图片显示失败，请重试或更换素材"); }} />}
      <div className="asset-caption"><span>{asset.title}</span><div className="asset-actions">
        <button title="保存图片" onClick={() => void downloadAsset()} disabled={mediaState !== "ready" || downloadBusy}><Download size={17} />保存</button>
        <button title="更换图片" onClick={switchAsset} disabled={assets.length < 2 || publishBusy}><RefreshCw size={17} />换图</button>
      </div></div>
    </div>
  );

  return (
    <main className="app-shell">
      <div className="phone-frame">
        <header className="topbar"><div><strong>滔田 AI</strong><span className="product-subtitle">商家分享工作台</span></div>
          <span className="source-pill">{getSourceLabel(context.source)}</span></header>
        {profileState !== "ready" ? (
          <section className="screen profile-status" role="status">
            {profileState === "loading" ? <><Loader2 className="spin" size={28} /><h2>正在读取商家资料</h2></> : <>
              <h2>商家资料暂不可用</h2><p>{profileError}</p>
              <button className="secondary-button" onClick={() => setProfileRetry(value => value + 1)}><RefreshCw size={18} />重新加载</button>
            </>}
          </section>
        ) : <>
          {step === "intro" && <section className="screen intro-screen">
            <div className="merchant-heading"><span className="eyebrow">{profile.industry}</span><h1>{profile.name}</h1><p>{profile.description}</p></div>
            {assets[0].id !== "merchant-assets-empty" && <div className="merchant-gallery">
              {assets.slice(0, 3).map(item => <img key={item.id} src={item.url} alt={item.title} />)}
            </div>}
            <div className="platform-panel platform-panel-home">
              <h2 className="section-heading">发布平台</h2>
              <div className="platform-toggle" role="group" aria-label="发布平台">{platforms.map(item =>
                <button key={item.id} aria-pressed={platform === item.id} className={platform === item.id ? "active" : ""} onClick={() => setPlatform(item.id)}>
                  <span className={`platform-logo ${item.id}`}>{item.logo}</span><strong>{item.label}</strong><span>{item.hint}</span>
                  {platform === item.id && <Check className="platform-check" size={16} />}
                </button>)}</div>
            </div>
            <div className="merchant-tags">{profile.sellingPoints.slice(0, 4).map(item => <span key={item}>{item}</span>)}</div>
          </section>}
          {step === "generating" && <section className="screen generating-screen">
            <Loader2 className="spin" size={36} /><h2>正在准备分享草稿</h2>
            <p>{profile.name}</p><div className="progress-card">{progressSteps.map((item, index) =>
              <div className={`progress-row ${index <= loadingIndex ? "active" : ""}`} key={item}><span>{index < loadingIndex ? <Check size={15} /> : index + 1}</span>{item}</div>
            )}</div>
            {error && <div className="error-box" role="alert"><strong>生成未完成</strong><span>{error}</span>
              <button onClick={() => void handleGenerate()}><RefreshCw size={16} />重试</button></div>}
            <button className="page-back-button" onClick={cancelGeneration}><ArrowLeft size={18} />{draft ? "返回草稿" : "返回"}</button>
          </section>}
          {step === "result" && draft && <section className="screen result-screen">
            <button className="page-back-button" onClick={restart}><ArrowLeft size={18} />重新选择</button>
            {mediaPreview}
            <article className="draft-card"><span className="eyebrow">{draft.generationSource === "template" ? "模板草稿 · 非 AI 生成" : "分享草稿"}</span>
              <h2>{draft.title}</h2><p>{draft.body}</p><div className="tag-list">{draft.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>
              <div className="draft-meta"><span>{profile.name}</span><span>{platformName(platform)}</span></div>
            </article>
            <div className="action-row">
              <button className="secondary-button" onClick={() => void copyDraft()}><Clipboard size={20} /><span>{copied ? "已复制文案" : "复制文案"}</span></button>
              <button className="secondary-button" onClick={() => void handleGenerate()}><Wand2 size={20} /><span>重新生成</span></button>
            </div>
          </section>}
          {step === "publish" && draft && <section className="screen publish-screen">
            <button className="page-back-button" disabled={publishBusy} onClick={() => setStep("result")}><ArrowLeft size={18} />返回草稿</button>
            <div className="publish-hero"><h2>分享到{platformName(platform)}</h2><p>{draft.title}</p></div>
            {mediaPreview}
            <div className="publish-controls">
              <button className="secondary-button" disabled={publishBusy} onClick={() => void copyDraft()}><Clipboard size={20} />{copied ? "完整文案已复制" : "复制完整文案"}</button>
              {platform === "redbook" && <section className="xhs-channel" aria-label="小红书发布状态">
                <div className="xhs-channel-heading">
                  <span className="xhs-channel-mark" aria-hidden="true">小</span>
                  <span><strong>小红书小程序</strong><small>图文草稿交接</small></span>
                </div>
                <div className="xhs-flow" role="status">
                  <span><CheckCircle2 size={18} /><span><strong>内容与图片</strong><small>已准备</small></span></span>
                  <span className={publishBusy && publishMode === "recommended" ? "active" : ""}><Smartphone size={18} /><span><strong>打开小程序</strong><small>{publishBusy && publishMode === "recommended" ? "正在连接" : "等待打开"}</small></span></span>
                  <span><Check size={18} /><span><strong>发布确认</strong><small>在小红书内完成</small></span></span>
                </div>
                <p>不会自动发布，最终内容和发布操作仍由你确认。</p>
              </section>}
              <button className="primary-button" disabled={publishBusy || (platform === "redbook" && mediaState !== "ready")}
                onClick={() => void publish()}>
                {publishBusy ? <Loader2 className="spin" size={20} /> : <Send size={20} />}
                {platform !== "redbook" ? `打开${platformName(platform)}门店`
                  : publishBusy ? (publishMode === "recommended" ? "正在连接小红书" : "正在处理分享") : "打开小红书小程序"}
              </button>
              {platform === "redbook" && <details className="fallback-panel">
                <summary>其他发布方式</summary>
                <div className="fallback-actions">
                  {xhs?.enabled && <button disabled={publishBusy || mediaState !== "ready" || !copied} onClick={() => void publish("official")}><Share2 size={17} /><span>网页官方分享</span></button>}
                  <button disabled={publishBusy || mediaState !== "ready"} onClick={() => void publish("native")}><Share2 size={17} /><span>打开系统分享</span></button>
                  <button disabled={publishBusy} onClick={() => void publish("manual")}><ExternalLink size={17} /><span>仅打开小红书</span></button>
                </div>
                {xhsError && <div className="xhs-channel-error">
                  <span>{xhsError}</span>
                  <button aria-label="重试网页官方分享" title="重试网页官方分享" onClick={() => setXhsRetry(value => value + 1)}><RefreshCw size={16} /></button>
                </div>}
              </details>}
            </div>
          </section>}
          {(message || storageNotice) && <div className="status-area" role="status" aria-live="polite">
            {message && <p className="publish-message">{message}</p>}{storageNotice && <p className="storage-notice">{storageNotice}</p>}
          </div>}
          {(step === "intro" || step === "result") && <footer className="bottom-cta">
            {step === "intro" ? <div className="intro-cta-stack">
              <button className="primary-button hero-start-button" onClick={() => context.keywordEntry ? setKeywordOpen(true) : void handleGenerate()}>
                <Wand2 size={20} />{context.keywordEntry ? "选择分享重点" : "生成分享草稿"}<ChevronRight size={18} />
              </button>
              {context.keywordEntry && <button className="custom-keyword-button" onClick={() => void handleGenerate()}>直接生成</button>}
            </div> : <button className="primary-button" onClick={() => { setMessage(""); setStep("publish"); }}><Send size={20} />准备分享到{platformName(platform)}<ChevronRight size={18} /></button>}
          </footer>}
        </>}
      </div>
      {draft && <aside className="desktop-note"><strong>{platformName(platform)}草稿</strong>
        <textarea aria-label="完整分享文案" readOnly value={getFullShareText({ ...draft, assets: [asset.url] })} />
      </aside>}
      <dialog className="keyword-modal-card" ref={dialogRef} onCancel={() => setKeywordOpen(false)} onClose={() => setKeywordOpen(false)} aria-labelledby="keyword-title">
        <button className="keyword-close" aria-label="关闭关键词选择" onClick={() => setKeywordOpen(false)}><X size={20} /></button>
        <h2 id="keyword-title">分享重点</h2>
        <div className="keyword-modal-scroll">
          {(["services", "features"] as const).map(group => <fieldset className="keyword-group" key={group}>
            <legend>{group === "services" ? "产品与服务" : "体验与特色"}</legend>
            <div className="keyword-chip-list">{(group === "services" ? profile.serviceKeywords : profile.featureKeywords).map(item =>
              <label key={item}><input type="checkbox" checked={preferences[group].includes(item)} onChange={() => toggleKeyword(group, item)}
                disabled={!preferences[group].includes(item) && preferences.services.length + preferences.features.length >= 4} /><span>{item}</span></label>
            )}</div>
          </fieldset>)}
          <fieldset className="keyword-group"><legend>文案长度</legend><div className="keyword-chip-list">{profile.lengthOptions.map(item =>
            <label key={item}><input type="radio" name="draft-length" checked={preferences.length === item} onChange={() => setPreferences(current => ({ ...current, length: item }))} /><span>{item}</span></label>
          )}</div></fieldset>
        </div>
        <div className="keyword-confirm-note">{preferences.services.length + preferences.features.length} / 4 个重点</div>
        <button className="primary-button keyword-confirm" onClick={() => void handleGenerate()}><Wand2 size={18} />生成分享草稿</button>
      </dialog>
    </main>
  );
}
