import {
  BarChart3,
  Building2,
  CalendarDays,
  Copy,
  ExternalLink,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Store,
  Trash2,
  UploadCloud,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { apiUrl } from "./api";
import { fetchAdminStats, getAdminStats, localDateKey, resetAdminStats, type AdminStatsSnapshot, type MerchantStats } from "./analytics";
import { fetchMerchantProfile, saveMerchantProfile } from "./merchantProfile";
import { isSupabaseAuthConfigured, supabase, type AuthSession } from "./supabaseClient";
import type { MerchantProfile } from "./types";

const MERCHANTS_ENDPOINT = "/.netlify/functions/merchants";
const MERCHANT_ASSET_BUCKET = "merchant-assets";

const todayKey = localDateKey;

function formatTime(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "暂无更新时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getTotalShares(merchant: MerchantStats) {
  return merchant.redbookShares + merchant.meituanShares + merchant.dianpingShares;
}

function generateMerchantPassword() {
  try {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return `Tt9!${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "";
  }
}

type MerchantLinkSource = "nfc" | "quickNfc" | "qrcode" | "quickQrcode";

function getMerchantActivityUrl(merchant: MerchantStats, source: MerchantLinkSource = "nfc") {
  const url = new URL(window.location.origin);
  const isQrSource = source === "qrcode" || source === "quickQrcode";
  const withoutKeywords = source === "quickQrcode" || source === "quickNfc";
  url.searchParams.set("source", isQrSource ? "qrcode" : "nfc");
  url.searchParams.set("entry", isQrSource ? "qr" : "nfc");
  url.searchParams.set("keyword", withoutKeywords ? "off" : "on");
  url.searchParams.set("merchantId", merchant.merchantId);
  url.searchParams.set("merchantName", merchant.merchantName);
  return url.toString();
}

function listToText(items: string[]) {
  return items.join("\n");
}

function textToList(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function AdminDashboard() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [snapshot, setSnapshot] = useState<AdminStatsSnapshot | null>(null);
  const [selectedMerchantId, setSelectedMerchantId] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [loading, setLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [copiedMerchantId, setCopiedMerchantId] = useState("");
  const [deletingMerchantId, setDeletingMerchantId] = useState("");

  const [merchantName, setMerchantName] = useState("");
  const [merchantIndustry, setMerchantIndustry] = useState("餐饮门店");
  const [merchantContactName, setMerchantContactName] = useState("");
  const [merchantContactPhone, setMerchantContactPhone] = useState("");
  const [createMerchantAccount, setCreateMerchantAccount] = useState(true);
  const [merchantAccountEmail, setMerchantAccountEmail] = useState("");
  const [merchantAccountPassword, setMerchantAccountPassword] = useState(() => generateMerchantPassword());
  const [creatingMerchant, setCreatingMerchant] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createdAccount, setCreatedAccount] = useState<{
    merchantName: string;
    email: string;
    password: string;
    adminUrl: string;
  } | null>(null);

  const [profileForm, setProfileForm] = useState<MerchantProfile | null>(null);
  const [profileSellingPoints, setProfileSellingPoints] = useState("");
  const [profileImages, setProfileImages] = useState("");
  const [profileServiceKeywords, setProfileServiceKeywords] = useState("");
  const [profileFeatureKeywords, setProfileFeatureKeywords] = useState("");
  const [profileLengthOptions, setProfileLengthOptions] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState("");
  const statsRequestId = useRef(0);
  const profileRequestId = useRef(0);
  const profileAbort = useRef<AbortController | null>(null);
  const profileOperation = useRef(false);
  const activeSession = useRef(session?.access_token);
  activeSession.current = session?.access_token;

  const selectedMerchant = useMemo(
    () => snapshot?.merchants.find((merchant) => merchant.merchantId === selectedMerchantId) || snapshot?.merchants[0],
    [selectedMerchantId, snapshot?.merchants],
  );
  const activeMerchantId = useRef(selectedMerchant?.merchantId);
  activeMerchantId.current = selectedMerchant?.merchantId;

  const isAdminViewer = snapshot?.viewer?.role === "admin";
  const canManage = snapshot?.source === "cloud" && !statsError && !loading;
  const profileIsCurrent = Boolean(
    canManage && profileForm && profileForm.id === selectedMerchant?.merchantId && !loadingProfile && !profileLoadError,
  );

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      if (!isSupabaseAuthConfigured || !supabase) {
        setCheckingAuth(false);
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        if (mounted) setSession(data.session);
      } finally {
        if (mounted) setCheckingAuth(false);
      }
    }

    void loadSession().catch(() => undefined);

    if (!supabase) return undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function loadStats(date = selectedDate) {
    const requestId = ++statsRequestId.current;
    const token = session?.access_token;
    setLoading(true);
    setStatsError("");
    try {
      const nextSnapshot = await fetchAdminStats(date, token);
      if (requestId !== statsRequestId.current || token !== activeSession.current) return;
      setSnapshot(nextSnapshot);
      setSelectedMerchantId((current) =>
        nextSnapshot.merchants.some((merchant) => merchant.merchantId === current)
          ? current
          : nextSnapshot.merchants[0]?.merchantId || "",
      );
    } catch (error) {
      if (requestId !== statsRequestId.current || token !== activeSession.current) return;
      setStatsError(error instanceof Error ? error.message : "云端统计读取失败，请重试。");
    } finally {
      if (requestId === statsRequestId.current) setLoading(false);
    }
  }

  async function loadSelectedProfile(merchant?: MerchantStats) {
    profileAbort.current?.abort();
    const requestId = ++profileRequestId.current;
    const token = session?.access_token;
    setProfileForm(null);
    setProfileMessage("");
    setProfileLoadError("");
    if (!merchant || snapshot?.source !== "cloud" || !token) {
      setLoadingProfile(false);
      return;
    }
    const controller = new AbortController();
    profileAbort.current = controller;
    setLoadingProfile(true);
    try {
      const profile = await fetchMerchantProfile({
        merchantId: merchant.merchantId,
        merchantName: merchant.merchantName,
        signal: controller.signal,
        accessToken: token,
      });
      if (!isCurrentProfileRequest(requestId, merchant.merchantId, token)) return;
      applyProfile(profile);
    } catch (error) {
      if (!isCurrentProfileRequest(requestId, merchant.merchantId, token) || controller.signal.aborted) return;
      setProfileLoadError(error instanceof Error ? error.message : "商家资料读取失败，请重试。");
    } finally {
      if (requestId === profileRequestId.current) setLoadingProfile(false);
    }
  }

  function isCurrentProfileRequest(requestId: number, merchantId: string, token?: string) {
    return requestId === profileRequestId.current && merchantId === activeMerchantId.current && token === activeSession.current;
  }

  function applyProfile(profile: MerchantProfile) {
    setProfileForm(profile);
    setProfileSellingPoints(listToText(profile.sellingPoints));
    setProfileImages(listToText(profile.imageUrls));
    setProfileServiceKeywords(listToText(profile.serviceKeywords));
    setProfileFeatureKeywords(listToText(profile.featureKeywords));
    setProfileLengthOptions(listToText(profile.lengthOptions));
  }

  useEffect(() => {
    statsRequestId.current += 1;
    setSnapshot(null);
    setStatsError("");
    setProfileForm(null);
    setCreatedAccount(null);
  }, [session?.user.id]);

  useEffect(() => {
    if (!session) return;
    void loadStats(selectedDate);
  }, [selectedDate, session]);

  useEffect(() => {
    if (!session) return;
    void loadSelectedProfile(selectedMerchant);
    return () => {
      profileRequestId.current += 1;
      profileAbort.current?.abort();
    };
  }, [selectedMerchant?.merchantId, snapshot?.source, session]);

  useEffect(() => () => {
    statsRequestId.current += 1;
    profileRequestId.current += 1;
    profileAbort.current?.abort();
  }, []);

  function refresh() {
    void loadStats(selectedDate);
    void loadSelectedProfile(selectedMerchant);
  }

  function resetDemoData() {
    resetAdminStats();
    setSnapshot(getAdminStats());
  }

  function showDemoData() {
    statsRequestId.current += 1;
    setLoading(false);
    setSnapshot(getAdminStats());
  }

  async function copyMerchantLink(merchant: MerchantStats, source: MerchantLinkSource) {
    const link = getMerchantActivityUrl(merchant, source);
    await navigator.clipboard.writeText(link);
    setCopiedMerchantId(`${merchant.merchantId}-${source}`);
    window.setTimeout(() => setCopiedMerchantId(""), 1600);
  }

  async function createMerchant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateMessage("");
    if (!canManage || creatingMerchant) return;

    if (!session?.access_token) {
      setCreateMessage("请先登录管理员账号。");
      return;
    }

    if (!merchantName.trim()) {
      setCreateMessage("请填写商家名称。");
      return;
    }

    if (createMerchantAccount && !merchantAccountEmail.trim()) {
      setCreateMessage("请填写商家登录邮箱。");
      return;
    }

    if (createMerchantAccount && merchantAccountPassword.trim().length < 6) {
      setCreateMessage("初始密码至少需要 6 位。");
      return;
    }

    setCreatingMerchant(true);
    try {
      const response = await fetch(apiUrl(MERCHANTS_ENDPOINT), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: merchantName,
          industry: merchantIndustry,
          contactName: merchantContactName,
          contactPhone: merchantContactPhone,
          createAccount: createMerchantAccount,
          accountEmail: merchantAccountEmail,
          accountPassword: merchantAccountPassword,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        merchant?: { id: string; name?: string };
        account?: { email: string; password: string } | null;
      };

      if (!response.ok || !result.ok) {
        setCreateMessage(result.message || "新增商家失败，请稍后再试。");
        return;
      }

      setCreateMessage(result.account ? "商家和登录账号已创建，请把弹窗里的账号发给商家。" : "商家已创建，可以继续填写下方商家资料。");
      if (result.account) {
        setCreatedAccount({
          merchantName: result.merchant?.name || merchantName,
          email: result.account.email,
          password: result.account.password,
          adminUrl: `${window.location.origin}/?admin=1`,
        });
      }
      setMerchantName("");
      setMerchantIndustry("餐饮门店");
      setMerchantContactName("");
      setMerchantContactPhone("");
      setMerchantAccountEmail("");
      setMerchantAccountPassword(generateMerchantPassword());
      await loadStats(selectedDate);
      if (result.merchant?.id) setSelectedMerchantId(result.merchant.id);
    } catch {
      setCreateMessage("新增商家接口暂不可用，请检查 Netlify Functions。");
    } finally {
      setCreatingMerchant(false);
    }
  }

  async function deleteMerchant(merchant: MerchantStats) {
    if (!canManage || deletingMerchantId) return;
    if (!session?.access_token) {
      window.alert("请先登录管理员账号。");
      return;
    }

    const confirmed = window.confirm(`确定删除「${merchant.merchantName}」吗？\n\n系统会先停用这个商家，历史统计会保留。`);
    if (!confirmed) return;

    setDeletingMerchantId(merchant.merchantId);
    try {
      const response = await fetch(apiUrl(`${MERCHANTS_ENDPOINT}?merchantId=${encodeURIComponent(merchant.merchantId)}`), {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };

      if (!response.ok || !result.ok) {
        window.alert(result.message || "删除商家失败，请稍后再试。");
        return;
      }

      setProfileForm(null);
      setProfileMessage("");
      await loadStats(selectedDate);
    } catch {
      window.alert("删除接口暂时不可用，请检查 Netlify Functions 是否已部署。");
    } finally {
      setDeletingMerchantId("");
    }
  }

  async function copyCreatedAccount() {
    if (!createdAccount) return;
    const text = [
      `${createdAccount.merchantName} 商家后台账号`,
      `后台链接：${createdAccount.adminUrl}`,
      `账号：${createdAccount.email}`,
      `初始密码：${createdAccount.password}`,
      "登录后可以查看数据、修改商家介绍、卖点关键词和图片素材。",
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCreateMessage("商家账号信息已复制，可以直接发给商家。");
  }

  async function updateProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileForm || !session?.access_token || !profileIsCurrent || profileOperation.current) return;

    const requestId = profileRequestId.current;
    const merchantId = profileForm.id;
    const token = session.access_token;
    profileOperation.current = true;
    setSavingProfile(true);
    setProfileMessage("");
    try {
      const saved = await saveMerchantProfile(
        {
          ...profileForm,
          sellingPoints: textToList(profileSellingPoints),
          imageUrls: textToList(profileImages).map((url) =>
            url.startsWith("/") && !url.startsWith("//") ? new URL(url, window.location.origin).href : url,
          ),
          serviceKeywords: textToList(profileServiceKeywords),
          featureKeywords: textToList(profileFeatureKeywords),
          lengthOptions: textToList(profileLengthOptions),
        },
        session.access_token,
      );
      if (!isCurrentProfileRequest(requestId, merchantId, token)) return;
      applyProfile(saved);
      setProfileMessage("商家资料已保存，专属链接会自动使用这些内容。");
      await loadStats(selectedDate);
    } catch (error) {
      if (isCurrentProfileRequest(requestId, merchantId, token)) {
        setProfileMessage(error instanceof Error ? error.message : "保存失败，请稍后重试。");
      }
    } finally {
      profileOperation.current = false;
      setSavingProfile(false);
    }
  }

  async function uploadMerchantImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profileForm || !session?.access_token || !supabase || !profileIsCurrent || profileOperation.current) return;

    if (!file.type.startsWith("image/")) {
      setProfileMessage("请上传 JPG、PNG 或 WebP 图片。");
      return;
    }

    const requestId = profileRequestId.current;
    const merchantId = profileForm.id;
    const token = session.access_token;
    profileOperation.current = true;
    setUploadingImage(true);
    setProfileMessage("");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const safeName = file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w-]+/g, "-")
        .slice(0, 48);
      const filePath = `${profileForm.id}/${Date.now()}-${safeName || "merchant-photo"}.${extension}`;

      const { error } = await supabase.storage.from(MERCHANT_ASSET_BUCKET).upload(filePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });

      if (error) throw error;
      if (!isCurrentProfileRequest(requestId, merchantId, token)) return;

      const { data } = supabase.storage.from(MERCHANT_ASSET_BUCKET).getPublicUrl(filePath);
      const publicUrl = data.publicUrl;
      const nextImages = textToList(profileImages);
      if (!nextImages.includes(publicUrl)) nextImages.push(publicUrl);

      setProfileImages(listToText(nextImages));
      setProfileForm({ ...profileForm, imageUrls: nextImages });
      setProfileMessage("图片已上传，请点击“保存商家资料”让前端正式使用这张图片。");
    } catch (error) {
      if (isCurrentProfileRequest(requestId, merchantId, token)) {
        setProfileMessage(error instanceof Error ? `图片上传失败：${error.message}` : "图片上传失败，请检查 Supabase Storage 配置。");
      }
    } finally {
      profileOperation.current = false;
      setUploadingImage(false);
    }
  }

  async function logout() {
    if (supabase) {
      await supabase.auth.signOut();
    }
    statsRequestId.current += 1;
    profileRequestId.current += 1;
    profileAbort.current?.abort();
    setSnapshot(null);
    setProfileForm(null);
    setSession(null);
  }

  if (checkingAuth) {
    return (
      <main className="admin-shell">
        <section className="admin-empty">正在检查登录状态...</section>
      </main>
    );
  }

  if (!session) {
    return <AdminLogin onLogin={() => undefined} />;
  }

  if (!snapshot) {
    return (
      <main className="admin-shell">
        <section className="admin-empty" role={statsError ? "alert" : "status"}>
          <p>{statsError || "正在读取云端统计..."}</p>
          {statsError && (
            <div className="admin-actions">
              <button onClick={() => void loadStats()} disabled={loading}><RefreshCw size={16} />重新读取</button>
              <button onClick={showDemoData}>查看本地演示</button>
              <button onClick={logout}><LogOut size={16} />退出</button>
            </div>
          )}
        </section>
      </main>
    );
  }

  const statCards = selectedMerchant ? [
    { label: "今日进入产品人数", value: selectedMerchant.todayEntries, icon: CalendarDays },
    { label: "累计进入产品人数", value: selectedMerchant.totalEntries, icon: Users },
    { label: "小红书分享次数", value: selectedMerchant.redbookShares, icon: Send },
    { label: "美团分享次数", value: selectedMerchant.meituanShares, icon: BarChart3 },
    { label: "大众点评分享次数", value: selectedMerchant.dianpingShares, icon: Building2 },
  ] : [];

  return (
    <main className="admin-shell">
      <section className="admin-card">
        <div className="admin-header">
          <div>
            <span>{isAdminViewer ? "平台管理员后台" : "商家后台"} · 第一版</span>
            <h1>产品使用情况</h1>
            <p>查看真实进入人数、平台分享流程点击次数，并为每个商家生成专属 NFC / 二维码活动链接。</p>
          </div>
          <div className="admin-actions">
            <button onClick={refresh} disabled={loading || savingProfile || uploadingImage}>
              <RefreshCw size={16} />
              {loading ? "读取中" : "刷新"}
            </button>
            {snapshot.source === "local" && <button onClick={resetDemoData}>重置演示数据</button>}
            <button onClick={logout}>
              <LogOut size={16} />
              退出
            </button>
          </div>
        </div>

        {statsError && (
          <div className="admin-create-message" role="alert">
            {statsError}
            {snapshot.source === "cloud" ? ` 当前保留的是 ${snapshot.date} 的上次读取结果，尚未更新。` : " 当前为本地演示，不代表云端经营数据。"}
          </div>
        )}
        {snapshot.source === "local" && (
          <div className="admin-create-message" role="status">本地演示数据，仅保存在当前浏览器；商家资料不可编辑。</div>
        )}

        <div className="admin-user-strip">
          <strong>当前登录账号</strong>
          <span>{session.user.email || session.user.id}</span>
          <em>{isAdminViewer ? "管理员：可查看全部商家" : "商家账号：仅查看自己的数据"}</em>
        </div>

        {isAdminViewer && (
          <form className="admin-create-merchant" onSubmit={createMerchant}>
            <div className="admin-create-title">
              <Store size={20} />
              <div>
                <strong>新增商家</strong>
                <span>创建后会自动生成这个商家的专属 NFC / 二维码入口链接。</span>
              </div>
            </div>
            <div className="admin-create-grid">
              <label>
                <span>商家名称</span>
                <input value={merchantName} onChange={(event) => setMerchantName(event.target.value)} placeholder="例如：某某火锅店" />
              </label>
              <label>
                <span>行业类型</span>
                <input value={merchantIndustry} onChange={(event) => setMerchantIndustry(event.target.value)} placeholder="例如：餐饮门店" />
              </label>
              <label>
                <span>联系人</span>
                <input value={merchantContactName} onChange={(event) => setMerchantContactName(event.target.value)} placeholder="可选" />
              </label>
              <label>
                <span>联系电话</span>
                <input value={merchantContactPhone} onChange={(event) => setMerchantContactPhone(event.target.value)} placeholder="可选" />
              </label>
            </div>
            <div className="admin-account-panel">
              <label className="admin-account-toggle">
                <input
                  type="checkbox"
                  checked={createMerchantAccount}
                  onChange={(event) => setCreateMerchantAccount(event.target.checked)}
                />
                <span>同时创建商家后台登录账号</span>
              </label>
              <div className="admin-create-grid">
                <label>
                  <span>商家登录邮箱</span>
                  <input
                    value={merchantAccountEmail}
                    onChange={(event) => setMerchantAccountEmail(event.target.value)}
                    placeholder="例如：store@example.com"
                    type="email"
                    disabled={!createMerchantAccount}
                  />
                </label>
                <label>
                  <span>初始密码</span>
                  <input
                    value={merchantAccountPassword}
                    onChange={(event) => setMerchantAccountPassword(event.target.value)}
                    placeholder="至少 6 位"
                    disabled={!createMerchantAccount}
                  />
                </label>
                <button type="button" className="admin-secondary-button" onClick={() => {
                  const password = generateMerchantPassword();
                  setMerchantAccountPassword(password);
                  if (!password) setCreateMessage("浏览器无法安全生成密码，请手动填写初始密码。");
                }} disabled={!createMerchantAccount}>
                  生成密码
                </button>
              </div>
            </div>
            {createMessage && <div className="admin-create-message">{createMessage}</div>}
            <button type="submit" disabled={creatingMerchant || !canManage}>
              <Plus size={17} />
              {creatingMerchant ? "创建中" : "创建商家"}
            </button>
          </form>
        )}

        <div className="admin-toolbar">
          <label>
            <span>选择日期</span>
            <input type="date" value={snapshot.source === "local" ? snapshot.date : selectedDate} onChange={(event) => setSelectedDate(event.target.value)} disabled={snapshot.source === "local"} />
          </label>
          <label>
            <span>选择商家</span>
            <select value={selectedMerchant?.merchantId || ""} onChange={(event) => setSelectedMerchantId(event.target.value)} disabled={!selectedMerchant || loading}>
              {snapshot.merchants.map((merchant) => (
                <option key={merchant.merchantId} value={merchant.merchantId}>
                  {merchant.merchantName}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-updated">
            <strong>{snapshot.source === "cloud" ? statsError ? "云端数据未更新" : "云端真实数据" : "本地演示数据"}</strong>
            <span>统计日期：{snapshot.date} · 最近更新：{formatTime(selectedMerchant?.updatedAt || snapshot.generatedAt)}</span>
          </div>
        </div>

        <div className="admin-grid">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <article className="admin-stat-card" key={card.label}>
                <div className="admin-stat-icon">
                  <Icon size={22} />
                </div>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </article>
            );
          })}
        </div>

        {!selectedMerchant && <div className="admin-empty">暂无商家数据{isAdminViewer ? "，可在上方创建商家。" : "，请联系管理员检查商家绑定。"}</div>}

        {selectedMerchant && <>
        <div className="admin-summary">
          <div>
            <span>当前商家</span>
            <strong>{selectedMerchant.merchantName}</strong>
          </div>
          <div>
            <span>平台分享合计</span>
            <strong>{getTotalShares(selectedMerchant)}</strong>
          </div>
          <div>
            <span>商家 ID</span>
            <strong>{selectedMerchant.merchantId}</strong>
          </div>
        </div>

        <div className="admin-product-note">
          <strong>产品数据口径</strong>
          <span>当前统计的是用户进入页面和点击发布流程的次数，不等于平台内最终发布成功次数。</span>
          <span>NFC / 二维码可分别生成“有关键词”和“快速生成”两种入口，用于不同试用场景。</span>
        </div>

        <div className="admin-section-title">
          <div>
            <strong>商家资料配置</strong>
            <span>这些内容会用于前端页面、AI 文案生成、图片展示和平台跳转。</span>
          </div>
        </div>

        <form className="admin-profile-form" onSubmit={updateProfile}>
          <div className="admin-create-title">
            <Settings2 size={20} />
            <div>
              <strong>{loadingProfile ? "正在读取商家资料" : profileForm?.name || selectedMerchant.merchantName}</strong>
              <span>建议每个商家至少填写介绍、卖点、图片和美团/大众点评链接。</span>
            </div>
          </div>

          {profileLoadError && (
            <div className="admin-create-message" role="alert">
              <p>{profileLoadError} 读取成功前不能保存。</p>
              <button type="button" onClick={() => void loadSelectedProfile(selectedMerchant)} disabled={loadingProfile}>
                <RefreshCw size={16} />重新读取资料
              </button>
            </div>
          )}
          {profileMessage && <div className="admin-create-message" role="status">{profileMessage}</div>}
          {snapshot.source === "local" && <p>本地演示不提供商家资料编辑。</p>}

          {profileForm && profileForm.id === selectedMerchant.merchantId && (
            <fieldset disabled={!profileIsCurrent || savingProfile || uploadingImage} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <div className={`admin-profile-grid ${isAdminViewer ? "" : "admin-profile-grid-merchant"}`}>
                <label>
                  <span>商家名称</span>
                  <input value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} />
                </label>
                <label>
                  <span>行业类型</span>
                  <input value={profileForm.industry} onChange={(event) => setProfileForm({ ...profileForm, industry: event.target.value })} />
                </label>
                <label>
                  <span>地址 / 城市</span>
                  <input value={profileForm.address || ""} onChange={(event) => setProfileForm({ ...profileForm, address: event.target.value })} />
                </label>
                <label>
                  <span>联系人</span>
                  <input
                    value={profileForm.contactName || ""}
                    onChange={(event) => setProfileForm({ ...profileForm, contactName: event.target.value })}
                  />
                </label>
                <label>
                  <span>联系电话</span>
                  <input
                    value={profileForm.contactPhone || ""}
                    onChange={(event) => setProfileForm({ ...profileForm, contactPhone: event.target.value })}
                  />
                </label>
                <label>
                  <span>小红书链接</span>
                  <input
                    value={profileForm.xiaohongshuUrl || ""}
                    disabled={!isAdminViewer}
                    onChange={(event) => setProfileForm({ ...profileForm, xiaohongshuUrl: event.target.value })}
                    placeholder="https://www.xiaohongshu.com/..."
                  />
                </label>
                <label>
                  <span>美团链接</span>
                  <input
                    value={profileForm.meituanUrl || ""}
                    disabled={!isAdminViewer}
                    onChange={(event) => setProfileForm({ ...profileForm, meituanUrl: event.target.value })}
                    placeholder="美团 App 分享出来的门店链接"
                  />
                </label>
                <label>
                  <span>大众点评链接</span>
                  <input
                    value={profileForm.dianpingUrl || ""}
                    disabled={!isAdminViewer}
                    onChange={(event) => setProfileForm({ ...profileForm, dianpingUrl: event.target.value })}
                    placeholder="大众点评 App 分享出来的门店链接"
                  />
                </label>
              </div>

              <div className="admin-profile-guide-row">
                <div className="admin-profile-guide-fields">
                  <label className="admin-wide-field">
                    <span>商家介绍</span>
                    <textarea
                      value={profileForm.description || ""}
                      onChange={(event) => setProfileForm({ ...profileForm, description: event.target.value })}
                      placeholder="例如：一家适合朋友聚餐的重庆火锅店，锅底香、服务热情、位置方便。"
                    />
                  </label>

                  <label className="admin-wide-field">
                    <span>核心卖点（一行一个）</span>
                    <textarea
                      value={profileSellingPoints}
                      onChange={(event) => setProfileSellingPoints(event.target.value)}
                      placeholder={"锅底香\n服务热情\n适合朋友聚餐\n位置方便"}
                    />
                  </label>
                </div>

                <aside className="admin-field-helper">
                  <strong>怎么填写更容易出好文案？</strong>
                  <p>
                    商家介绍写“你是谁、适合谁来”；核心卖点写“最希望顾客帮你传播的 3 个点”。
                  </p>
                  <div>
                    <span>推荐格式</span>
                    <em>介绍：我们是一家适合朋友聚餐的火锅店。</em>
                    <em>卖点：锅底香 / 服务热情 / 性价比高</em>
                  </div>
                </aside>
              </div>

              <label className="admin-wide-field">
                <span>图片素材地址（一行一个）</span>
                <textarea
                  value={profileImages}
                  onChange={(event) => setProfileImages(event.target.value)}
                  placeholder={"/mock-assets/huizhi-car-yard-01.jpg\nhttps://example.com/shop-photo.jpg"}
                />
              </label>

              <div className="admin-upload-panel">
                <div>
                  <strong>上传商家图片</strong>
                  <span>上传成功后会自动添加到上面的图片列表，保存资料后前端会使用这些图片。</span>
                </div>
                <label className="admin-upload-button">
                  <UploadCloud size={17} />
                  {uploadingImage ? "上传中..." : "选择图片上传"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadMerchantImage} disabled={uploadingImage || savingProfile || !profileIsCurrent} />
                </label>
              </div>

              <label className="admin-wide-field">
                <span>产品 / 服务关键词（一行一个）</span>
                <textarea
                  value={profileServiceKeywords}
                  onChange={(event) => setProfileServiceKeywords(event.target.value)}
                  placeholder={"招牌套餐\n特色服务\n明星员工\n高频咨询项目"}
                />
              </label>

              <label className="admin-wide-field">
                <span>特色 / 宣传点关键词（一行一个）</span>
                <textarea
                  value={profileFeatureKeywords}
                  onChange={(event) => setProfileFeatureKeywords(event.target.value)}
                  placeholder={"服务热情\n环境舒服\n价格透明\n本地口碑好"}
                />
              </label>

              <label className="admin-wide-field">
                <span>文案长度选项（一行一个）</span>
                <textarea
                  value={profileLengthOptions}
                  onChange={(event) => setProfileLengthOptions(event.target.value)}
                  placeholder={"简短自然\n详细一点\n种草感强"}
                />
              </label>

              <label className="admin-wide-field">
                <span>AI 生成要求</span>
                <textarea
                  value={profileForm.promptProfile || ""}
                  onChange={(event) => setProfileForm({ ...profileForm, promptProfile: event.target.value })}
                  placeholder="例如：文案要像真实顾客体验，不要太广告，重点写服务、环境和适合人群。"
                />
              </label>

              <button className="admin-save-profile" type="submit" disabled={savingProfile || uploadingImage || !profileIsCurrent}>
                <Save size={17} />
                {savingProfile ? "保存中" : "保存商家资料"}
              </button>
            </fieldset>
          )}
        </form>
        </>}

        <div className="admin-section-title">
          <div>
            <strong>商家列表</strong>
            <span>{isAdminViewer ? "管理员可复制每个商家的专属活动链接" : "这是当前商家的专属活动链接"}</span>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>商家</th>
                <th>今日进入</th>
                <th>累计进入</th>
                <th>小红书</th>
                <th>美团</th>
                <th>大众点评</th>
                <th>专属活动链接</th>
                {isAdminViewer && <th>{"\u7ba1\u7406"}</th>}
              </tr>
            </thead>
            <tbody>
              {snapshot.merchants.map((merchant) => {
                const nfcLink = getMerchantActivityUrl(merchant, "nfc");
                const quickNfcLink = getMerchantActivityUrl(merchant, "quickNfc");
                const qrLink = getMerchantActivityUrl(merchant, "qrcode");
                const quickQrLink = getMerchantActivityUrl(merchant, "quickQrcode");
                return (
                  <tr key={merchant.merchantId}>
                    <td>{merchant.merchantName}</td>
                    <td>{merchant.todayEntries}</td>
                    <td>{merchant.totalEntries}</td>
                    <td>{merchant.redbookShares}</td>
                    <td>{merchant.meituanShares}</td>
                    <td>{merchant.dianpingShares}</td>
                    <td>
                      <div className="admin-link-actions">
                        <button type="button" onClick={() => copyMerchantLink(merchant, "qrcode")}>
                          <Copy size={14} />
                          {copiedMerchantId === `${merchant.merchantId}-qrcode` ? "已复制" : "有关键词二维码"}
                        </button>
                        <button type="button" onClick={() => copyMerchantLink(merchant, "quickQrcode")}>
                          <Copy size={14} />
                          {copiedMerchantId === `${merchant.merchantId}-quickQrcode` ? "\u5df2\u590d\u5236" : "\u65e0\u5173\u952e\u8bcd\u4e8c\u7ef4\u7801"}
                        </button>
                        <button onClick={() => copyMerchantLink(merchant, "nfc")}>
                          <Copy size={14} />
                          {copiedMerchantId === `${merchant.merchantId}-nfc` ? "已复制" : "NFC链接"}
                        </button>
                        <button onClick={() => copyMerchantLink(merchant, "quickNfc")}>
                          <Copy size={14} />
                          {copiedMerchantId === `${merchant.merchantId}-quickNfc` ? "已复制" : "无关键词NFC"}
                        </button>
                        <a href={nfcLink} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          打开NFC
                        </a>
                        <a href={quickNfcLink} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          打开无关键词NFC
                        </a>
                        <a href={qrLink} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          打开有关键词
                        </a>
                        <a href={quickQrLink} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          {"\u6253\u5f00\u65e0\u5173\u952e\u8bcd"}
                        </a>
                      </div>
                    </td>
                    {isAdminViewer && (
                      <td>
                        <button
                          type="button"
                          className="admin-delete-merchant"
                          disabled={deletingMerchantId === merchant.merchantId || !canManage}
                          onClick={() => deleteMerchant(merchant)}
                        >
                          <Trash2 size={14} />
                          {deletingMerchantId === merchant.merchantId ? "停用中" : "停用"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
