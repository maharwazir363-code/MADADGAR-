/* ============================================================
   MADADGAR APP â€” JavaScript Core Engine (PART 1)
   ============================================================ */

// 1. Firebase Configuration & Initialization
const firebaseConfig = {
  apiKey: "AIzaSyA5l-49V_ek2rD9Ym06WfQipiijMyzzo64",
  authDomain: "gen-lang-client-0758284005.firebaseapp.com",
  databaseURL: "https://gen-lang-client-0758284005-default-rtdb.firebaseio.com",
  projectId: "gen-lang-client-0758284005",
  storageBucket: "gen-lang-client-0758284005.firebasestorage.app",
  messagingSenderId: "570844080170",
  appId: "1:570844080170:web:3a35a26d67747a8210bb53",
};

// Initializing SDK Component Connectors Safely
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db   = firebase.database();
const auth = firebase.auth();

const ADMIN_PASSWORD = "shoaib999";
const USER_KEY = "madadgar_user_v3";

// 2. Global App State Management
const state = {
  user: null,
  posts: [],
  users: [],
  successCount: 0,
  currentScreen: "login",
  filter: "find_jobs",
  addressSearch: "",
  categorySearch: "",
  postsLoaded: false,
  usersLoaded: false,
  postType: "job_seeker",
  adminUserView: null,
  editPostId: null,
  usersError: null,
  viewedThisSession: new Set(),
  activeChat: null
};

/* ----------------------------- Utility Helpers ----------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUsername(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
}

function timeAgo(ts) {
  if (!ts) return "abhi";
  const diffMs = Date.now() - ts;
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "abhi";
  if (m < 60) return `${m} min pehle`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ghante pehle`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} din pehle`;
  return new Date(ts).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function showError(elId, msg) {
  const el = $("#" + elId);
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.hidden = true;
    el.textContent = "";
  }
}

function showScreen(name) {
  state.currentScreen = name;
  $$(".screen").forEach((s) => s.classList.remove("active"));
  const target = $("#screen-" + name);
  if (target) target.classList.add("active");
  window.scrollTo(0, 0);
}

function persistUser() {
  if (state.user) {
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

function loadPersistedUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ----------------------------- Authentication Module ----------------------------- */
async function handleLogin(e) {
  if (e) e.preventDefault();
  const username = $("#login-username")?.value;
  const password = $("#login-password")?.value;
  showError("login-error", "");

  const cleanUsername = safeUsername(username);
  if (!cleanUsername) return showError("login-error", "Username daalein.");
  if (!password) return showError("login-error", "Password daalein.");

  const btnText = $("#login-btn-text");
  if (btnText) btnText.textContent = "Sabar Karein...";

  try {
    const snap = await db.ref("users/" + cleanUsername).get();
    if (!snap.exists()) return showError("login-error", "Username nahi mila. Pehle Sign Up karein.");

    const data = snap.val();
    if (data.blocked) return showError("login-error", "Aap ko admin ne block kar diya hai.");
    if (!data.email) return showError("login-error", "Account mein email nahi hai. Admin se raabta karein.");

    try {
      const cred = await auth.signInWithEmailAndPassword(data.email, password);
      if (!cred.user.emailVerified) {
        await auth.signOut();
        return showError("login-error", "Aap ki email verify nahi hui. Inbox check karein aur email verify karein.");
      }
    } catch (authErr) {
      if (authErr.code === "auth/wrong-password" || authErr.code === "auth/invalid-credential") {
        return showError("login-error", "Ghalat password. Dobara try karein.");
      }
      return showError("login-error", authErr.message);
    }

    if (!data.emailVerified) {
      await db.ref("users/" + cleanUsername + "/emailVerified").set(true);
    }

    state.user = {
      username: data.username || cleanUsername,
      fullName: data.fullName,
      email: data.email,
      isAdmin: false,
    };
    persistUser();
    enterApp();
  } catch (err) {
    showError("login-error", "Server error. Internet connection check karein.");
  } finally {
    if (btnText) btnText.textContent = "LOGIN";
  }
}

async function handleSignup() {
  const fullName = $("#signup-fullname")?.value.trim();
  const username = safeUsername($("#signup-username")?.value);
  const email    = $("#signup-email")?.value.trim().toLowerCase();
  const password = $("#signup-password")?.value;

  showError("signup-error", "");
  if (!fullName) return showError("signup-error", "Apna naam likhein.");
  if (username.length < 3) return showError("signup-error", "Username chhota hai (kam az kam 3 letters).");
  if (!email) return showError("signup-error", "Sahi email address daalen.");
  if (password.length < 6) return showError("signup-error", "Password kam az kam 6 characters ka hona chahiye.");

  const btnText = $("#signup-btn-text");
  if (btnText) btnText.textContent = "Account ban raha hai...";

  try {
    const existing = await db.ref("users/" + username).get();
    if (existing.exists()) return showError("signup-error", "Yeh username pehle se registered hai.");

    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.sendEmailVerification();

    await db.ref("users/" + username).set({
      fullName,
      username,
      email,
      blocked: false,
      emailVerified: false,
      createdAt: Date.now(),
    });

    await auth.signOut();
    if ($("#signup-form")) $("#signup-form").hidden = true;
    if ($("#signup-success-notice")) $("#signup-success-notice").hidden = false;
  } catch (err) {
    let msg = err.message || "Signup fail hua.";
    if (err.code === "auth/email-already-in-use") msg = "Yeh email pehle se use mein hai.";
    showError("signup-error", msg);
  } finally {
    if (btnText) btnText.textContent = "SIGN UP";
  }
}

