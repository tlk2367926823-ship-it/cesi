import { LockKeyhole, LogIn, Mail, ShieldCheck } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { isSupabaseAuthConfigured, supabase } from "./supabaseClient";

type AdminLoginProps = {
  onLogin: () => void;
};

export function AdminLogin({ onLogin }: AdminLoginProps) {
  const [email, setEmail] = useState("2367926823@qq.com");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!isSupabaseAuthConfigured || !supabase) {
      setMessage("还没有配置 Supabase 登录参数，请先添加 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (error) {
      setMessage("登录失败，请检查邮箱或密码。");
      return;
    }

    onLogin();
  }

  return (
    <main className="admin-shell admin-login-shell">
      <section className="admin-login-card">
        <div className="admin-login-icon">
          <ShieldCheck size={34} />
        </div>
        <span className="admin-login-kicker">商家后台</span>
        <h1>登录查看真实数据</h1>
        <p>商家登录后可以查看自己的进入人数、平台分享次数和后续发布记录。</p>

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            <span>邮箱</span>
            <div>
              <Mail size={18} />
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入商家邮箱" type="email" />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div>
              <LockKeyhole size={18} />
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" type="password" />
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
