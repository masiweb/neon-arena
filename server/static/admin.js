(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fa = new Intl.NumberFormat("fa-IR");
  const state = { products: [], ads: [], editing: null, user: null, forcedPassword: false };
  let token = localStorage.getItem("neon-admin-token") || "";

  const escapeHtml = (value) => String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[char],
  );

  async function api(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body = options.body;
    if (body && typeof body !== "string") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const response = await fetch(path, { ...options, headers, body, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(data.detail || "درخواست انجام نشد");
      requestError.status = response.status;
      throw requestError;
    }
    return data;
  }

  function setMessage(id, message) {
    $(id).textContent = message || "";
    $(id).classList.toggle("hidden", !message);
  }

  function setBusy(button, busy, busyLabel) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : button.dataset.label;
  }

  function saveToken(value) {
    token = value || "";
    if (token) localStorage.setItem("neon-admin-token", token);
    else localStorage.removeItem("neon-admin-token");
  }

  function showLogin(message = "") {
    state.user = null;
    state.forcedPassword = false;
    $("adminApp").classList.add("hidden");
    $("adminGate").classList.remove("hidden");
    $("passwordPane").classList.add("hidden");
    $("loginPane").classList.remove("hidden");
    $("adminLoginForm").reset();
    setMessage("loginError", message);
    setTimeout(() => $("adminIdentifier").focus(), 30);
  }

  function showPassword(forced, message = "") {
    state.forcedPassword = forced;
    $("adminApp").classList.add("hidden");
    $("adminGate").classList.remove("hidden");
    $("loginPane").classList.add("hidden");
    $("passwordPane").classList.remove("hidden");
    $("forcedPasswordNotice").classList.toggle("hidden", !forced);
    $("cancelPassword").classList.toggle("hidden", forced);
    $("passwordEyebrow").textContent = forced ? "اولین ورود" : "امنیت حساب";
    $("passwordTitle").textContent = forced ? "رمز اولیه را تغییر دهید" : "تغییر رمز مدیریت";
    $("adminPasswordForm").reset();
    setMessage("passwordError", message);
    setTimeout(() => $("currentAdminPassword").focus(), 30);
  }

  function showApp(user) {
    state.user = user;
    state.forcedPassword = false;
    $("adminGate").classList.add("hidden");
    $("adminApp").classList.remove("hidden");
    $("adminIdentity").textContent = `${user.username} · ${user.email}`;
  }

  function money(value) { return fa.format(value || 0); }
  function table(headers, rows) {
    return `<table><thead><tr>${headers.map((item) => `<th>${item}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">اطلاعاتی وجود ندارد</td></tr>`}</tbody></table>`;
  }

  async function overview() {
    const data = await api("/api/admin/stats");
    const labels = { users: "کاربران", pendingOrders: "سفارش منتظر", gold: "طلای در گردش", diamonds: "الماس در گردش", rounds: "راند ثبت‌شده", activeAds: "تبلیغ فعال", onlineRooms: "اتاق آنلاین", onlinePlayers: "بازیکن آنلاین" };
    $("statsGrid").innerHTML = Object.entries(labels).map(([key, label]) => `<div class="stat"><span>${label}</span><b>${money(data[key])}</b></div>`).join("");
  }

  async function users(query = "") {
    const data = await api(`/api/admin/users?q=${encodeURIComponent(query)}`);
    $("usersTable").innerHTML = table(["کاربر", "اقتصاد", "عملکرد", "دسترسی", "عملیات"], data.users.map((user) => `<tr><td><b>${escapeHtml(user.username)}</b><small>${escapeHtml(user.email)}</small></td><td>🪙 ${money(user.gold)} · ◆ ${money(user.diamonds)}<small>${money(user.xp)} XP · ریتینگ ${money(user.rating)}</small></td><td>${money(user.wins)} برد · ${money(user.kills)} حذف</td><td>${user.isAdmin ? "مدیر" : "بازیکن"} · ${user.isActive === false ? "غیرفعال" : "فعال"}</td><td><div class="actions"><button data-wallet="${user.id}" data-name="${escapeHtml(user.username)}">کیف پول</button><button data-admin="${user.id}" data-value="${user.isAdmin ? 0 : 1}">${user.isAdmin ? "حذف مدیریت" : "مدیر کن"}</button><button class="danger" data-active="${user.id}" data-value="${user.isActive === false ? 1 : 0}">${user.isActive === false ? "فعال کن" : "تعلیق"}</button></div></td></tr>`).join(""));
  }

  async function orders() {
    const data = await api("/api/admin/orders");
    $("ordersTable").innerHTML = table(["شماره", "کاربر", "محصول", "مبلغ", "وضعیت", "عملیات"], data.orders.map((item) => `<tr><td>#${money(item.id)}</td><td>${escapeHtml(item.username)}</td><td>${escapeHtml(item.title)}</td><td>${money(item.amountIrr)} ریال</td><td><span class="tag ${item.status}">${item.status}</span></td><td><div class="actions">${item.status === "pending" ? `<button data-order="${item.id}" data-approve="1">تأیید پرداخت</button><button class="danger" data-order="${item.id}" data-approve="0">رد</button>` : "—"}</div></td></tr>`).join(""));
  }

  async function products() {
    const data = await api("/api/admin/products");
    state.products = data.products;
    $("productsTable").innerHTML = table(["کد", "عنوان", "محتوا", "قیمت", "وضعیت", "عملیات"], data.products.map((item) => `<tr><td>${escapeHtml(item.sku)}</td><td><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.description)}</small></td><td>${money(item.grantGold)} طلا · ${money(item.grantDiamonds)} الماس</td><td>${money(item.priceIrr)} ریال</td><td>${item.active ? "فعال" : "خاموش"}</td><td><div class="actions"><button data-edit-product="${item.id}">ویرایش</button></div></td></tr>`).join(""));
  }

  async function ads() {
    const data = await api("/api/admin/ads");
    state.ads = data.ads;
    $("adsTable").innerHTML = table(["عنوان", "جایگاه", "بازه", "وضعیت", "عملیات"], data.ads.map((item) => `<tr><td><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.body)}</small></td><td>${escapeHtml(item.placement)}</td><td>${item.startsAt ? new Date(item.startsAt * 1000).toLocaleDateString("fa-IR") : "همیشه"}</td><td>${item.active ? "فعال" : "خاموش"}</td><td><div class="actions"><button data-edit-ad="${item.id}">ویرایش</button></div></td></tr>`).join(""));
  }

  async function audit() {
    const data = await api("/api/admin/audit?limit=200");
    $("auditTable").innerHTML = table(["زمان", "مدیر", "عملیات", "هدف", "جزئیات"], data.logs.map((item) => `<tr><td>${new Date(item.createdAt * 1000).toLocaleString("fa-IR")}</td><td>${escapeHtml(item.admin)}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.targetType)} #${escapeHtml(item.targetId)}</td><td>${escapeHtml(item.detail)}</td></tr>`).join(""));
  }

  const loaders = { overview, users, orders, products, ads, audit };

  async function showPage(name) {
    document.querySelectorAll(".page").forEach((page) => page.classList.add("hidden"));
    $(`${name}Page`).classList.remove("hidden");
    document.querySelectorAll("[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === name));
    setMessage("adminError", "");
    try {
      await loaders[name]();
    } catch (requestError) {
      if (requestError.status === 428) return showPassword(true, requestError.message);
      if (requestError.status === 401) {
        saveToken("");
        return showLogin("نشست مدیریت منقضی شده است؛ دوباره وارد شوید.");
      }
      setMessage("adminError", requestError.message);
    }
  }

  function openEditor(type, item = {}) {
    state.editing = { type, id: item.id || null };
    $("editorTitle").textContent = item.id ? "ویرایش" : "ایجاد";
    if (type === "product") {
      $("editorFields").innerHTML = `<div class="form-grid"><label>کد محصول<input name="sku" required value="${escapeHtml(item.sku || "")}" /></label><label>عنوان<input name="title" required value="${escapeHtml(item.title || "")}" /></label><label class="full">توضیح<textarea name="description">${escapeHtml(item.description || "")}</textarea></label><label>مقدار طلا<input name="grantGold" type="number" min="0" value="${item.grantGold || 0}" /></label><label>مقدار الماس<input name="grantDiamonds" type="number" min="0" value="${item.grantDiamonds || 0}" /></label><label>قیمت ریال<input name="priceIrr" type="number" min="0" value="${item.priceIrr || 0}" /></label><label>ترتیب<input name="sortOrder" type="number" value="${item.sortOrder || 0}" /></label><label class="check"><input name="active" type="checkbox" ${item.active !== false ? "checked" : ""}/> فعال</label></div>`;
    } else {
      $("editorFields").innerHTML = `<div class="form-grid"><label>عنوان<input name="title" required value="${escapeHtml(item.title || "")}" /></label><label>جایگاه<select name="placement"><option value="login">ورود</option><option value="lobby">لابی</option><option value="result">نتیجه</option></select></label><label class="full">متن<textarea name="body">${escapeHtml(item.body || "")}</textarea></label><label class="full">لینک تصویر HTTPS<input name="imageUrl" dir="ltr" value="${escapeHtml(item.imageUrl || "")}" /></label><label class="full">لینک مقصد HTTPS<input name="targetUrl" dir="ltr" value="${escapeHtml(item.targetUrl || "")}" /></label><label>شروع Unix<input name="startsAt" type="number" value="${item.startsAt || ""}" /></label><label>پایان Unix<input name="endsAt" type="number" value="${item.endsAt || ""}" /></label><label>ترتیب<input name="sortOrder" type="number" value="${item.sortOrder || 0}" /></label><label class="check"><input name="active" type="checkbox" ${item.active !== false ? "checked" : ""}/> فعال</label></div>`;
      $("editorForm").elements.placement.value = item.placement || "lobby";
    }
    $("editor").classList.remove("hidden");
  }

  function closeEditor() {
    $("editor").classList.add("hidden");
    state.editing = null;
  }

  document.querySelectorAll("[data-reveal]").forEach((button) => button.addEventListener("click", () => {
    const input = $(button.dataset.reveal);
    input.type = input.type === "password" ? "text" : "password";
    button.setAttribute("aria-label", input.type === "password" ? "نمایش رمز" : "پنهان‌کردن رمز");
  }));

  $("adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("adminLoginButton");
    const identifier = $("adminIdentifier").value.trim();
    const password = $("adminPassword").value;
    setMessage("loginError", "");
    if (!identifier || !password) return setMessage("loginError", "نام کاربری و رمز عبور را وارد کنید.");
    setBusy(button, true, "در حال بررسی…");
    try {
      const result = await api("/api/admin/auth/login", { method: "POST", body: { identifier, password } });
      saveToken(result.token);
      state.user = result.user;
      if (result.user.mustChangePassword) {
        showPassword(true);
        $("currentAdminPassword").value = password;
      } else {
        showApp(result.user);
        await showPage("overview");
      }
    } catch (requestError) {
      setMessage("loginError", requestError.message);
    } finally {
      setBusy(button, false, "");
    }
  });

  $("adminPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("saveAdminPassword");
    const currentPassword = $("currentAdminPassword").value;
    const newPassword = $("newAdminPassword").value;
    const confirmation = $("confirmAdminPassword").value;
    setMessage("passwordError", "");
    if (newPassword !== confirmation) return setMessage("passwordError", "تکرار رمز جدید مطابقت ندارد.");
    if (newPassword.length < 14 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return setMessage("passwordError", "رمز جدید باید حداقل ۱۴ کاراکتر و شامل حرف بزرگ، حرف کوچک، عدد و نماد باشد.");
    }
    setBusy(button, true, "در حال ذخیره…");
    try {
      const result = await api("/api/admin/password", { method: "POST", body: { currentPassword, newPassword } });
      saveToken(result.token);
      showApp(result.user);
      await showPage("overview");
    } catch (requestError) {
      if (requestError.status === 401) {
        saveToken("");
        return showLogin("نشست مدیریت منقضی شده است؛ دوباره وارد شوید.");
      }
      setMessage("passwordError", requestError.message);
    } finally {
      setBusy(button, false, "");
    }
  });

  $("cancelPassword").addEventListener("click", () => {
    if (state.forcedPassword) return;
    showApp(state.user);
  });
  $("changePassword").addEventListener("click", () => showPassword(false));
  $("adminLogout").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (_error) { /* local logout still applies */ }
    saveToken("");
    showLogin("با موفقیت و به‌صورت امن خارج شدید.");
  });
  $("refreshAll").addEventListener("click", () => showPage(document.querySelector("[data-page].active").dataset.page));
  document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
  $("userSearch").addEventListener("submit", (event) => { event.preventDefault(); users($("userQuery").value).catch((requestError) => setMessage("adminError", requestError.message)); });
  $("newProduct").addEventListener("click", () => openEditor("product"));
  $("newAd").addEventListener("click", () => openEditor("ad"));
  $("closeEditor").addEventListener("click", closeEditor);
  $("editorBackdrop").addEventListener("click", closeEditor);

  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.dataset.wallet) {
        const gold = Number(prompt("تغییر طلا؛ عدد منفی مجاز است", "0"));
        const diamonds = Number(prompt("تغییر الماس؛ عدد منفی مجاز است", "0"));
        const reason = prompt("دلیل تغییر", "admin_adjustment") || "admin_adjustment";
        if (!Number.isFinite(gold) || !Number.isFinite(diamonds)) return;
        await api(`/api/admin/users/${button.dataset.wallet}/wallet`, { method: "POST", body: { gold, diamonds, reason } });
        await users();
      } else if (button.dataset.admin) {
        await api(`/api/admin/users/${button.dataset.admin}`, { method: "PATCH", body: { admin: button.dataset.value === "1" } });
        await users();
      } else if (button.dataset.active) {
        await api(`/api/admin/users/${button.dataset.active}`, { method: "PATCH", body: { active: button.dataset.value === "1" } });
        await users();
      } else if (button.dataset.order) {
        await api(`/api/admin/orders/${button.dataset.order}/review`, { method: "POST", body: { approve: button.dataset.approve === "1", trackingCode: prompt("کد پیگیری (اختیاری)", "") || "" } });
        await orders();
      } else if (button.dataset.editProduct) {
        openEditor("product", state.products.find((item) => item.id === Number(button.dataset.editProduct)));
      } else if (button.dataset.editAd) {
        openEditor("ad", state.ads.find((item) => item.id === Number(button.dataset.editAd)));
      }
    } catch (requestError) {
      setMessage("adminError", requestError.message);
    }
  });

  $("editorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = state.editing.type;
    const payload = type === "product"
      ? { sku: form.get("sku"), title: form.get("title"), description: form.get("description"), grantGold: Number(form.get("grantGold")), grantDiamonds: Number(form.get("grantDiamonds")), priceIrr: Number(form.get("priceIrr")), sortOrder: Number(form.get("sortOrder")), active: form.has("active") }
      : { title: form.get("title"), body: form.get("body"), imageUrl: form.get("imageUrl"), targetUrl: form.get("targetUrl"), placement: form.get("placement"), startsAt: Number(form.get("startsAt")) || null, endsAt: Number(form.get("endsAt")) || null, sortOrder: Number(form.get("sortOrder")), active: form.has("active") };
    const base = type === "product" ? "products" : "ads";
    try {
      await api(`/api/admin/${base}${state.editing.id ? `/${state.editing.id}` : ""}`, { method: state.editing.id ? "PATCH" : "POST", body: payload });
      closeEditor();
      await showPage(base);
    } catch (requestError) {
      setMessage("adminError", requestError.message);
    }
  });

  async function bootstrap() {
    if (!token) return showLogin();
    try {
      const { user } = await api("/api/me");
      if (!user.isAdmin) throw new Error("این حساب دسترسی مدیریت ندارد.");
      state.user = user;
      if (user.mustChangePassword) return showPassword(true);
      showApp(user);
      await showPage("overview");
    } catch (requestError) {
      saveToken("");
      showLogin(requestError.message);
    }
  }

  bootstrap();
})();