async function handleForgotPassword() {
  const email = $("#forgot-email")?.value.trim().toLowerCase();
  if (!email) return showError("forgot-error", "Email address daalen.");

  const btnText = $("#forgot-btn-text");
  if (btnText) btnText.textContent = "Bhej rahe hain...";
  showError("forgot-error", "");

  try {
    await auth.sendPasswordResetEmail(email);
    if ($("#forgot-modal")) $("#forgot-modal").hidden = true;
    if ($("#forgot-email")) $("#forgot-email").value = "";
    showToast("Password reset link sent! Please check your Gmail Inbox.", "success", 5000);
  } catch (err) {
    showError("forgot-error", err.message || "Kuch masla aaya.");
  } finally {
    if (btnText) btnText.textContent = "Reset Link Bhejein";
  }
}

function logout() {
  auth.signOut().catch(() => {});
  state.user = null;
  persistUser();
  db.ref("posts").off();
  db.ref("users").off();
  db.ref("stats/successCount").off();
  showScreen("login");
}
/* ============================================================
   MADADGAR APP â€” JavaScript Core Engine (PART 2)
   ============================================================ */

/* ----------------------------- Database Listeners ----------------------------- */
function subscribePosts() {
  db.ref("posts").on(
    "value",
    (snap) => {
      const list = [];
      snap.forEach((child) => {
        list.push({ id: child.key, ...child.val() });
      });
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state.posts = list;
      state.postsLoaded = true;
      onPostsChanged();
    },
    (err) => {
      console.warn("Posts read error:", err.message);
      state.postsLoaded = true;
      renderHome();
    }
  );
}

function subscribeUsers() {
  db.ref("users").on(
    "value",
    (snap) => {
      const list = [];
      const ghostKeys = [];
      snap.forEach((child) => {
        const val = child.val();
        if (!val) return;
        val._key = child.key;
        if (!val.username) val.username = child.key;

        const hasName  = val.fullName && val.fullName.trim();
        const hasEmail = val.email    && val.email.trim();
        if (!hasName || !hasEmail) {
          ghostKeys.push(child.key);
          return;
        }
        list.push(val);
      });

      ghostKeys.forEach((key) =>
        db.ref("users/" + key).remove().catch(() => {})
      );

      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state.users = list;
      state.usersLoaded = true;
      state.usersError = null;
      onUsersChanged();
    },
    (err) => {
      console.error("Firebase users read error:", err.code, err.message);
      state.usersLoaded = true;
      state.usersError = err.message || "Firebase permission error";
      onUsersChanged();
    }
  );
}

function subscribeStats() {
  db.ref("stats/successCount").on(
    "value",
    (snap) => {
      state.successCount = snap.val() || 0;
      updateSuccessBar();
    },
    (err) => console.warn("Stats read error:", err.message)
  );
}

function onPostsChanged() {
  if (state.currentScreen === "home") renderHome();
  if (state.currentScreen === "history") renderHistory();
  if (state.currentScreen === "admin") {
    renderAdminStats();
    renderReportedPosts();
  }
  if (state.currentScreen === "admin-user") renderAdminUser();
}

function onUsersChanged() {
  if (state.currentScreen === "admin") {
    renderAdminStats();
    renderAdminUsersTable();
  }
  if (state.currentScreen === "admin-user") renderAdminUser();
}

