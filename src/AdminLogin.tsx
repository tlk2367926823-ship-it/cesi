import { LockKeyhole, LogIn, Mail, ShieldCheck } from "lucide-react";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { isSupabaseAuthConfigured, supabase } from "./supabaseClient";

type AdminLoginProps = {
  onLogin: () => void;
};

export function AdminLogin({ onLogin }: AdminLoginProps) {
  const [email, setEmail] = useState(() => {
    try { return window.localStorage.getItem("taotian-admin-email") || ""; } catch { return ""; }
  });
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const loginLock = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginLock.current) return;
    setMessage("");

    if (!isSupabaseAuthConfigured || !supabase) {
      setMessage("还没有配置 Supabase 登录参数，请先添加 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。");
      return;
    }

    loginLock.current = true;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setMessage("登录失败，请检查邮箱或密码。");
        return;
      }
      try { window.localStorage.setItem("taotian-admin-email", email.trim()); } catch { /* Remembering an email is optional. */ }
      onLogin();
    } catch {
      setMessage("登录服务暂时无法连接，请检查网络后重试。");
    } finally {
      loginLock.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="admin-shell admin-login-shell">
      <section className="admin-login-card">
        <div className="admin-login-icon">
          <ShieldCheck size={34} />
        </div>
        <span className="admin-login-kicker">商家后台</span>
        <h1>滔田 AI 商家后台</h1>

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            <span>邮箱</span>
            <div>
              <Mail size={18} />
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入商家邮箱" type="email" autoComplete="username" required disabled={loading} />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div>
              <LockKeyhole size={18} />
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" type="password" autoComplete="current-password" required disabled={loading} />
            </div>
          </label>

          {message && <div className="admin-login-message">{message}</div>}

          <button type="submit" disabled={loading}>
            <LogIn size={18} />
            {loading ? "登录中..." : "登录后台"}
          </button>
        </form>
      </section>
    </main>
  );
}
