import { BarChart3, Building2, CalendarDays, LogOut, RefreshCw, Send, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { fetchAdminStats, getAdminStats, resetAdminStats, type MerchantStats } from "./analytics";
import { isSupabaseAuthConfigured, supabase, type AuthSession } from "./supabaseClient";

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

export function AdminDashboard() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [snapshot, setSnapshot] = useState(() => getAdminStats());
  const [selectedMerchantId, setSelectedMerchantId] = useState(snapshot.merchants[0]?.merchantId || "");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [loading, setLoading] = useState(false);

  const selectedMerchant = useMemo(
    () => snapshot.merchants.find((merchant) => merchant.merchantId === selectedMerchantId) || snapshot.merchants[0],
    [selectedMerchantId, snapshot.merchants],
  );

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
            <span>商家后台 · 第一版</span>
            <h1>产品使用情况</h1>
            <p>按商家和日期查看真实进入人数、平台分享流程点击次数。当前版本先用于 MVP 数据验证。</p>
          </div>
          <div className="admin-actions">
            <button onClick={refresh}>
              <RefreshCw size={16} />
              {loading ? "读取中" : "刷新"}
            </button>
            <button onClick={resetDemoData}>重置演示数据</button>
            <button onClick={logout}>
              <LogOut size={16} />
              退出
            </button>
          </div>
        </div>

        <div className="admin-user-strip">
          <strong>当前登录账号</strong>
          <span>{session.user.email || session.user.id}</span>
        </div>

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
              </tr>
            </thead>
            <tbody>
              {snapshot.merchants.map((merchant) => (
                <tr key={merchant.merchantId}>
                  <td>{merchant.merchantName}</td>
                  <td>{merchant.todayEntries}</td>
                  <td>{merchant.totalEntries}</td>
                  <td>{merchant.redbookShares}</td>
                  <td>{merchant.meituanShares}</td>
                  <td>{merchant.dianpingShares}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