/* ----------------------------- Post Card Generator ----------------------------- */
function postCardHTML(post, opts = {}) {
  const isWorker = post.type === "job_seeker";
  const tagClass = isWorker ? "worker" : "employer";
  const tagText = isWorker ? "ðŸ‘¤ Worker Profile" : "ðŸ’¼ Job Post";
  const ownerName = post.ownerName ? post.ownerName : "";

  let inner = `<div class="post-card">
    <div class="post-tags">
      <span class="tag ${tagClass}">${tagText}</span>
      ${post.verified ? '<span class="tag worker">âœ“ Verified</span>' : ""}
    </div>`;

  if (post.done) {
    inner += `<div class="done-badge" style="background:#25D366; color:white; padding:5px; text-align:center; font-weight:bold; margin-top:5px; border-radius:4px;">âœ“ ALHAMDULILLAH! KAAM HO GAYA</div>`;
  }

  if (post.category) {
    inner += `<div class="post-row bold" style="margin-top:8px;"><span class="ic">ðŸ› ï¸</span> <span>${escapeHtml(post.category)}</span></div>`;
  }

  if (post.salary) {
    inner += `<div class="post-row"><span class="ic">ðŸ’°</span> <span>${escapeHtml(post.salary)}</span></div>`;
  }

  inner += `<div class="post-row"><span class="ic">ðŸ“</span> <span>${escapeHtml(post.address || "")}</span></div>`;

  if (ownerName) {
    inner += `<div class="post-row"><span class="ic">ðŸ‘¤</span> <span>${escapeHtml(ownerName)}</span></div>`;
  }

  inner += `<div class="post-meta" style="font-size:12px; color:#666; margin-top:5px;">${timeAgo(post.createdAt)} â€¢ ${post.viewCount || 0} views</div>`;

  const isOwner = state.user && post.username === state.user.username;

  if (opts.adminMode) {
    const resetBtn = post.done ? `<button class="action-btn reset" data-act="reset-done" data-id="${post.id}">Reset</button>` : "";
    inner += `
        <div class="post-actions" style="margin-top:10px; display:flex; gap:5px;">
            ${resetBtn}
            <button class="action-btn edit-post-btn" data-act="edit-post" data-id="${post.id}">Edit</button>
            <button class="action-btn delete" data-act="delete-post" data-id="${post.id}">Delete</button>
        </div>`;
  } else if (isOwner) {
    const doneBtn = post.done ? "" : `<button class="action-btn done" data-act="mark-done" data-id="${post.id}">âœ“ Mark as Done</button>`;
    const deleteBtn = opts.myMode ? `<button class="action-btn delete" data-act="delete-mine" data-id="${post.id}">Delete</button>` : "";
    inner += `
        <div class="post-actions" style="margin-top:10px; display:flex; gap:5px;">
            ${doneBtn}
            <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}">Call</button>
            ${deleteBtn}
        </div>`;
  } else {
    if (!post.done) {
        const alreadyReported = (() => {
            try {
                const key = "madadgar_reported_v1";
                return JSON.parse(localStorage.getItem(key) || "[]").includes(post.id);
            } catch { return false; }
        })();

        const reportBtn = alreadyReported
            ? `<button class="action-btn report" disabled style="opacity:.5; cursor:default">Reported</button>`
            : `<button class="action-btn report" data-act="report-post" data-id="${post.id}">âš ï¸ Report</button>`;

        inner += `
            <div class="post-actions" style="display: flex; flex-direction: column; gap: 5px; margin-top:10px;">
                <button type="button" class="action-btn" onclick="openChatWithUser('${post.username || 'test_user'}', '${escapeHtml(post.ownerName || 'User')}')" style="background-color: #007bff; color: white; padding:8px; border:none; border-radius:5px; cursor:pointer;">ðŸ’¬ Chat</button>
                <div style="display: flex; gap: 5px; width: 100%;">
                    <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}" style="flex: 1;">ðŸ“ž Call</button>
                    <div style="flex: 1;">${reportBtn}</div>
                </div>
            </div>`;
    }
  }

  inner += `</div>`;
  return inner;
}

