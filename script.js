/* ============================================================
   MADADGAR â€” Pure vanilla JS app (Firebase RTDB via compat SDK)
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyA5l-49V_ek2rD9Ym06WfQipiijMyzzo64",
  authDomain: "gen-lang-client-0758284005.firebaseapp.com",
  databaseURL:
    "https://gen-lang-client-0758284005-default-rtdb.firebaseio.com",
  projectId: "gen-lang-client-0758284005",
  storageBucket: "gen-lang-client-0758284005.firebasestorage.app",
  messagingSenderId: "570844080170",
  appId: "1:570844080170:web:3a35a26d67747a8210bb53",
};

// FIX: Guard against double-initialisation
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db   = firebase.database();
const auth = firebase.auth();

const ADMIN_PASSWORD = "shoaib999";
const USER_KEY = "madadgar_user_v3";

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
  activeChat: null,
};

/* ----------------------------- Helpers ----------------------------- */
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
  if (!ts) return "";
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

/* ----------------------------- Auth ----------------------------- */
async function handleLogin(e) {
  e.preventDefault();
  const username = $("#login-username").value;
  const password = $("#login-password").value;
  showError("login-error", "");

  const cleanUsername = safeUsername(username);
  if (!cleanUsername) return showError("login-error", "Username daalein.");
  if (!password) return showError("login-error", "Password daalein.");

  const btn = $("#login-btn-text");
  btn.textContent = "Sabar Karein...";

  try {
    const snap = await db.ref("users/" + cleanUsername).get();
    if (!snap.exists())
      return showError("login-error", "Username nahi mila. Pehle Sign Up karein.");

    const data = snap.val();
    if (data.blocked)
      return showError("login-error", "Aap ko admin ne block kar diya hai.");
    if (!data.email)
      return showError("login-error", "Account mein email nahi hai. Admin se raabta karein.");

    let cred;
    try {
      cred = await auth.signInWithEmailAndPassword(data.email, password);
    } catch (authErr) {
      if (
        authErr.code === "auth/wrong-password" ||
        authErr.code === "auth/invalid-credential" ||
        authErr.code === "auth/invalid-password"
      )
        return showError("login-error", "Ghalat password. Dobara try karein.");
      if (authErr.code === "auth/too-many-requests")
        return showError("login-error", "Bahut zyada tries. Thodi der baad try karein.");
      throw authErr;
    }

    if (!cred.user.emailVerified) {
      await auth.signOut();
      return showError(
        "login-error",
        "Aap ki email verify nahi hui. Inbox check karein aur pehle email verify karein."
      );
    }

    if (!data.emailVerified) {
      await db.ref("users/" + cleanUsername + "/emailVerified").set(true);
    }

    await auth.signOut();

    state.user = {
      username: data.username || cleanUsername,
      fullName: data.fullName,
      email: data.email,
      isAdmin: false,
    };
    persistUser();
    // FIX: setupUserPresence() removed here â€” enterApp() calls it already
    enterApp();
  } catch (err) {
    console.error("Login error:", err.code, err.message);
    showError("login-error", "Server tak nahi pohanche. Internet check karein.");
  } finally {
    btn.textContent = "LOGIN";
  }
}

async function handleSignup() {
  const fullName = $("#signup-fullname").value.trim();
  const username = safeUsername($("#signup-username").value);
  const email    = $("#signup-email").value.trim().toLowerCase();
  const password = $("#signup-password").value;

  showError("signup-error", "");
  if (!fullName)
    return showError("signup-error", "Apna naam likhein.");
  if (username.length < 3)
    return showError("signup-error", "Username chhota hai (kam az kam 3 letters).");
  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return showError("signup-error", "Username mein sirf letters, numbers, _ chalega.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return showError("signup-error", "Sahi email address daalen.");
  if (password.length < 6)
    return showError("signup-error", "Password chhota hai (kam az kam 6 characters).");

  const btn = $("#signup-btn-text");
  btn.textContent = "Account ban raha hai...";
  $("#signup-btn").disabled = true;

  try {
    const existing = await db.ref("users/" + username).get();
    if (existing.exists())
      return showError("signup-error", "Yeh username pehle se hai. Doosra try karein.");

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

    $("#signup-form").hidden = true;
    $("#signup-success-notice").hidden = false;
  } catch (err) {
    console.error("Signup error:", err.code, err.message);
    let msg = err.message || "Signup fail hua. Phir koshish karein.";
    if (err.code === "auth/email-already-in-use")
      msg = "Yeh email pehle se registered hai.";
    else if (err.code === "auth/invalid-email")
      msg = "Email address sahi nahi hai.";
    else if (err.code === "auth/weak-password")
      msg = "Password zyada secure hona chahiye (kam az kam 6 characters).";
    showError("signup-error", msg);
  } finally {
    btn.textContent = "SIGN UP";
    $("#signup-btn").disabled = false;
  }
}

function resetSignupUI() {
  $("#signup-form").hidden = false;
  $("#signup-success-notice").hidden = true;
  $("#signup-fullname").value = "";
  $("#signup-username").value = "";
  $("#signup-email").value    = "";
  $("#signup-password").value = "";
  showError("signup-error", "");
}

function logout() {
  auth.signOut().catch(() => {});
  state.user = null;
  persistUser();
  db.ref("posts").off();
  db.ref("users").off();
  db.ref("stats/successCount").off();
  state.posts = [];
  state.users = [];
  state.successCount = 0;
  state.postsLoaded = false;
  state.usersLoaded = false;
  state.usersError = null;
  state.viewedThisSession = new Set();
  showScreen("login");
  if ($("#login-username")) $("#login-username").value = "";
  if ($("#login-password")) $("#login-password").value = "";
}

/* ----------------------------- Posts ----------------------------- */
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

async function addPostToFirebase(data) {
  const ref = db.ref("posts").push();
  await ref.set({
    type: data.type,
    category: data.category || null,
    salary: data.salary || null,
    mobileNumber: data.mobileNumber,
    username: data.username,
    ownerName: data.ownerName,
    address: data.address,
    createdAt: Date.now(),
    viewCount: 0,
    verified: false,
  });
}

async function deletePostFromFirebase(id) {
  await db.ref("posts/" + id).remove();
}

async function updatePostInFirebase(id, data) {
  await db.ref("posts/" + id).update(data);
}

async function deleteUser(username) {
  if (
    !confirm(
      `"@${username}" ka account permanently delete karna hai?\n\nIs user ke saare posts bhi delete ho jayenge. Yeh action undo nahi ho sakti.`
    )
  )
    return;
  try {
    const userRecord = state.users.find((x) => x.username === username);
    const dbKey = (userRecord && userRecord._key) ? userRecord._key : username;

    const userPosts = state.posts.filter((p) => p.username === username);
    await Promise.all(userPosts.map((p) => db.ref("posts/" + p.id).remove()));

    await db.ref("users/" + dbKey).remove();

    if (state.currentScreen === "admin-user") {
      state.adminUserView = null;
      showScreen("admin");
    }
  } catch (err) {
    console.error("deleteUser error:", err);
    alert("Delete fail. Phir try karein.\n\n" + (err.message || ""));
  }
}

function retryLoadUsers() {
  state.users = [];
  state.usersLoaded = false;
  state.usersError = null;
  db.ref("users").off("value");
  renderAdminUsersTable();
  subscribeUsers();
}

function openEditPost(post) {
  state.editPostId = post.id;
  $("#post-modal-title").textContent = "Post Edit Karein";
  $("#post-submit").textContent = "SAVE KAREIN";
  $("#edit-cancel-btn").hidden = false;
  const type = post.type || "job_seeker";
  state.postType = type;
  $$(".type-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.type === type)
  );
  const catSelect = $("#post-category");
  const validOptions = Array.from(catSelect.options).map((o) => o.value);
  if (validOptions.includes(post.category)) {
    catSelect.value = post.category;
    $("#post-custom-category").hidden = true;
    $("#post-custom-category").value = "";
  } else {
    catSelect.value = "Other";
    $("#post-custom-category").hidden = false;
    $("#post-custom-category").value = post.category || "";
  }
  if (type === "employer" && post.salary) {
    $("#salary-field").hidden = false;
    const stripped = (post.salary || "").replace(/^rs\.?\s*/i, "").trim();
    $("#post-salary").value = stripped;
  } else {
    $("#salary-field").hidden = type !== "employer";
    $("#post-salary").value = "";
  }
  $("#post-mobile-input").value = post.mobileNumber || state.user?.mobile || "";
  $("#post-address").value = post.address || "";
  $("#add-post-modal").hidden = false;
}

async function markPostDone(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post || post.done) return;
  if (!confirm("Pakka kaam ho gaya?\nYeh post 'Alhamdulillah Kaam Ho Gaya' ke saath mark ho jayegi."))
    return;
  try {
    await db.ref("posts/" + id).update({ done: true, doneAt: Date.now() });
    await db.ref("stats/successCount").transaction((c) => (c || 0) + 1);
  } catch (err) {
    console.error(err);
    alert("Mark fail. Phir try karein.");
  }
}

