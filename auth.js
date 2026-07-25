// auth.js — must load after supabase-client.js (uses window.sb).
window.Auth = {
  async getUser() {
    const { data } = await sb.auth.getUser();
    return data.user || null;
  },
  async signInWithGoogle() {
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/dashboard.html" }
    });
  },
  async signOut() {
    await sb.auth.signOut();
    location.href = "index.html";
  },
  async requireLogin() {
    const user = await this.getUser();
    if (!user) {
      location.href = "index.html";
      return null;
    }
    return user;
  }
};