/* ----------------------------- Screen Renderers ----------------------------- */
function renderHome() {
  const list = $("#posts-list") || $("#home-posts-list"); 
  if (!list) return;

  if (!state.postsLoaded) {
    list.innerHTML = `
      <div class="loading-block">
        <div class="spinner"></div>
        <p class="muted small">Madadgar posts load ho rahi hain...</p>
      </div>`;
    return;
  }

  const filtered = state.posts.filter((p) => {
    const matchesType = state.filter === "find_jobs" ? p.type === "employer" : p.type === "job_seeker";
    if (!matchesType) return false;
    if (state.addressSearch && !(p.address || "").toLowerCase().includes(state.addressSearch.toLowerCase())) return false;
    if (state.categorySearch && !(p.category || "").toLowerCase().includes(state.categorySearch.toLowerCase())) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-block">
        <div class="big">${state.filter === "find_jobs" ? "ðŸ’¼" : "ðŸ‘¥"}</div>
        <div class="title">${state.addressSearch || state.categorySearch ? "Kuch nahi mila" : state.filter === "find_jobs" ? "Abhi koi kaam nahi hai" : "Abhi koi worker nahi hai"}</div>
        <p>Post karne ke liye neeche "+" button dabayein</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map((p) => postCardHTML(p)).join("");
  filtered.forEach((p) => recordView(p));
}

function renderHistory() {
  const list = $("#my-posts-list");
  if (!list) return;
  const mine = state.posts.filter((p) => state.user && p.username === state.user.username);
  if (mine.length === 0) {
    list.innerHTML = `
      <div class="empty-block">
        <div class="big">ðŸ“­</div>
        <div class="title">Aap ne abhi koi post nahi ki</div>
        <p>Home par jaa kar "+" button dabayein</p>
      </div>`;
    return;
  }
  list.innerHTML = mine.map((p) => postCardHTML(p, { myMode: true })).join("");
}

function renderAdminStats() {
  const total    = state.users.length;
  const verified = state.users.filter((u) => u.emailVerified === true).length;
  const pending  = total - verified;

  if ($("#stat-signups"))  $("#stat-signups").textContent  = total;
  if ($("#stat-verified")) $("#stat-verified").textContent = verified;
  if ($("#stat-pending"))  $("#stat-pending").textContent  = pending;
  if ($("#stat-users"))    $("#stat-users").textContent    = total;
  if ($("#stat-posts"))    $("#stat-posts").textContent    = state.posts.length;
  if ($("#stat-success"))  $("#stat-success").textContent  = state.successCount;
}

function renderAdminUsersTable() {
  const body = $("#users-table-body");
  if (!body) return;
  if (!state.usersLoaded) {
    body.innerHTML = `<div class="spinner"></div>`;
    return;
  }
  if (state.usersError) {
    body.innerHTML = `<div style="color:red; padding:10px;">Users data fetch nahi ho saka.</div>`;
    return;
  }

  const postCounts = {};
  state.posts.forEach((p) => {
    if (p.username) postCounts[p.username] = (postCounts[p.username] || 0) + 1;
  })
    body.innerHTML = state.users.map(u => {
    const pCount = postCounts[u.username] || 0;
    const cleanUsername = escapeHtml(u.username);
    const cleanEmail = escapeHtml(u.email);
    const cleanFullName = escapeHtml(u.fullName || u.name || '');

    return `
      <!-- Onclick ke andar details load karne aur block ko show karne ka pakka ilaj -->
      <div class="user-row" onclick="if(!event.target.classList.contains('user-action-btn')){ 
        state.adminUserView='${cleanUsername}'; 
        if(typeof renderAdminUser==='function') renderAdminUser();
        if(typeof renderAdmin==='function') renderAdmin();
        const detailContainer = document.getElementById('admin-user-content') || document.querySelector('#admin-user-content');
        if(detailContainer) { detailContainer.style.display = 'block'; detailContainer.scrollIntoView({ behavior: 'smooth' }); }
      }" style="padding: 10px 5px; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between; font-size: 13px; cursor: pointer;">
        
        <!-- 1. Name Column -->
        <span style="width: 30%; word-break: break-word; padding-right: 5px;">
          <b>${cleanFullName}</b><br><span style="color:#777; font-size:11px;">(@${cleanUsername})</span>
        </span>
        
        <!-- 2. Email Column -->
        <span style="width: 40%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 5px;" title="${cleanEmail}">
          ${cleanEmail}
        </span>
        
        <!-- 3. Posts Column -->
        <span style="width: 12%; text-align: center;">
          ${pCount}
        </span>
        
        <!-- 4. Action Column (Delete Button) -->
        <div style="width: 18%; text-align: right;">
          <button class="user-action-btn danger" data-act="delete-user" data-username="${cleanUsername}" style="padding: 4px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; width: 100%;">Delete</button>
        </div>

      </div>
    `;
}).join('');

}

function renderReportedPosts() {
  const container = $("#reported-posts-list");
  if (!container) return;

  const reported = state.posts
    .filter((p) => (p.reportsCount || 0) >= 1)
    .sort((a, b) => (b.reportsCount || 0) - (a.reportsCount || 0));

  if (reported.length === 0) {
    container.innerHTML = `<div class="reported-empty muted small" style="padding:10px;">Koi reported post nahi hai.“</div>`;
    return;
  }

  container.innerHTML = reported.map((p) => {
      const title = escapeHtml(p.category || (p.type === "job_seeker" ? "Worker Profile" : "Job Post"));
      return `
      <div class="reported-post-item" style="padding:10px; border-bottom:1px solid #ddd; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div><b>${title}</b></div>
          <div style="size:12px; color:#777;">@${escapeHtml(p.username || "unknown")}</div>
        </div>
        <div>
          <span style="color:orange; margin-right:8px;">âš ï¸ ${p.reportsCount}</span>
          <button class="user-action-btn danger" data-act="delete-reported" data-id="${escapeHtml(p.id)}" style="background:#dc3545; color:white; border:none; padding:4px 8px; border-radius:4px;">ðŸ—‘ Delete</button>
        </div>
      </div>`;
    }).join("");
}

function renderAdminUser() {
    if (!state.adminUserView) return;
    const u = state.users.find(x => x.username === state.adminUserView);
    const container = $("#admin-user-content");
    if (!container) return;

    if (!u) {
        container.innerHTML = `<div>User nahi mila</div>`;
        return;
    }

    container.innerHTML = `
        <h3>${escapeHtml(u.fullName)}</h3>
        <p>@${escapeHtml(u.username)}</p>
        <button class="block-big-btn danger" data-act="delete-user" data-username="${escapeHtml(u.username)}">ðŸ—‘ï¸ DELETE USER</button>
    `;
}

/* ----------------------------- Operations & Transactions ----------------------------- */
async function addPostToFirebase(data) {
  const ref = db.ref("posts").push();
  await ref.set({
    type: data.type,
    category: data.category || null,
    mobileNumber: data.mobileNumber,
    username: data.username,
    ownerName: data.ownerName,
    address: data.address,
    createdAt: Date.now(),
    viewCount: 0,
    verified: false,
  });
}

async function recordView(post) {
  if (!post || !post.id || !state.user || state.user.isAdmin) return;
  if (post.username === state.user.username) return;
  if (state.viewedThisSession.has(post.id)) return;
  state.viewedThisSession.add(post.id);
  
  const username = state.user.username;
  try {
    await db.ref("posts/" + post.id).transaction((current) => {
      if (!current) return current;
      if (current.viewers && current.viewers[username]) return;
      current.viewers = current.viewers || {};
      current.viewers[username] = true;
      current.viewCount = (current.viewCount || 0) + 1;
      return current;
    });
  } catch (err) {
    console.warn("View transaction exception:", err.message);
  }
}

async function markPostDone(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post || post.done) return;
  if (!confirm("Pakka kaam ho gaya?\nYeh post 'Alhamdulillah Kaam Ho Gaya' ke saath mark ho jayegi.")) return;
  try {
    await db.ref("posts/" + id).update({ done: true, doneAt: Date.now() });
    await db.ref("stats/successCount").transaction((c) => (c || 0) + 1);
  } catch (err) {
    alert("Mark process fail.");
  }
}

function updateSuccessBar() {
  if ($("#success-count")) $("#success-count").textContent = state.successCount;
  if ($("#stat-success")) $("#stat-success").textContent = state.successCount;
}

function showToast(msg, type = "success", duration = 3000) {
  const container = $("#toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.classList.add("show"), 50);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function handleShareApp() {
  const appUrl = "https://maharwazir363-code.github.io/MADADGAR-/";
  const shareText = "Salam! Agar aap ko kisi bhi kism ki madad chahiye ya aap kisi ki madad karna chahte hain, toh abhi 'MADADGAR' app use karein: " + appUrl;
  if (navigator.share) {
    navigator.share({ title: "MADADGAR", text: shareText, url: appUrl }).catch(() => {});
  } else {
    navigator.clipboard.writeText(shareText).then(() => showToast("âœ“ Link copy ho gaya!", "success"));
  }
}

/* ----------------------------- Events Setup ----------------------------- */
function attachEvents() {
  $("#form-login")?.addEventListener("submit", handleLogin);
  $("#signup-btn")?.addEventListener("click", handleSignup);
  $("#forgot-submit")?.addEventListener("click", handleForgotPassword);
  
  $("#go-signup")?.addEventListener("click", () => showScreen("signup"));
  $("#go-login")?.addEventListener("click", (e) => { e.preventDefault(); showScreen("login"); });

  $$(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      renderHome();
    });
  });

  $("#search-address")?.addEventListener("input", (e) => {
    state.addressSearch = e.target.value;
    renderHome();
  });

  $("#open-history")?.addEventListener("click", () => { showScreen("history"); renderHistory(); });
  $("#back-from-history")?.addEventListener("click", () => showScreen("home"));
  $("#open-menu")?.addEventListener("click", () => { if($("#menu-backdrop")) $("#menu-backdrop").hidden = false; });
  $("#menu-logout")?.addEventListener("click", () => { if($("#menu-backdrop")) $("#menu-backdrop").hidden = true; logout(); });
  $("#menu-share")?.addEventListener("click", () => { if($("#menu-backdrop")) $("#menu-backdrop").hidden = true; handleShareApp(); });

  $("#open-add-post")?.addEventListener("click", () => { if($("#add-post-modal")) $("#add-post-modal").hidden = false; });
  $("#close-add-post")?.addEventListener("click", () => { if($("#add-post-modal")) $("#add-post-modal").hidden = true; });

  $("#form-add-post")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const cat = $("#post-category")?.value;
    const address = $("#post-address")?.value.trim();
    const mobile = $("#post-mobile-input")?.value.trim();

    if (!cat || !address || !mobile) return;

    try {
      await addPostToFirebase({
        type: state.postType,
        category: cat,
        mobileNumber: mobile,
        username: state.user.username,
        ownerName: state.user.fullName,
        address: address
      });
      if($("#add-post-modal")) $("#add-post-modal").hidden = true;
      $("#post-address").value = "";
      $("#post-mobile-input").value = "";
    } catch(err) {
      console.error("Post writing crash protected:", err);
    }
  });

  // Delegated Actions Listener safely capturing clicks
  document.addEventListener("click", async (e) => {
    const target = e.target.closest("[data-act]");
    if (!target) return;
    const act = target.dataset.act;

    if (act === "call") {
      const m = target.dataset.mobile;
      if (m) window.location.href = "tel:" + m;
    }
    if (act === "mark-done") {
      await markPostDone(target.dataset.id);
    }
    if (act === "delete-user") {
      const u = target.dataset.username;
      if (u && confirm(`Kya aap waqai @${u} ka account delete karna chahte hain?`)) {
        db.ref("users/" + u).remove().catch(() => {});
      }
    }
    if (act === "delete-reported") {
      const id = target.dataset.id;
      if (id) db.ref("posts/" + id).remove().catch(() => {});
    }
  });
}