async function resetPostDone(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post || !post.done) return;
  if (!confirm("Is post ka status wapas Active karein?\n(Success Stories count se 1 minus ho jayega)"))
    return;
  try {
    await db.ref("posts/" + id).update({ done: false, doneAt: null });
    await db.ref("stats/successCount").transaction((c) => Math.max(0, (c || 0) - 1));
  } catch (err) {
    console.error(err);
    alert("Reset fail. Phir try karein.");
  }
}

async function recordView(post) {
  if (!post || !post.id || !state.user) return;
  if (state.user.isAdmin) return;
  if (post.username === state.user.username) return;
  if (state.viewedThisSession.has(post.id)) return;
  state.viewedThisSession.add(post.id);
  const username = state.user.username;
  const lsKey = "madadgar_views_" + username;
  let viewedMap = {};
  try {
    viewedMap = JSON.parse(localStorage.getItem(lsKey) || "{}");
  } catch {}
  if (viewedMap[post.id]) return;
  viewedMap[post.id] = 1;
  localStorage.setItem(lsKey, JSON.stringify(viewedMap));
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
    console.warn("View record failed:", err.message);
  }
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

async function toggleBlockUser(username, currentlyBlocked) {
  await db.ref("users/" + username).update({ blocked: !currentlyBlocked });
}

/* ----------------------------- Renders ----------------------------- */

