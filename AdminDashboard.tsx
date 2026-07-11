import { BarChart3, Building2, CalendarDays, Copy, ExternalLink, LogOut, Plus, RefreshCw, Send, Store, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { fetchAdminStats, getAdminStats, resetAdminStats, type MerchantStats } from "./analytics";
import { isSupabaseAuthConfigured, supabase, type AuthSession } from "./supabaseClient";

const MERCHANTS_ENDPOINT = "/.netlify/functions/merchants";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(value: string) {
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

function getMerchantActivityUrl(merchant: MerchantStats) {
  const url = new URL(window.location.origin);
  url.searchParams.set("source", "nfc");
  url.searchParams.set("merchantId", merchant.merchantId);
  url.searchParams.set("merchantName", merchant.merchantName);
  return url.toString();
}

export function AdminDashboard() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [snapshot, setSnapshot] = useState(() => getAdminStats());
  const [selectedMerchantId, setSelectedMerchantId] = useState(snapshot.merchants[0]?.merchantId || "");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [loading, setLoading] = useState(false);
  const [copiedMerchantId, setCopiedMerchantId] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [merchantIndustry, setMerchantIndustry] = useState("餐饮门店");
  const [merchantContactName, setMerchantContactName] = useState("");
  const [merchantContactPhone, setMerchantContactPhone] = useState("");
  const [creatingMerchant, setCreatingMerchant] = useState(false);
  const [createMessage, setCreateMessage] = useState("");

  const selectedMerchant = useMemo(
    () => snapshot.merchants.find((merchant) => merchant.merchantId === selectedMerchantId) || snapshot.merchants[0],
    [selectedMerchantId, snapshot.merchants],
  );

  const isAdminViewer = snapshot.viewer?.role === "admin";

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      if (!isSupabaseAuthConfigured || !supabase) {
        setCheckingAuth(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setSession(data.session);
        setCheckingAuth(false);
      }
    }

    void loadSession();

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
    setLoading(true);
    const nextSnapshot = await fetchAdminStats(date, session?.access_token);
    setSnapshot(nextSnapshot);
    if (!nextSnapshot.merchants.some((merchant) => merchant.merchantId === selectedMerchantId)) {
      setSelectedMerchantId(nextSnapshot.merchants[0]?.merchantId || "");
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!session) return;
    void loadStats(selectedDate);
  }, [selectedDate, session]);

  function refresh() {
    void loadStats(selectedDate);
  }

  function resetDemoData() {
    resetAdminStats();
    void loadStats(selectedDate);
  }

  async function copyMerchantLink(merchant: MerchantStats) {
    const link = getMerchantActivityUrl(merchant);
    await navigator.clipboard.writeText(link);
    setCopiedMerchantId(merchant.merchantId);
    window.setTimeout(() => setCopiedMerchantId(""), 1600);
  }

  async function createMerchant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateMessage("");

    if (!session?.access_token) {
      setCreateMessage("请先登录管理员账号。");
      return;
    }

    if (!merchantName.trim()) {
      setCreateMessage("请填写商家名称。");
      return;
    }

    setCreatingMerchant(true);
    try {
      const response = await fetch(MERCHANTS_ENDPOINT, {
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
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; merchant?: { id: string } };

      if (!response.ok || !result.ok) {
        setCreateMessage(result.message || "新增商家失败，请稍后再试。");
        return;
      }

      setCreateMessage("商家已创建，可以在商家列表复制专属链接。");
      setMerchantName("");
      setMerchantIndustry("餐饮门店");
      setMerchantContactName("");
      setMerchantContactPhone("");
      await loadStats(selectedDate);
      if (result.merchant?.id) setSelectedMerchantId(result.merchant.id);
    } catch {
      setCreateMessage("新增商家接口暂不可用，请检查 Netlify Functions。");
    } finally {
      setCreatingMerchant(false);
    }
  }

  async function logout() {
    if (supabase) {
      await supabase.auth.signOut();
    }
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

  if (!selectedMerchant) {
    return (
      <main className="admin-shell">
        <section className="admin-empty">暂无商家数据</section>
      </main>
    );
  }

  const statCards = [
    { label: "今日进入产品人数", value: selectedMerchant.todayEntries, icon: CalendarDays },
    { label: "累计进入产品人数", value: selectedMerchant.totalEntries, icon: Users },
    { label: "小红书分享次数", value: selectedMerchant.redbookShares, icon: Send },
    { label: "美团分享次数", value: selectedMerchant.meituanShares, icon: BarChart3 },
    { label: "大众点评分享次数", value: selectedMerchant.dianpingShares, icon: Building2 },
  ];

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
            <button onClick={refresh}>
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
            {createMessage && <div className="admin-create-message">{createMessage}</div>}
            <button type="submit" disabled={creatingMerchant}>
              <Plus size={17} />
              {creatingMerchant ? "创建中" : "创建商家"}
            </button>
          </form>
        )}

        <div className="admin-toolbar">
          <label>
            <span>选择日期</span>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          <label>
            <span>选择商家</span>
            <select value={selectedMerchant.merchantId} onChange={(event) => setSelectedMerchantId(event.target.value)}>
              {snapshot.merchants.map((merchant) => (
                <option key={merchant.merchantId} value={merchant.merchantId}>
                  {merchant.merchantName}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-updated">
            <strong>{snapshot.source === "cloud" ? "云端真实数据" : "本地演示数据"}</strong>
            <span>最近更新：{formatTime(selectedMerchant.updatedAt)}</span>
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
              </tr>
            </thead>
            <tbody>
              {snapshot.merchants.map((merchant) => {
                const merchantLink = getMerchantActivityUrl(merchant);
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
                        <button onClick={() => copyMerchantLink(merchant)}>
                          <Copy size={14} />
                          {copiedMerchantId === merchant.merchantId ? "已复制" : "复制链接"}
                        </button>
                        <a href={merchantLink} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          打开
                        </a>
                      </div>
                    </td>
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