function updateBottomHint() {
  if ($("#bottom-hint")) {
    $("#bottom-hint").textContent = state.user ? `Hi ${state.user.fullName || state.user.username}!` : "Hi!";
  }
}

function enterApp() {
    setupUserPresence();
    updateBottomHint();
    subscribeStats();
    if (state.user.isAdmin) {
        showScreen("admin");
        subscribePosts();
        subscribeUsers();
    } else {
        showScreen("home");
        subscribePosts();
    }
}
// ========================================================
// MADADGAR ADMIN & NAVIGATION SYSTEM (UPDATED)
// ========================================================
document.addEventListener("DOMContentLoaded", () => {
    
    // --- 1. 5-BAR CLICK TO OPEN ADMIN POP-UP ---
    const loginLogo = document.querySelector("#screen-login .logo-box") || 
                      document.getElementById("login-logo") || 
                      document.querySelector(".logo-box") ||
                      document.querySelector("#screen-login h1");

    if (loginLogo) {
        let clickCount = 0;
        let clickTimer = null;
        loginLogo.style.cursor = "pointer";

        loginLogo.addEventListener("click", () => {
            clickCount++;
            clearTimeout(clickTimer);
            
            if (clickCount >= 5) {
                clickCount = 0;
                const adminGateModal = document.getElementById("admin-gate-backdrop") || document.querySelector("#admin-gate-backdrop");
                const adminInput = document.getElementById("admin-gate-input") || document.querySelector("#admin-gate-input");
                
                if (adminGateModal) {
                    if (adminInput) adminInput.value = "";
                    adminGateModal.hidden = false;
                    adminGateModal.style.display = "flex"; 
                    setTimeout(() => { if (adminInput) adminInput.focus(); }, 100);
                }
                return;
            }
            clickTimer = setTimeout(() => { clickCount = 0; }, 2000);
        });
    }

    // --- 2. ADMIN GATE PASSWORD CHECK (HIDES POP-UP) ---
    const adminForm = document.getElementById("admin-gate-form") || document.querySelector("#admin-gate-form");
    if (adminForm) {
        adminForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const adminInput = document.getElementById("admin-gate-input") || document.querySelector("#admin-gate-input");
            const pwd = adminInput ? adminInput.value.trim() : "";
            
            if (pwd === "shoaib999") {
                state.user = {
                    username: "admin",
                    fullName: "Super Admin",
                    email: "",
                    isAdmin: true
                };
                
                if (typeof persistUser === "function") persistUser();
                if (typeof closeAdminGate === "function") closeAdminGate();
                
                // Pop-up ko screen se foran hatane ke liye
                const gateModal = document.getElementById("admin-gate-backdrop") || document.querySelector("#admin-gate-backdrop") || document.getElementById("admin-gate-modal");
                if (gateModal) {
                    gateModal.style.display = "none";
                    gateModal.hidden = true;
                }

                if (typeof enterApp === "function") {
                    enterApp();
                } else if (typeof showScreen === "function") {
                    showScreen("admin");
                }
            } else {
                alert("❌ Galat Password! Dubara koshish karein.");
                if (adminInput) adminInput.value = "";
            }
        });
    }

    // --- 3. BOTTOM NAVIGATION BUTTONS ---
    const navHome = document.getElementById("nav-home") || document.querySelector("[data-screen='home']");
    const navInbox = document.getElementById("nav-inbox") || document.getElementById("open-inbox") || document.querySelector("[data-screen='inbox']");
    const navHistory = document.getElementById("nav-history") || document.getElementById("open-history");
    const navProfile = document.getElementById("nav-profile") || document.querySelector("[data-screen='profile']");

    if (navHome) {
        navHome.addEventListener("click", () => {
            if (typeof showScreen === "function") showScreen("home");
            if (typeof renderHome === "function") renderHome();
        });
    }
    if (navInbox) {
        navInbox.addEventListener("click", () => {
            if (typeof openInboxScreen === "function") openInboxScreen();
            else if (typeof showScreen === "function") {
                showScreen("chat-history-screen");
                if (typeof loadChatHistory === "function") loadChatHistory();
            }
        });
    }
    if (navHistory) {
        navHistory.addEventListener("click", () => {
            if (typeof showScreen === "function") showScreen("history");
            if (typeof renderHistory === "function") renderHistory();
        });
    }
    if (navProfile) {
        navProfile.addEventListener("click", () => {
            if (typeof openProfileModal === "function") openProfileModal();
        });
    }
});