// FIX: postCardHTML now correctly builds and RETURNS the HTML string.
// Previously ALL content was inside `if (post.done)` so non-done posts
// returned undefined. Also removed the stray `list.innerHTML += inner`
// and the orphaned `});` that broke the function entirely.
function postCardHTML(post, opts = {}) {
  const isWorker = post.type === "job_seeker";
  const tagClass = isWorker ? "worker" : "employer";
  const tagText  = isWorker ? "ðŸ‘¤ Worker Profile" : "ðŸ’¼ Job Post";
  const ownerName = post.ownerName || "";

  let inner = `<div class="post-card">
    <div class="post-tags">
      <span class="tag ${tagClass}">${tagText}</span>
      ${post.verified ? '<span class="tag worker">âœ“ Verified</span>' : ""}
    </div>`;

  if (post.done) {
    inner += `<div class="done-badge">âœ“ ALHAMDULILLAH! KAAM HO GAYA</div>`;
  }

  if (post.category) {
    inner += `<div class="post-row bold"><span class="ic">ðŸ› ï¸</span><span>${escapeHtml(post.category)}</span></div>`;
  }

  if (post.salary) {
    inner += `<div class="post-row"><span class="ic">ðŸ’°</span><span>${escapeHtml(post.salary)}</span></div>`;
  }

  inner += `<div class="post-row"><span class="ic">ðŸ“</span><span>${escapeHtml(post.address || "")}</span></div>`;

  if (ownerName) {
    inner += `<div class="post-row"><span class="ic">ðŸ‘¤</span><span>${escapeHtml(ownerName)}</span></div>`;
  }

  inner += `<div class="post-meta">${timeAgo(post.createdAt)} â€¢ ${post.viewCount || 0} views</div>`;

  const isOwner = state.user && post.username === state.user.username;

  if (opts.adminMode) {
    const resetBtn = post.done
      ? `<button class="action-btn reset" data-act="reset-done" data-id="${post.id}">Reset</button>`
      : "";
    inner += `
      <div class="post-actions">
        ${resetBtn}
        <button class="action-btn edit-post-btn" data-act="edit-post" data-id="${post.id}">Edit</button>
        <button class="action-btn delete" data-act="delete-post" data-id="${post.id}">Delete</button>
      </div>`;
  } else if (isOwner) {
    const doneBtn = post.done
      ? ""
      : `<button class="action-btn done" data-act="mark-done" data-id="${post.id}">âœ“ Mark as Done</button>`;
    const deleteBtn = opts.myMode
      ? `<button class="action-btn delete" data-act="delete-mine" data-id="${post.id}">Delete</button>`
      : "";
    inner += `
      <div class="post-actions">
        ${doneBtn}
        <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}">ðŸ“ž Call</button>
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
        ? `<button class="action-btn report" disabled style="opacity:.5;cursor:default">Reported</button>`
        : `<button class="action-btn report" data-act="report-post" data-id="${post.id}">âš ï¸ Report</button>`;

      inner += `
        <div class="post-actions" style="display:flex;flex-direction:column;gap:5px;">
          <button type="button" class="action-btn"
            onclick="openChatWithUser('${escapeHtml(post.username || 'test_user')}','${escapeHtml(post.ownerName || 'User')}','')"
            style="background-color:#007bff;color:white;">ðŸ’¬ Chat</button>
          <div style="display:flex;gap:5px;width:100%;">
            <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}" style="flex:1;">ðŸ“ž Call</button>
            <div style="flex:1;">${reportBtn}</div>
          </div>
        </div>`;
    }
  }

  inner += `</div>`;
  return inner;  // FIX: always return the built string
}

// FIX: `list` variable was never declared â€” added the querySelector
function renderHome() {
  const list = $("#posts-list") || $("#home-posts-list");
  if (!list) return;

  if (!state.postsLoaded) {
    list.innerHTML = `
      <div class="loading-block">
        <div class="spinner"></div>
        <p class="muted small">Madadgar App loading...</p>
      </div>`;
    return;
  }

  const filtered = state.posts.filter((p) => {
    const matchesType =
      state.filter === "find_jobs" ? p.type === "employer" : p.type === "job_seeker";
    if (!matchesType) return false;
    if (state.addressSearch && !(p.address || "").toLowerCase().includes(state.addressSearch.toLowerCase()))
      return false;
    if (state.categorySearch && !(p.category || "").toLowerCase().includes(state.categorySearch.toLowerCase()))
      return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-block">
        <div class="big">${state.filter === "find_jobs" ? "ðŸ’¼" : "ðŸ‘¥"}</div>
        <div class="title">${
          state.addressSearch || state.categorySearch
            ? "Kuch nahi mila"
            : state.filter === "find_jobs"
            ? "Abhi koi kaam nahi hai"
            : "Abhi koi worker nahi hai"
        }</div>
        <p>${
          state.addressSearch || state.categorySearch
            ? "Apna search badlein ya khali karein"
            : 'Pehle post karne ke liye neeche "+" button dabayein'
        }</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map((p) => postCardHTML(p)).join("");
  filtered.forEach((p) => recordView(p));
}

function renderHistory() {
  const list = $("#my-posts-list");
  if (!list) return;
  const mine = state.posts.filter(
    (p) => state.user && p.username === state.user.username
  );
  if (mine.length === 0) {
    list.innerHTML = `
      <div class="empty-block">
        <div class="big">ðŸ“­</div>
        <div class="title">Aap ne abhi koi post nahi ki</div>
        <p>Home pe wapas jaa kar "+" button dabayein</p>
      </div>`;
    return;
  }
  list.innerHTML = mine.map((p) => postCardHTML(p, { myMode: true })).join("");
}

function renderAdminStats() {
  const total    = state.users.length;
  const verified = state.users.filter((u) => u.emailVerified === true).length;
  const pending  = total - verified;

  const elSignups  = $("#stat-signups");
  const elVerified = $("#stat-verified");
  const elPending  = $("#stat-pending");
  if (elSignups)  elSignups.textContent  = total;
  if (elVerified) elVerified.textContent = verified;
  if (elPending)  elPending.textContent  = pending;

  const elUsers = $("#stat-users");
  if (elUsers) elUsers.textContent = total;
  if ($("#stat-posts")) $("#stat-posts").textContent = state.posts.length;
  const ss = $("#stat-success");
  if (ss) ss.textContent = state.successCount;
}

function showToast(msg, type = "success", duration = 3000) {
  const container = $("#toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("show"));
  });
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function handleShareApp() {
  const appUrl = "https://maharwazir363-code.github.io/MADADGAR-/";
  const shareText =
    "Salam! Agar aap ko kisi bhi kism ki madad chahiye ya aap kisi ki madad karna chahte hain, " +
    "toh abhi 'MADADGAR' app use karein: " + appUrl;

  if (navigator.share) {
    navigator.share({ title: "MADADGAR", text: shareText, url: appUrl }).catch(() => {});
  } else {
    navigator.clipboard.writeText(shareText)
      .then(() => showToast("âœ“ Link copy ho gaya!", "success"))
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = shareText;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        showToast("âœ“ Link copy ho gaya!", "success");
      });
  }
}

async function handleForgotPassword() {
  const email = $("#forgot-email").value.trim().toLowerCase();
  if (!email) {
    showError("forgot-error", "Email address daalen.");
    return;
  }
  const btn = $("#forgot-btn-text");
  btn.textContent = "Bhej rahe hain...";
  $("#forgot-submit").disabled = true;
  showError("forgot-error", "");
  try {
    await auth.sendPasswordResetEmail(email);
    $("#forgot-modal").hidden = true;
    $("#forgot-email").value = "";
    showToast("Password reset link sent! Please check your Gmail Inbox.", "success", 5000);
  } catch (err) {
    let msg = "Kuch masla aaya. Phir koshish karein.";
    if (err.code === "auth/user-not-found")
      msg = "Yeh email registered nahi hai.";
    else if (err.code === "auth/invalid-email")
      msg = "Sahi email format daalen. (maslan: abc@gmail.com)";
    else if (err.code === "auth/too-many-requests")
      msg = "Bahut zyada tries. Thodi der baad try karein.";
    showError("forgot-error", msg);
  } finally {
    btn.textContent = "Reset Link Bhejein";
    $("#forgot-submit").disabled = false;
  }
}

let _pendingReportId = null;

function handleReportPost(postId) {
  _pendingReportId = postId;
  if ($("#report-modal")) $("#report-modal").hidden = false;
}

async function submitReport() {
  const postId = _pendingReportId;
  _pendingReportId = null;
  if ($("#report-modal")) $("#report-modal").hidden = true;
  if (!postId) return;
  try {
    await db.ref("posts/" + postId).transaction((current) => {
      if (!current) return current;
      current.reportsCount = (current.reportsCount || 0) + 1;
      return current;
    });
    try {
      const key = "madadgar_reported_v1";
      const list = JSON.parse(localStorage.getItem(key) || "[]");
      if (!list.includes(postId)) {
        list.push(postId);
        localStorage.setItem(key, JSON.stringify(list));
      }
    } catch {}
    showToast("âš ï¸ Post report ho gaya. Admin review karega.", "info", 3500);
  } catch (err) {
    console.error("Report failed:", err);
    showToast("Report fail hua. Phir koshish karein.", "info");
  }
}

function renderReportedPosts() {
  const container = $("#reported-posts-list");
  if (!container) return;

  const reported = state.posts
    .filter((p) => (p.reportsCount || 0) >= 1)
    .sort((a, b) => (b.reportsCount || 0) - (a.reportsCount || 0));

  if (reported.length === 0) {
    container.innerHTML = `<div class="reported-empty muted small">Koi reported post nahi hai. âœ“</div>`;
    return;
  }

  container.innerHTML = reported
    .map((p) => {
      const title = escapeHtml(
        p.category || (p.type === "job_seeker" ? "Worker Profile" : "Job Post")
      );
      const meta = [p.address, p.username ? "@" + p.username : ""]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" â€¢ ");
      return `
      <div class="reported-post-item">
        <div class="reported-post-info">
          <div class="reported-post-title">${title}</div>
          <div class="reported-post-meta">${meta}</div>
        </div>
        <div class="report-count-tag">âš ï¸ ${p.reportsCount}</div>
        <button class="user-action-btn danger" data-act="delete-reported" data-id="${escapeHtml(p.id)}">ðŸ—‘ Delete</button>
      </div>`;
    })
    .join("");
}

function updateSuccessBar() {
  const sc = $("#success-count");
  if (sc) sc.textContent = state.successCount;
  const ss = $("#stat-success");
  if (ss) ss.textContent = state.successCount;
}

function renderAdminUsersTable() {
  const body = $("#users-table-body");
  if (!body) return;

  if (!state.usersLoaded) {
    body.innerHTML = `
      <div class="loading-block">
        <div class="spinner"></div>
        <p class="muted small">Users load ho rahe hain...</p>
      </div>`;
    return;
  }
  if (state.usersError) {
    body.innerHTML = `
      <div class="empty-block">
        <div class="big">âš ï¸</div>
        <div class="title">Users load nahi hue</div>
        <div class="muted small" style="margin-top:6px;word-break:break-all">${escapeHtml(state.usersError)}</div>
        <button class="btn btn-outline" style="margin-top:12px" onclick="retryLoadUsers()">â†º Phir Koshish Karein</button>
      </div>`;
    return;
  }
  if (state.users.length === 0) {
    body.innerHTML = `
      <div class="empty-block">
        <div class="big">ðŸ‘¥</div>
        <div class="title">Abhi koi user register nahi hai</div>
      </div>`;
    return;
  }

  const postCounts = {};
  state.posts.forEach((p) => {
    if (p.username) postCounts[p.username] = (postCounts[p.username] || 0) + 1;
  });

  // FIX: user-row click handled via delegated listener in attachEvents;
  // data-username is already on the row so clicking anywhere on it
  // (but not on the Delete button) navigates to the user detail screen.
  body.innerHTML = state.users
    .map((u) => {
      const count = postCounts[u.username] || 0;
      return `
      <div class="user-row" data-username="${escapeHtml(u.username)}" style="cursor:pointer;">
        <div class="user-name-col">
          <div class="user-name">${escapeHtml(u.fullName)}</div>
          <div class="user-handle">@${escapeHtml(u.username)}</div>
          ${u.blocked ? '<span class="blocked-tag">ðŸš« BLOCKED</span>' : ""}
          ${
            u.emailVerified === true
              ? '<span class="status-badge verified">âœ“ Verified</span>'
              : '<span class="status-badge pending">â³ Pending</span>'
          }
        </div>
        <div class="user-email">${escapeHtml(u.email || "â€”")}</div>
        <div class="user-posts-col"><div class="user-posts-num">${count}</div></div>
        <button class="user-action-btn danger" data-act="delete-user" data-username="${escapeHtml(u.username)}">
          ðŸ—‘ Delete
        </button>
      </div>`;
    })
    .join("");
}

// FIX: loadUserChatsInAdmin is now called AFTER container.innerHTML is set
// so that #admin-user-messages-container actually exists in the DOM.
function renderAdminUser() {
  if (!state.adminUserView) return;
  const username = state.adminUserView;
  const u = state.users.find((x) => x.username === username);
  const container = $("#admin-user-content");
  if (!container) return;

  if (!u) {
    container.innerHTML = `
      <div class="empty-block">
        <div class="big">âš ï¸</div>
        <div class="title">User nahi mila</div>
      </div>`;
    return;
  }

  const userPosts = state.posts.filter((p) => p.username === username);
  const initial   = (u.fullName || "U").charAt(0).toUpperCase();
  const joinedDate = u.createdAt
    ? new Date(u.createdAt).toLocaleDateString("en-PK", {
        day: "numeric", month: "short", year: "numeric",
      })
    : "-";

  // Render the full template first â€” then call loadUserChatsInAdmin
  container.innerHTML = `
    <div class="profile-card">
      <div class="avatar">${escapeHtml(initial)}</div>
      <div class="profile-info">
        <div class="profile-name">${escapeHtml(u.fullName)}</div>
        <div class="profile-handle">@${escapeHtml(u.username)}</div>
        <div class="profile-meta"><span class="ic">ðŸ“§</span>${u.email ? `<a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email)}</a>` : "-"}</div>
        <div class="profile-meta"><span class="ic">ðŸ“…</span><span class="muted">Joined ${joinedDate}</span></div>
        <div class="profile-meta"><span class="ic">ðŸ“</span><span class="bold" style="color:#007bff;font-weight:bold;">Total Posts: ${userPosts.length}</span></div>
        <div class="status-badge ${u.blocked ? "blocked" : "active"}">
          ${u.blocked ? "ðŸš« BLOCKED" : "âœ“ ACTIVE"}
        </div>
      </div>
    </div>

    <div style="margin:15px 0;">
      <button class="btn btn-outline"
        style="background:#25D366;color:white;border:none;width:100%;padding:12px;font-weight:bold;border-radius:8px;"
        onclick="openChatWithUser('${escapeHtml(u.username)}','${escapeHtml(u.fullName)}','')">
        ðŸ’¬ Chat With ${escapeHtml(u.fullName)}
      </button>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap;">
      <button class="user-action-btn"
        data-act="${u.blocked ? 'unblock-user' : 'block-user'}"
        data-username="${escapeHtml(u.username)}"
        style="background:${u.blocked ? '#28a745' : '#fd7e14'};color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;flex:1;">
        ${u.blocked ? "âœ… Unblock User" : "ðŸš« Block User"}
      </button>
      <button class="user-action-btn danger"
        data-act="delete-user"
        data-username="${escapeHtml(u.username)}"
        style="background:#dc3545;color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;flex:1;">
        ðŸ—‘ï¸ Delete User
      </button>
    </div>

    <div class="posts-header">Posts by ${escapeHtml(u.fullName)} (${userPosts.length})</div>
    <div class="posts-list">
      ${userPosts.length === 0
        ? `<div class="empty-block">
             <div class="big">ðŸ“­</div>
             <div class="title">Is user ne abhi koi post nahi ki</div>
           </div>`
        : userPosts.map((p) => postCardHTML(p, { adminMode: true })).join("")
      }
    </div>

    <div style="margin-top:20px;">
      <div style="font-weight:bold;font-size:15px;margin-bottom:8px;border-bottom:2px solid #eee;padding-bottom:6px;">
        ðŸ’¬ Chat Logs
      </div>
      <div id="admin-user-messages-container">
        <p style="color:#666;font-size:13px;">Chats scan ho rahi hain...</p>
      </div>
    </div>`;

  // FIX: call AFTER innerHTML is set so the container element exists
  loadUserChatsInAdmin(username);
}

function updateBottomHint() {
  const el = $("#bottom-hint");
  if (el) {
    el.textContent = state.user
      ? `Hi ${state.user.fullName || state.user.username}!`
      : "Hi!";
  }
  const mobileInput = $("#post-mobile-input");
  if (mobileInput && !state.editPostId) mobileInput.value = "";
  if ($("#menu-name")) $("#menu-name").textContent = state.user?.fullName || "â€”";
  if ($("#menu-sub")) $("#menu-sub").textContent = state.user ? "@" + state.user.username : "@â€”";
}

/* ----------------------------- Events ----------------------------- */
function attachEvents() {
  $("#form-login").addEventListener("submit", handleLogin);

  $("#signup-btn").addEventListener("click", handleSignup);
  if ($("#go-to-login-btn")) {
    $("#go-to-login-btn").addEventListener("click", () => {
      resetSignupUI();
      showScreen("login");
    });
  }

  $$(".eye-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = document.getElementById(btn.dataset.target);
      if (t) t.type = t.type === "password" ? "text" : "password";
    });
  });

  $("#go-signup").addEventListener("click", () => showScreen("signup"));
  $("#go-login").addEventListener("click", (e) => {
    e.preventDefault();
    resetSignupUI();
    showScreen("login");
  });
  if ($("#back-from-signup")) {
    $("#back-from-signup").addEventListener("click", () => {
      resetSignupUI();
      showScreen("login");
    });
  }

  $$(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      state.addressSearch = "";
      state.categorySearch = "";
      if ($("#search-address")) $("#search-address").value = "";
      if ($("#search-category")) $("#search-category").value = "";
      if ($("#category-search-wrap")) $("#category-search-wrap").style.display = "";
      renderHome();
    });
  });

  if ($("#search-address")) {
    $("#search-address").addEventListener("input", (e) => {
      state.addressSearch = e.target.value;
      $$(".clear-btn[data-clear='search-address']").forEach(
        (b) => (b.hidden = !e.target.value)
      );
      renderHome();
    });
  }
  if ($("#search-category")) {
    $("#search-category").addEventListener("input", (e) => {
      state.categorySearch = e.target.value;
      $$(".clear-btn[data-clear='search-category']").forEach(
        (b) => (b.hidden = !e.target.value)
      );
      renderHome();
    });
  }
  $$(".clear-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.clear;
      if ($("#" + id)) {
        $("#" + id).value = "";
        $("#" + id).dispatchEvent(new Event("input"));
      }
    });
  });

  if ($("#open-history")) {
    $("#open-history").addEventListener("click", () => {
      showScreen("history");
      renderHistory();
    });
  }
  if ($("#back-from-history")) {
    $("#back-from-history").addEventListener("click", () => showScreen("home"));
  }

  if ($("#open-menu")) {
    $("#open-menu").addEventListener("click", () => {
      if ($("#menu-backdrop")) $("#menu-backdrop").hidden = false;
    });
  }
  if ($("#menu-backdrop")) {
    $("#menu-backdrop").addEventListener("click", (e) => {
      if (e.target === $("#menu-backdrop")) $("#menu-backdrop").hidden = true;
    });
  }
  if ($("#menu-history")) {
    $("#menu-history").addEventListener("click", () => {
      if ($("#menu-backdrop")) $("#menu-backdrop").hidden = true;
      showScreen("history");
      renderHistory();
    });
  }
  if ($("#menu-logout")) {
    $("#menu-logout").addEventListener("click", () => {
      if ($("#menu-backdrop")) $("#menu-backdrop").hidden = true;
      logout();
    });
  }
  if ($("#menu-share")) {
    $("#menu-share").addEventListener("click", () => {
      if ($("#menu-backdrop")) $("#menu-backdrop").hidden = true;
      handleShareApp();
    });
  }

  if ($("#open-add-post")) {
    $("#open-add-post").addEventListener("click", () => {
      if (!state.user) return;
      resetAddPostForm();
      $("#add-post-modal").hidden = false;
    });
  }
  if ($("#close-add-post")) {
    $("#close-add-post").addEventListener("click", () => {
      $("#add-post-modal").hidden = true;
      resetAddPostForm();
    });
  }
  if ($("#edit-cancel-btn")) {
    $("#edit-cancel-btn").addEventListener("click", () => {
      $("#add-post-modal").hidden = true;
      resetAddPostForm();
    });
  }
  if ($("#add-post-modal")) {
    $("#add-post-modal").addEventListener("click", (e) => {
      if (e.target.id === "add-post-modal") {
        $("#add-post-modal").hidden = true;
        resetAddPostForm();
      }
    });
  }

  $$(".type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".type-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.postType = btn.dataset.type;
      if ($("#salary-field")) $("#salary-field").hidden = state.postType !== "employer";
    });
  });

  if ($("#post-category")) {
    $("#post-category").addEventListener("change", (e) => {
      if ($("#post-custom-category")) $("#post-custom-category").hidden = e.target.value !== "Other";
    });
  }

  if ($("#form-add-post")) {
    $("#form-add-post").addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("post-error", "");
      const cat = $("#post-category").value;
      const customCat = $("#post-custom-category").value.trim();
      let salary = $("#post-salary").value.trim();
      if (salary) {
        const stripped = salary.replace(/^rs\.?\s*/i, "").trim();
        salary = stripped ? "Rs. " + stripped : "";
      }
      const address = $("#post-address").value.trim();
      if (!cat)
        return showError("post-error", "Category select karein (Driver, Electrician, etc.)");
      if (cat === "Other" && !customCat)
        return showError("post-error", "Apni category ka naam likhein.");
      if (!address)
        return showError("post-error", "Address/Jagah daalna zaroori hai.");
      const mobile = $("#post-mobile-input").value.trim();
      if (!mobile)
        return showError("post-error", "Mobile number daalna zaroori hai.");

      const submit = $("#post-submit");
      submit.textContent = "SAVE HO RAHA HAI...";
      submit.disabled = true;
      try {
        if (state.editPostId) {
          await updatePostInFirebase(state.editPostId, {
            type: state.postType,
            category: cat === "Other" ? customCat : cat,
            salary: state.postType === "employer" ? salary : "",
            mobileNumber: mobile,
            address,
          });
        } else {
          await addPostToFirebase({
            type: state.postType,
            category: cat === "Other" ? customCat : cat,
            salary: state.postType === "employer" ? salary : "",
            mobileNumber: mobile,
            username: state.user.username,
            ownerName: state.user.fullName,
            address,
          });
        }
        $("#add-post-modal").hidden = true;
        resetAddPostForm();
      } catch (err) {
        console.error(err);
        showError("post-error", "Post save nahi hua. Phir koshish karein.");
      } finally {
        submit.textContent = state.editPostId ? "SAVE KAREIN" : "POST KAREIN";
        submit.disabled = false;
      }
    });
  }

  // Hidden admin gate: 5 quick taps on the login logo
  const loginLogo = document.querySelector("#screen-login .logo-box");
  if (loginLogo) {
    let clickCount = 0;
    let clickTimer = null;
    loginLogo.addEventListener("click", () => {
      clickCount++;
      clearTimeout(clickTimer);
      if (clickCount >= 5) {
        clickCount = 0;
        openAdminGate();
        return;
      }
      clickTimer = setTimeout(() => { clickCount = 0; }, 1500);
    });
  }

  if ($("#admin-gate-form")) {
    $("#admin-gate-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const pwd = $("#admin-gate-input").value;
      if (pwd === ADMIN_PASSWORD) {
        state.user = { username: "admin", fullName: "Super Admin", email: "", isAdmin: true };
        persistUser();
        closeAdminGate();
        enterApp();
      } else {
        closeAdminGate();
      }
    });
  }
  if ($("#admin-gate-backdrop")) {
    $("#admin-gate-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "admin-gate-backdrop") closeAdminGate();
    });
  }
  if ($("#admin-gate-cancel")) {
    $("#admin-gate-cancel").addEventListener("click", closeAdminGate);
  }

  if ($("#admin-logout")) $("#admin-logout").addEventListener("click", logout);
  if ($("#back-from-admin-user")) {
    $("#back-from-admin-user").addEventListener("click", () => {
      state.adminUserView = null;
      showScreen("admin");
    });
  }

  // Single delegated click handler for all data-act buttons + user-row clicks
  document.addEventListener("click", async (e) => {
    const target = e.target.closest("[data-act]");
    if (!target) {
      // Row click (not on any action button)
      const row = e.target.closest(".user-row");
      if (row && state.user?.isAdmin) {
        state.adminUserView = row.dataset.username;
        showScreen("admin-user");
        renderAdminUser();
      }
      return;
    }
    const act = target.dataset.act;

    if (act === "call") {
      const mobile = target.dataset.mobile;
      if (mobile) window.location.href = "tel:" + mobile;
      return;
    }
    if (act === "delete-user") {
      e.stopPropagation();
      const username = target.dataset.username;
      if (username) await deleteUser(username);
      return;
    }
    if (act === "block-user") {
      e.stopPropagation();
      const username = target.dataset.username;
      if (username && confirm(`Kya aap @${username} ko block karna chahte hain?`)) {
        await db.ref("users/" + username + "/blocked").set(true);
        showToast(`@${username} block ho gaya.`, "success");
      }
      return;
    }
    if (act === "unblock-user") {
      e.stopPropagation();
      const username = target.dataset.username;
      if (username && confirm(`Kya aap @${username} ko unblock karna chahte hain?`)) {
        await db.ref("users/" + username + "/blocked").set(false);
        showToast(`@${username} unblock ho gaya.`, "success");
      }
      return;
    }
    if (act === "edit-post") {
      e.stopPropagation();
      const id = target.dataset.id;
      const post = state.posts.find((p) => p.id === id);
      if (post) openEditPost(post);
      return;
    }
    if (act === "mark-done") {
      e.stopPropagation();
      const id = target.dataset.id;
      if (id) await markPostDone(id);
      return;
    }
    if (act === "reset-done") {
      e.stopPropagation();
      const id = target.dataset.id;
      if (id) await resetPostDone(id);
      return;
    }
    if (act === "delete-post" || act === "delete-mine") {
      const id = target.dataset.id;
      if (!id) return;
      if (!confirm("Pakka is post ko delete karna hai?")) return;
      try {
        await deletePostFromFirebase(id);
      } catch (err) {
        alert("Delete fail. Phir try karein.");
      }
      return;
    }
    if (act === "report-post") {
      e.stopPropagation();
      const id = target.dataset.id;
      if (id) handleReportPost(id);
      return;
    }
    if (act === "delete-reported") {
      e.stopPropagation();
      const id = target.dataset.id;
      if (!id) return;
      if (!confirm("Is reported post ko permanently delete karna hai?")) return;
      try {
        await deletePostFromFirebase(id);
        showToast("Post delete ho gaya.", "success");
      } catch (err) {
        alert("Delete fail. Phir try karein.");
      }
      return;
    }
  });

  if ($("#forgot-password-btn")) {
    $("#forgot-password-btn").addEventListener("click", () => {
      showError("forgot-error", "");
      if ($("#forgot-email")) $("#forgot-email").value = "";
      if ($("#forgot-modal")) $("#forgot-modal").hidden = false;
      setTimeout(() => { if ($("#forgot-email")) $("#forgot-email").focus(); }, 60);
    });
  }
  if ($("#forgot-cancel")) {
    $("#forgot-cancel").addEventListener("click", () => {
      if ($("#forgot-modal")) $("#forgot-modal").hidden = true;
    });
  }
  if ($("#forgot-submit")) {
    $("#forgot-submit").addEventListener("click", handleForgotPassword);
  }
  if ($("#forgot-email")) {
    $("#forgot-email").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); handleForgotPassword(); }
    });
  }
  if ($("#forgot-modal")) {
    $("#forgot-modal").addEventListener("click", (e) => {
      if (e.target === $("#forgot-modal")) $("#forgot-modal").hidden = true;
    });
  }

  if ($("#report-cancel")) {
    $("#report-cancel").addEventListener("click", () => {
      _pendingReportId = null;
      if ($("#report-modal")) $("#report-modal").hidden = true;
    });
  }
  if ($("#report-confirm-btn")) {
    $("#report-confirm-btn").addEventListener("click", () => submitReport());
  }
  if ($("#report-modal")) {
    $("#report-modal").addEventListener("click", (e) => {
      if (e.target === $("#report-modal")) {
        _pendingReportId = null;
        $("#report-modal").hidden = true;
      }
    });
  }
}

function resetAddPostForm() {
  state.postType = "job_seeker";
  $$(".type-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.type === "job_seeker")
  );
  if ($("#post-category")) $("#post-category").value = "";
  if ($("#post-custom-category")) {
    $("#post-custom-category").value = "";
    $("#post-custom-category").hidden = true;
  }
  if ($("#post-salary")) $("#post-salary").value = "";
  if ($("#salary-field")) $("#salary-field").hidden = true;
  if ($("#post-address")) $("#post-address").value = "";
  if ($("#post-mobile-input")) $("#post-mobile-input").value = "";
  state.editPostId = null;
  if ($("#post-modal-title")) $("#post-modal-title").textContent = "Naya Post Karein";
  if ($("#post-submit")) $("#post-submit").textContent = "POST KAREIN";
  if ($("#edit-cancel-btn")) $("#edit-cancel-btn").hidden = true;
  showError("post-error", "");
  updateBottomHint();
}

function openAdminGate() {
  const bd = $("#admin-gate-backdrop");
  const input = $("#admin-gate-input");
  if (!bd || !input) return;
  input.value = "";
  bd.hidden = false;
  setTimeout(() => input.focus(), 50);
}
function closeAdminGate() {
  if ($("#admin-gate-backdrop")) $("#admin-gate-backdrop").hidden = true;
  if ($("#admin-gate-input")) $("#admin-gate-input").value = "";
}

/* ----------------------------- Boot ----------------------------- */
function enterApp() {
  // FIX: setupUserPresence only called once here (removed from handleLogin)
  setupUserPresence();
  updateBottomHint();
  subscribeStats();
  if (state.user.isAdmin) {
    showScreen("admin");
    subscribePosts();
    subscribeUsers();
    renderAdminUsersTable();
    renderAdminStats();
    renderReportedPosts();
  } else {
    showScreen("home");
    subscribePosts();
    renderHome();
    updateSuccessBar();
    loadChatHistory();
    listenForChatNotifications();
  }
}

function init() {
  attachEvents();
  state.user = loadPersistedUser();
  if (state.user) {
    enterApp();
  } else {
    showScreen("login");
  }
  setTimeout(() => {
    const splash = $("#splash");
    if (splash) {
      splash.classList.add("hidden");
      setTimeout(() => splash.remove(), 300);
    }
  }, 100);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* ----------------------------- PWA ----------------------------- */
let deferredPrompt;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const topBar = document.getElementById("pwa-top-bar");
  if (topBar) topBar.style.display = "flex";
});

function openInstallModal() {
  const modal = document.getElementById("pwa-install-modal");
  if (modal) modal.style.display = "block";
}
function closeTopBar() {
  const topBar = document.getElementById("pwa-top-bar");
  if (topBar) topBar.style.display = "none";
}
function closeInstallModal() {
  const modal = document.getElementById("pwa-install-modal");
  if (modal) modal.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const installBtn = document.getElementById("pwa-install-btn");
  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      const btnText = document.getElementById("btn-text");
      if (btnText) btnText.innerText = "Downloading...";
      setTimeout(async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          console.log(`User choice: ${outcome}`);
          deferredPrompt = null;
        } else {
          window.location.href = "https://maharwazir363-code.github.io/MADADGAR-/app.apk";
        }
        if (btnText) btnText.innerText = "Install App";
        closeInstallModal();
      }, 1500);
    });
  }
});

/* ----------------------------- Profile ----------------------------- */
const profileFilePicker = document.getElementById("profile-file-picker");
if (profileFilePicker) {
  profileFilePicker.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const currentUserID = (state.user && state.user.username) ? state.user.username : "test_user";
      const myProfilePic = document.getElementById("my-profile-pic");
      if (myProfilePic) {
        const reader = new FileReader();
        reader.onload = function (event) {
          myProfilePic.src = event.target.result;
          myProfilePic.style.opacity = "0.5";
        };
        reader.readAsDataURL(file);
      }
      const storageRef = firebase.storage().ref("profile_pics/" + currentUserID + ".jpg");
      storageRef.put(file).then((snapshot) => {
        snapshot.ref.getDownloadURL().then((downloadURL) => {
          if (myProfilePic) {
            myProfilePic.src = downloadURL;
            myProfilePic.style.opacity = "1";
          }
          if (state.user) state.user.profilePic = downloadURL;
          persistUser();
          firebase.database().ref("users/" + currentUserID).update({ profilePic: downloadURL });
          alert("Profile picture kamyabi se upload ho gayi! ðŸ”¥");
        });
      }).catch((error) => {
        console.error(error);
        if (myProfilePic) myProfilePic.style.opacity = "1";
        alert("Upload karne mein koi masla aaya.");
      });
    }
  });
}

function openProfileModal() {
  const modal = document.getElementById("profile-modal");
  if (!modal) return;
  if (state.user) {
    const nameField   = document.getElementById("my-profile-name");
    const handleField = document.getElementById("my-profile-status");
    const picField    = document.getElementById("my-profile-pic");
    if (nameField)   nameField.innerText   = state.user.fullName || "MADADGAR User";
    if (handleField) handleField.innerText = "@" + (state.user.username || "username");
    if (state.user.profilePic && picField) picField.src = state.user.profilePic;
  }
  modal.style.display = "flex";
}

/* ----------------------------- Chat ----------------------------- */
let currentChatRoomID = "";

function openChatWithUser(receiverID, receiverName, receiverPic) {
  listenToUserPresence(receiverID);
  const currentUserID = (state.user && state.user.username) ? state.user.username : "test_user";
  if (currentUserID === receiverID) {
    alert("Aap apne aap ko message nahi bhej sakte!");
    return;
  }
  currentChatRoomID = currentUserID < receiverID
    ? currentUserID + "_" + receiverID
    : receiverID + "_" + currentUserID;

  state.activeChat = receiverID;

  const nameEl = document.getElementById("chat-user-name");
  const picEl  = document.getElementById("chat-user-pic");
  if (nameEl) nameEl.innerText = receiverName || "MADADGAR User";
  if (picEl)  picEl.src = receiverPic || "https://cdn-icons-png.flaticon.com/512/149/149071.png";

  const chatModal = document.getElementById("chat-modal");
  if (chatModal) chatModal.style.display = "flex";

  firebase.database().ref("chats/" + currentChatRoomID + "/messages").on("value", (snapshot) => {
    const messagesArea = document.getElementById("chat-messages-area");
    if (!messagesArea) return;
    messagesArea.innerHTML = "";
    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const msgData   = childSnapshot.val();
        const msgBubble = document.createElement("div");
        if (msgData.senderID === currentUserID) {
          msgBubble.style.cssText = "align-self:flex-end;background-color:#1E40AF;color:white;padding:10px 15px;border-radius:15px 15px 0px 15px;max-width:75%;word-wrap:break-word;font-size:14px;margin-bottom:5px;";
        } else {
          msgBubble.style.cssText = "align-self:flex-start;background-color:white;color:#333;padding:10px 15px;border-radius:15px 15px 15px 0px;max-width:75%;word-wrap:break-word;font-size:14px;margin-bottom:5px;";
        }
        msgBubble.innerText = msgData.text;
        messagesArea.appendChild(msgBubble);
      });
      messagesArea.scrollTop = messagesArea.scrollHeight;
    } else {
      messagesArea.innerHTML = "<p style='text-align:center;color:#999;font-size:13px;margin-top:20px;'>Abhi tak koi message nahi hai. Chat shuru karein!</p>";
    }
  });

  firebase.database().ref("chats/" + currentChatRoomID + "/unread/" + currentUserID).set(0);
}

function sendMessage() {
  const currentUserID       = (state.user && state.user.username) ? state.user.username : "test_user";
  const currentUserFullName = (state.user && state.user.fullName) ? state.user.fullName : "MADADGAR User";
  const currentUserPic      = (state.user && state.user.profilePic) ? state.user.profilePic : "";

  const inputField  = document.getElementById("chat-input-text");
  const messageText = inputField ? inputField.value.trim() : "";
  if (!messageText || !currentChatRoomID) return;

  const ids        = currentChatRoomID.split("_");
  const receiverID = ids[0] === currentUserID ? ids[1] : ids[0];

  const messageData = {
    senderID:  currentUserID,
    text:      messageText,
    timestamp: firebase.database.ServerValue.TIMESTAMP,
  };

  firebase.database().ref("chats/" + currentChatRoomID + "/messages").push(messageData).then(() => {
    if (inputField) inputField.value = "";
    firebase.database().ref("chat_rooms/" + currentChatRoomID).set({
      lastMessage: messageText,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      users: { [currentUserID]: true, [receiverID]: true },
      names: {
        [currentUserID]: currentUserFullName,
        [receiverID]: document.getElementById("chat-user-name")?.innerText || "",
      },
      pics: {
        [currentUserID]: currentUserPic,
        [receiverID]: document.getElementById("chat-user-pic")?.src || "",
      },
    });
    firebase.database().ref("chats/" + currentChatRoomID + "/unread/" + receiverID).transaction(
      (c) => (c || 0) + 1
    );
  });
}

// FIX: loadChatHistory defined only once (duplicate at line 1776 removed)
function loadChatHistory() {
  const currentUserID    = (state.user && state.user.username) ? state.user.username : "";
  const inboxContainer   = document.getElementById("inbox-messages-list");
  if (!inboxContainer) return;

  inboxContainer.innerHTML = `<p style="text-align:center;color:#888;padding:20px;">Chats load ho rahi hain...</p>`;

  db.ref("chats").on("value", (snapshot) => {
    inboxContainer.innerHTML = "";
    let hasChats = false;

    if (snapshot.exists()) {
      snapshot.forEach((chatRoom) => {
        const roomID = chatRoom.key;
        if (!roomID.includes(currentUserID)) return;

        hasChats = true;
        const chatData    = chatRoom.val();
        const otherUserID = roomID.replace(currentUserID, "").replace("_", "");

        let lastMessage = "No messages yet";
        if (chatData.messages) {
          const msgArray = Object.values(chatData.messages);
          if (msgArray.length > 0)
            lastMessage = msgArray[msgArray.length - 1].text || "Attachment/Image";
        }

        let unreadCount = 0;
        if (chatData.unread && chatData.unread[currentUserID])
          unreadCount = chatData.unread[currentUserID];

        const badgeHTML = unreadCount > 0
          ? `<span style="background:#25D366;color:white;border-radius:50%;padding:3px 8px;font-size:11px;font-weight:bold;">${unreadCount}</span>`
          : "";

        const nameSpanId = `inbox-name-${otherUserID}`;
        const chatRow    = document.createElement("div");
        chatRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid #eee;cursor:pointer;transition:background 0.2s;";
        chatRow.className = "inbox-chat-item";
        chatRow.onmouseover = () => { chatRow.style.backgroundColor = "#f9f9f9"; };
        chatRow.onmouseout  = () => { chatRow.style.backgroundColor = "white"; };
        chatRow.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;width:80%;">
            <div style="width:45px;height:45px;background-color:#075E54;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px;flex-shrink:0;">
              ${otherUserID.charAt(0).toUpperCase()}
            </div>
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">
              <h4 id="${nameSpanId}" style="margin:0 0 4px;font-size:15px;color:#333;font-weight:600;">${escapeHtml(otherUserID)}</h4>
              <p style="margin:0;font-size:13px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(lastMessage)}</p>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;">${badgeHTML}</div>`;

        chatRow.onclick = () => openChatWithUser(otherUserID, otherUserID, "");

        inboxContainer.appendChild(chatRow);

        db.ref("users/" + otherUserID).once("value").then((userSnap) => {
          if (userSnap.exists() && userSnap.val().fullName) {
            const nameEl = document.getElementById(nameSpanId);
            if (nameEl) nameEl.innerText = userSnap.val().fullName;
          }
        });
      });
    }

    if (!hasChats) {
      inboxContainer.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:#999;">
          <span style="font-size:40px;">ðŸ“­</span>
          <p style="margin-top:10px;font-size:14px;">Abhi tak koi chat maujood nahi hai.</p>
        </div>`;
    }
  });
}

function listenForChatNotifications() {
  const currentUserID = (state.user && state.user.username) ? state.user.username : "";
  if (!currentUserID) return;

  firebase.database().ref("chats").on("value", (snapshot) => {
    let totalUnread = 0;
    if (snapshot.exists()) {
      snapshot.forEach((room) => {
        const unreadData = room.child("unread").val();
        if (unreadData && unreadData[currentUserID])
          totalUnread += unreadData[currentUserID];
      });
    }
    const badge = document.getElementById("global-inbox-badge");
    if (badge) {
      if (totalUnread > 0) {
        badge.innerText = totalUnread;
        badge.style.display = "inline-block";
      } else {
        badge.style.display = "none";
      }
    }
  });
}

function openInboxScreen() {
  if (typeof showScreen === "function") showScreen("chat-history-screen");
  if (typeof loadChatHistory === "function") loadChatHistory();
}

function goBackToHome() {
  const historyScreen = document.getElementById("chat-history-screen");
  const homeScreen    = document.getElementById("screen-home");
  if (historyScreen) historyScreen.style.display = "none";
  if (homeScreen)    homeScreen.style.display = "block";
}

// FIX: loadUserChatsInAdmin defined only once (duplicate removed)
function loadUserChatsInAdmin(targetUserId) {
  const messagesContainer = document.getElementById("admin-user-messages-container");
  if (!messagesContainer) return;

  messagesContainer.innerHTML = `<p style="color:#666;font-size:13px;">Chats scan ho rahi hain...</p>`;

  firebase.database().ref("chats").once("value").then((snapshot) => {
    messagesContainer.innerHTML = "";
    let hasChats = false;

    if (snapshot.exists()) {
      snapshot.forEach((chatRoom) => {
        const roomId = chatRoom.key;
        const parts  = roomId.split("_");
        if (!parts.includes(targetUserId)) return;

        hasChats = true;
        const chatData    = chatRoom.val();
        const messages    = chatData.messages ? Object.values(chatData.messages) : [];
        const companionId = parts.find((p) => p !== targetUserId) || "unknown";

        messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        const chatBox = document.createElement("div");
        chatBox.style.cssText = "background:#f9f9f9;border:1px solid #ddd;border-radius:6px;padding:10px;margin-bottom:8px;";

        let chatHTML = `
          <div style="font-size:13px;font-weight:bold;color:#128C7E;margin-bottom:8px;border-bottom:1px dashed #ccc;padding-bottom:4px;">
            Chat Room: ${escapeHtml(targetUserId)} â‡† ${escapeHtml(companionId)}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;padding-right:5px;">`;

        if (messages.length === 0) {
          chatHTML += `<p style="color:#aaa;font-size:12px;">No messages in this room.</p>`;
        } else {
          messages.forEach((msg) => {
            const isSender   = msg.senderID === targetUserId;
            const label      = isSender ? escapeHtml(targetUserId) : escapeHtml(companionId);
            const color      = isSender ? "#075E54" : "#444";
            const timeStr    = msg.timestamp
              ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "";
            chatHTML += `
              <div style="font-size:12px;line-height:1.4;">
                <strong style="color:${color};">${label}:</strong>
                <span>${escapeHtml(msg.text || "")}</span>
                <span style="font-size:10px;color:#999;margin-left:5px;">${timeStr}</span>
              </div>`;
          });
        }

        chatHTML += `</div>`;
        chatBox.innerHTML = chatHTML;
        messagesContainer.appendChild(chatBox);
      });
    }

    if (!hasChats) {
      messagesContainer.innerHTML = `<p style="color:#999;font-size:13px;text-align:center;padding:10px;">Is user ne abhi tak kisi se koi chat nahi ki.</p>`;
    }
  }).catch((error) => {
    console.error("Admin chat loading error:", error);
    messagesContainer.innerHTML = `<p style="color:red;font-size:13px;">Data load karne me masla aaya hai.</p>`;
  });
}