/* ----------------------------- Chat Module Engine ----------------------------- */
function setupUserPresence() {
    let currentUserID = state.user?.username || "test_user";
    const userStatusRef = db.ref('/users/' + currentUserID + '/status');
    db.ref('.info/connected').on('value', (snapshot) => {
        if (snapshot.val() == false) return;
        userStatusRef.onDisconnect().set({
            state: 'offline',
            last_changed: firebase.database.ServerValue.TIMESTAMP
        }).then(() => {
            userStatusRef.set({
                state: 'online',
                last_changed: firebase.database.ServerValue.TIMESTAMP
            });
        });
    });
}

function openChatWithUser(receiverID, receiverName) {
    let currentUserID = state.user?.username || "test_user";
    if (currentUserID === receiverID) return;

    let currentChatRoomID = currentUserID < receiverID ? currentUserID + "_" + receiverID : receiverID + "_" + currentUserID;
    state.activeChat = receiverID;

    const chatModal = document.getElementById('chat-modal');
    if(chatModal) chatModal.style.display = 'flex';
    
    const nameHeading = document.getElementById('chat-user-name');
    if(nameHeading) nameHeading.innerText = receiverName;

    db.ref('chats/' + currentChatRoomID + '/messages').on('value', (snapshot) => {
        const area = document.getElementById('chat-messages-area');
        if(!area) return;
        area.innerHTML = "";
        snapshot.forEach((child) => {
            let msg = child.val();
            let div = document.createElement('div');
            div.innerText = msg.text;
            div.style.padding = "8px";
            div.style.margin = "5px";
            div.style.borderRadius = "8px";
            div.style.maxWidth = "70%";
            if(msg.senderID === currentUserID) {
                div.style.background = "#007bff";
                div.style.color = "white";
                div.style.marginLeft = "auto";
            } else {
                div.style.background = "#eee";
                div.style.color = "#333";
            }
            area.appendChild(div);
        });
    });
}

/* ----------------------------- Core Initialization ----------------------------- */
function init() {
  attachEvents();
  state.user = loadPersistedUser();
  if (state.user) {
    enterApp();
  } else {
    showScreen("login");
  }
  
  // App Loader / Splash Screen closer logic
  setTimeout(() => {
    const splash = $("#splash");
    if (splash) {
      splash.classList.add("hidden");
      setTimeout(() => splash.remove(), 300);
    }
  }, 500);
}

// Kickstart process
document.addEventListener("DOMContentLoaded", init);
/* ============================================================
   MADADGAR APP â€” JavaScript Core Engine (PART 3 - FINAL)
   ============================================================ */

/* ----------------------------- Post Mechanics & Reporting ----------------------------- */
async function reportPost(id) {
  if (!id || !state.user) return;
  
  const reportKey = "madadgar_reported_v1";
  let localReported = [];
  try {
    localReported = JSON.parse(localStorage.getItem(reportKey) || "[]");
  } catch (e) {
    localReported = [];
  }

  if (localReported.includes(id)) {
    showToast("Aap yeh post pehle hi report kar chuke hain.", "error");
    return;
  }

  if (!confirm("Kya aap waqai is post ko report karna chahte hain?\nAdmin iski janch karega.")) return;

  try {
    await db.ref("posts/" + id).transaction((current) => {
      if (!current) return current;
      current.reportsCount = (current.reportsCount || 0) + 1;
      current.reportedBy = current.reportedBy || {};
      current.reportedBy[state.user.username] = true;
      return current;
    });

    localReported.push(id);
    localStorage.setItem(reportKey, JSON.stringify(localReported));
    showToast("âœ“ Post report ho gayi. Shukriya!", "success");
    renderHome();
  } catch (err) {
    console.error("Report transaction error:", err.message);
    showToast("Report process fail hua.", "error");
  }
}

async function resetPostDoneStatus(id) {
  if (!id) return;
  try {
    await db.ref("posts/" + id).update({ done: false, doneAt: null });
    await db.ref("stats/successCount").transaction((c) => Math.max(0, (c || 0) - 1));
    showToast("Post status reset ho gaya.", "success");
  } catch (err) {
    showToast("Reset operations failed.", "error");
  }
}