/* ----------------------------- Presence ----------------------------- */
// FIX: setupUserPresence defined only once
function setupUserPresence() {
  const currentUserID = (state.user && state.user.username) ? state.user.username : "";
  if (!currentUserID) return;

  const userStatusRef = firebase.database().ref("/users/" + currentUserID + "/status");
  firebase.database().ref(".info/connected").on("value", (snapshot) => {
    if (snapshot.val() === false) return;
    userStatusRef.onDisconnect().set({
      state: "offline",
      last_changed: firebase.database.ServerValue.TIMESTAMP,
    }).then(() => {
      userStatusRef.set({
        state: "online",
        last_changed: firebase.database.ServerValue.TIMESTAMP,
      });
    });
  });
}

function listenToUserPresence(targetUserId) {
  const statusElement = document.getElementById("chat-user-status");
  if (!statusElement) return;

  firebase.database().ref("/users/" + targetUserId + "/status").on("value", (snapshot) => {
    if (!snapshot.exists()) {
      statusElement.innerText = "offline";
      statusElement.style.color = "#888";
      return;
    }
    const status = snapshot.val();
    if (status.state === "online") {
      statusElement.innerText = "online";
      statusElement.style.color = "#25D366";
    } else {
      statusElement.style.color = "#888";
      if (status.last_changed) {
        const timeString = new Date(status.last_changed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        statusElement.innerText = "last seen today at " + timeString;
      } else {
        statusElement.innerText = "offline";
      }
    }
  });
}

function closeChatModal() {
  const chatModal = document.getElementById("chat-modal");
  if (chatModal) chatModal.style.display = "none";

  // FIX: read activeChat BEFORE clearing it
  const receiverID = state.activeChat;
  state.activeChat = null;

  if (receiverID) {
    firebase.database().ref("/users/" + receiverID + "/status").off();
  }
  if (currentChatRoomID) {
    firebase.database().ref("chats/" + currentChatRoomID + "/messages").off();
    currentChatRoomID = "";
  }
}