/* ----------------------------- Post Custom Editors (Admin) ----------------------------- */
function openEditPostModal(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return;

  state.editPostId = id;
  
  // Dynamic creation of admin editor modal if not hardcoded in HTML
  let modal = $("#admin-edit-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "admin-edit-modal";
    modal.className = "modal-overlay";
    modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:2000;";
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-card" style="background:white; padding:20px; border-radius:8px; width:90%; max-width:400px;">
      <h3 style="margin-top:0;">âœï¸ Edit Post (Admin)</h3>
      <label style="display:block; margin:10px 0 5px;">Category:</label>
      <input type="text" id="edit-mod-cat" value="${escapeHtml(post.category || '')}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
      
      <label style="display:block; margin:10px 0 5px;">Address:</label>
      <input type="text" id="edit-mod-addr" value="${escapeHtml(post.address || '')}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
      
      <label style="display:block; margin:10px 0 5px;">Mobile:</label>
      <input type="text" id="edit-mod-mobile" value="${escapeHtml(post.mobileNumber || '')}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px;">
      
      <div style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end;">
        <button id="btn-edit-mod-cancel" style="padding:8px 12px; background:#ccc; border:none; border-radius:4px; cursor:pointer;">Cancel</button>
        <button id="btn-edit-mod-save" style="padding:8px 12px; background:#28a745; color:white; border:none; border-radius:4px; cursor:pointer;">Save Changes</button>
      </div>
    </div>
  `;
  modal.style.display = "flex";

  $("#btn-edit-mod-cancel")?.addEventListener("click", () => { modal.style.display = "none"; });
  $("#btn-edit-mod-save")?.addEventListener("click", async () => {
    const cat = $("#edit-mod-cat")?.value.trim();
    const addr = $("#edit-mod-addr")?.value.trim();
    const mob = $("#edit-mod-mobile")?.value.trim();

    if (!cat || !addr || !mob) {
      alert("Fields khali nahi chor sakte.");
      return;
    }

    try {
      await db.ref("posts/" + state.editPostId).update({
        category: cat,
        address: addr,
        mobileNumber: mob
      });
      modal.style.display = "none";
      showToast("âœ“ Post successfully updated!", "success");
    } catch (err) {
      alert("Update failed: " + err.message);
    }
  });
}

/* ----------------------------- Chat Interface UI Controllers ----------------------------- */
function closeChatModal() {
  const chatModal = document.getElementById('chat-modal');
  if(chatModal) chatModal.style.display = 'none';
  state.activeChat = null;
  
  // Turn off active Firebase chat listeners to clear memory leaks
  let currentUserID = state.user?.username || "test_user";
  let receiverID = state.activeChat;
  if(receiverID) {
    let currentChatRoomID = currentUserID < receiverID ? currentUserID + "_" + receiverID : receiverID + "_" + currentUserID;
    db.ref('chats/' + currentChatRoomID + '/messages').off();
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chat-message-input');
  if(!input) return;
  let text = input.value.trim();
  if(!text || !state.activeChat) return;

  let currentUserID = state.user?.username || "test_user";
  let receiverID = state.activeChat;
  let currentChatRoomID = currentUserID < receiverID ? currentUserID + "_" + receiverID : receiverID + "_" + currentUserID;

  try {
    const msgRef = db.ref('chats/' + currentChatRoomID + '/messages').push();
    await msgRef.set({
      text: text,
      senderID: currentUserID,
      receiverID: receiverID,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
    input.value = "";
    
    // Auto-scroll mechanics inside chat viewport window
    const area = document.getElementById('chat-messages-area');
    if(area) area.scrollTop = area.scrollHeight;
  } catch(err) {
    console.error("Message delivery crashed:", err.message);
  }
}

/* ----------------------------- Auxiliary Core Event Setup ----------------------------- */
function attachExtraSystemEvents() {
  // Adding listeners to static buttons or modal layout configurations
  $("#menu-close")?.addEventListener("click", () => { if($("#menu-backdrop")) $("#menu-backdrop").hidden = true; });
  $("#menu-backdrop")?.addEventListener("click", (e) => { if(e.target.id === "menu-backdrop") $("#menu-backdrop").hidden = true; });

  // Post addition layout selectors (Job type toggles)
  $("#btn-type-seeker")?.addEventListener("click", () => {
    state.postType = "job_seeker";
    $("#btn-type-seeker").classList.add("active");
    $("#btn-type-provider")?.classList.remove("active");
  });

  $("#btn-type-provider")?.addEventListener("click", () => {
    state.postType = "employer";
    $("#btn-type-provider").classList.add("active");
    $("#btn-type-seeker")?.classList.remove("active");
  });

  // Chat window native actions connectors
  document.getElementById('close-chat-btn')?.addEventListener('click', closeChatModal);
  document.getElementById('send-chat-btn')?.addEventListener('click', sendChatMessage);
  document.getElementById('chat-message-input')?.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') sendChatMessage();
  });

  // Global Context Click Bindings for runtime injection scripts
  document.addEventListener("click", async (e) => {
    const target = e.target.closest("[data-act]");
    if (!target) return;
    const act = target.dataset.act;

    if (act === "report-post") {
      await reportPost(target.dataset.id);
    }
    if (act === "reset-done") {
      await resetPostDoneStatus(target.dataset.id);
    }
    if (act === "edit-post") {
      openEditPostModal(target.dataset.id);
    }
    if (act === "delete-post" || act === "delete-mine") {
      const id = target.dataset.id;
      if (id && confirm("Kya aap waqai is post ko delete karna chahte hain?")) {
        db.ref("posts/" + id).remove()
          .then(() => showToast("Post delete ho gayi", "success"))
          .catch(() => showToast("Deletion failed", "error"));
      }
    }
  });
}

// Automatically bind additional background listeners on startup trigger
document.addEventListener("DOMContentLoaded", attachExtraSystemEvents);
