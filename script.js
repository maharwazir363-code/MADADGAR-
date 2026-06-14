/* ============================================================
   MADADGAR — Pure vanilla JS app (Firebase RTDB via compat SDK)
   Modified: New Auth Flow — Username/Password + Google, Security Questions
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

/* ─────────────────── Helpers ─────────────────── */
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

/* ─────────────────── SHA-256 Hash Utility ─────────────────── */
async function hashString(str) {
  const msgBuffer = new TextEncoder().encode(str.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ─────────────────── Google Auth Provider ─────────────────── */
function getGoogleProvider() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/* ─────────────────── Auth: Login ─────────────────── */
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

    const uid = cred.user.uid;
    await db.ref("uid_to_username/" + uid).set(cleanUsername);
    if (!data.uid) {
      await db.ref("users/" + cleanUsername + "/uid").set(uid);
    }

    state.user = {
      username: data.username || cleanUsername,
      fullName: data.fullName,
      email: data.email,
      uid,
      isAdmin: false,
    };
    persistUser();
    enterApp();
  } catch (err) {
    console.error("Login error:", err.code, err.message);
    showError("login-error", "Server tak nahi pohanche. Internet check karein.");
  } finally {
    btn.textContent = "LOGIN";
  }
}

/* ─────────────────── Auth: Google Login ─────────────────── */
async function handleGoogleLogin() {
  showError("login-error", "");
  const btn = $("#login-google-btn-text");
  if (btn) btn.textContent = "Intezaar karein...";
  const googleBtn = $("#login-google-btn");
  if (googleBtn) googleBtn.disabled = true;

  try {
    const result = await auth.signInWithPopup(getGoogleProvider());
    const uid = result.user.uid;

    // Look up username from uid reverse-index
    const snap = await db.ref("uid_to_username/" + uid).get();
    if (!snap.exists()) {
      await auth.signOut();
      return showError("login-error", "Koi account nahi mila. Pehle Sign Up karein.");
    }

    const username = snap.val();
    const userSnap = await db.ref("users/" + username).get();
    if (!userSnap.exists()) {
      await auth.signOut();
      return showError("login-error", "User data nahi mila. Admin se raabta karein.");
    }

    const data = userSnap.val();
    if (data.blocked) {
      await auth.signOut();
      return showError("login-error", "Aap ko admin ne block kar diya hai.");
    }

    state.user = {
      username: data.username || username,
      fullName: data.fullName,
      email: data.email || result.user.email,
      uid,
      isAdmin: false,
    };
    persistUser();
    enterApp();
  } catch (err) {
    console.error("Google login error:", err.code, err.message);
    if (err.code === "auth/popup-closed-by-user") {
      showError("login-error", "Google login cancel ho gaya.");
    } else if (err.code === "auth/popup-blocked") {
      showError("login-error", "Popup block ho gaya. Browser settings check karein.");
    } else {
      showError("login-error", "Google login fail hua. Phir koshish karein.");
    }
  } finally {
    if (btn) btn.textContent = "Google se Login";
    if (googleBtn) googleBtn.disabled = false;
  }
}

/* ─────────────────── Auth: Signup ─────────────────── */
async function handleSignup() {
  const fullName  = $("#signup-fullname").value.trim();
  const username  = safeUsername($("#signup-username").value);
  const password  = $("#signup-password").value;
  const confirmPw = $("#signup-confirm-password").value;
  const secAns1   = ($("#signup-sec-ans1").value || "").trim();
  const secAns2   = ($("#signup-sec-ans2").value || "").trim();

  showError("signup-error", "");

  if (!fullName)
    return showError("signup-error", "Apna naam likhein.");
  if (username.length < 3)
    return showError("signup-error", "Username chhota hai (kam az kam 3 letters).");
  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return showError("signup-error", "Username mein sirf letters, numbers, _ chalega.");
  if (password.length < 6)
    return showError("signup-error", "Password chhota hai (kam az kam 6 characters).");
  if (password !== confirmPw)
    return showError("signup-error", "Dono passwords match nahi karte.");
  if (!secAns1)
    return showError("signup-error", "Security Question 1 ka jawab daalein.");
  if (!secAns2)
    return showError("signup-error", "Security Question 2 ka jawab daalein.");

  const btn     = $("#signup-btn-text");
  const signBtn = $("#signup-btn");
  btn.textContent = "Google se verify ho raha hai...";
  signBtn.disabled = true;

  try {
    // Check username availability first
    const existing = await db.ref("users/" + username).get();
    if (existing.exists())
      return showError("signup-error", "Yeh username pehle se hai. Doosra try karein.");

    // Hash security answers
    const [hash1, hash2] = await Promise.all([
      hashString(secAns1),
      hashString(secAns2),
    ]);

    // Step 1: Google sign-in to get email + uid
    let googleResult;
    try {
      googleResult = await auth.signInWithPopup(getGoogleProvider());
    } catch (popupErr) {
      if (popupErr.code === "auth/popup-closed-by-user")
        return showError("signup-error", "Google login cancel ho gaya. Dobara try karein.");
      if (popupErr.code === "auth/popup-blocked")
        return showError("signup-error", "Popup block ho gaya. Browser settings check karein.");
      throw popupErr;
    }

    const googleEmail = googleResult.user.email;
    const googleUid   = googleResult.user.uid;

    // Check if this Google account is already registered
    const uidCheck = await db.ref("uid_to_username/" + googleUid).get();
    if (uidCheck.exists()) {
      await auth.signOut();
      return showError(
        "signup-error",
        "Yeh Google account pehle se registered hai. Login karein."
      );
    }

    // Step 2: Link email/password credential to Google account
    // so user can log in with username+password OR Google
    try {
      const emailCred = firebase.auth.EmailAuthProvider.credential(
        googleEmail,
        password
      );
      await googleResult.user.linkWithCredential(emailCred);
    } catch (linkErr) {
      // email/password link might fail if email already exists as separate account
      // In that case we just use Google auth only — still save the data
      console.warn("Email link warning:", linkErr.code, linkErr.message);
    }

    // Step 3: Write uid→username reverse-index
    await db.ref("uid_to_username/" + googleUid).set(username);

    // Step 4: Save user data with hashed security answers
    await db.ref("users/" + username).set({
      fullName,
      username,
      email: googleEmail,
      uid: googleUid,
      blocked: false,
      emailVerified: true,
      secQ1: "Aap ki favorite cricket team konsi hai?",
      secA1Hash: hash1,
      secQ2: "Aap ke bachpan ke best friend ka naam kya tha?",
      secA2Hash: hash2,
      createdAt: Date.now(),
    });

    // Sign out after registration (user must login manually)
    await auth.signOut();

    // Show success
    $("#signup-form").hidden = true;
    $("#signup-success-notice").hidden = false;

  } catch (err) {
    console.error("Signup error:", err.code, err.message);
    let msg = err.message || "Signup fail hua. Phir koshish karein.";
    if (err.code === "auth/email-already-in-use")
      msg = "Yeh Google email pehle se registered hai. Login karein.";
    else if (err.code === "auth/account-exists-with-different-credential")
      msg = "Yeh email pehle se kisi aur account se linked hai.";
    showError("signup-error", msg);
  } finally {
    btn.textContent = "Continue with Google";
    signBtn.disabled = false;
  }
}

function resetSignupUI() {
  $("#signup-form").hidden = false;
  $("#signup-success-notice").hidden = true;
  if ($("#signup-fullname"))          $("#signup-fullname").value = "";
  if ($("#signup-username"))          $("#signup-username").value = "";
  if ($("#signup-password"))          $("#signup-password").value = "";
  if ($("#signup-confirm-password"))  $("#signup-confirm-password").value = "";
  if ($("#signup-sec-ans1"))          $("#signup-sec-ans1").value = "";
  if ($("#signup-sec-ans2"))          $("#signup-sec-ans2").value = "";
  showError("signup-error", "");
}

/* ─────────────────── Auth: Forgot Password ─────────────────── */

// Step 1: Verify username + security answers
async function handleForgotVerify() {
  const username = safeUsername($("#forgot-username").value || "");
  const ans1     = ($("#forgot-ans1").value || "").trim();
  const ans2     = ($("#forgot-ans2").value || "").trim();

  showError("forgot-step1-error", "");

  if (!username)
    return showError("forgot-step1-error", "Username daalein.");
  if (!ans1)
    return showError("forgot-step1-error", "Pehle sawal ka jawab daalein.");
  if (!ans2)
    return showError("forgot-step1-error", "Doosre sawal ka jawab daalein.");

  const btn = $("#forgot-verify-btn-text");
  btn.textContent = "Verify ho raha hai...";
  $("#forgot-verify-btn").disabled = true;

  try {
    const snap = await db.ref("users/" + username).get();
    if (!snap.exists())
      return showError("forgot-step1-error", "Yeh username registered nahi hai.");

    const data = snap.val();
    if (data.blocked)
      return showError("forgot-step1-error", "Yeh account block hai.");

    // Hash the entered answers and compare
    const [hash1, hash2] = await Promise.all([
      hashString(ans1),
      hashString(ans2),
    ]);

    if (hash1 !== data.secA1Hash)
      return showError("forgot-step1-error", "Pehle sawal ka jawab ghalat hai.");
    if (hash2 !== data.secA2Hash)
      return showError("forgot-step1-error", "Doosre sawal ka jawab ghalat hai.");

    // Answers correct — show step 2
    // Store verified username temporarily
    window._forgotVerifiedUsername = username;
    window._forgotVerifiedEmail    = data.email;
    $("#forgot-step1").hidden = true;
    $("#forgot-step2").hidden = false;

  } catch (err) {
    console.error("Forgot verify error:", err);
    showError("forgot-step1-error", "Server error. Internet check karein.");
  } finally {
    btn.textContent = "JAWAB VERIFY KAREIN";
    $("#forgot-verify-btn").disabled = false;
  }
}

// Step 2: Google re-auth + set new password
async function handleForgotReset() {
  const newPw   = ($("#forgot-new-password").value || "").trim();
  const confirmPw = ($("#forgot-confirm-password").value || "").trim();

  showError("forgot-step2-error", "");

  if (newPw.length < 6)
    return showError("forgot-step2-error", "Password chhota hai (kam az kam 6 characters).");
  if (newPw !== confirmPw)
    return showError("forgot-step2-error", "Dono passwords match nahi karte.");

  const btn    = $("#forgot-reset-btn-text");
  const resetBtn = $("#forgot-reset-btn");
  btn.textContent = "Google se verify ho raha hai...";
  resetBtn.disabled = true;

  try {
    // Re-authenticate via Google popup
    let googleResult;
    try {
      googleResult = await auth.signInWithPopup(getGoogleProvider());
    } catch (popupErr) {
      if (popupErr.code === "auth/popup-closed-by-user")
        return showError("forgot-step2-error", "Google login cancel ho gaya. Dobara try karein.");
      if (popupErr.code === "auth/popup-blocked")
        return showError("forgot-step2-error", "Popup block ho gaya. Browser settings check karein.");
      throw popupErr;
    }

    // Confirm Google account matches the registered account
    if (
      window._forgotVerifiedEmail &&
      googleResult.user.email !== window._forgotVerifiedEmail
    ) {
      await auth.signOut();
      return showError(
        "forgot-step2-error",
        "Ghalat Google account use kiya. " +
          window._forgotVerifiedEmail + " wala account use karein."
      );
    }

    // Update password
    await googleResult.user.updatePassword(newPw);

    // Also try to update/link email/password credential
    try {
      const emailCred = firebase.auth.EmailAuthProvider.credential(
        googleResult.user.email,
        newPw
      );
      await googleResult.user.linkWithCredential(emailCred);
    } catch (linkErr) {
      // If already linked, we need to reauthenticate and update
      if (linkErr.code === "auth/provider-already-linked" ||
          linkErr.code === "auth/email-already-in-use") {
        // Password already linked — updatePassword above was enough
        console.info("Password credential already linked, updatePassword applied.");
      } else {
        console.warn("Link warning (non-critical):", linkErr.code);
      }
    }

    // Sign out after reset
    await auth.signOut();

    // Clean up
    window._forgotVerifiedUsername = null;
    window._forgotVerifiedEmail    = null;

    showToast("✅ Password reset ho gaya! Ab naya password se login karein.", "success", 5000);
    resetForgotUI();
    showScreen("login");

  } catch (err) {
    console.error("Forgot reset error:", err.code, err.message);
    let msg = "Password reset fail hua. Phir koshish karein.";
    if (err.code === "auth/requires-recent-login")
      msg = "Session expire ho gaya. Dobara Google se verify karein.";
    else if (err.code === "auth/weak-password")
      msg = "Password zyada secure hona chahiye (kam az kam 6 characters).";
    showError("forgot-step2-error", msg);
  } finally {
    btn.textContent = "Google se Verify & Password Reset";
    resetBtn.disabled = false;
  }
}

function resetForgotUI() {
  if ($("#forgot-username"))         $("#forgot-username").value = "";
  if ($("#forgot-ans1"))             $("#forgot-ans1").value = "";
  if ($("#forgot-ans2"))             $("#forgot-ans2").value = "";
  if ($("#forgot-new-password"))     $("#forgot-new-password").value = "";
  if ($("#forgot-confirm-password")) $("#forgot-confirm-password").value = "";
  showError("forgot-step1-error", "");
  showError("forgot-step2-error", "");
  if ($("#forgot-step1")) $("#forgot-step1").hidden = false;
  if ($("#forgot-step2")) $("#forgot-step2").hidden = true;
  window._forgotVerifiedUsername = null;
  window._forgotVerifiedEmail    = null;
}

function logout() {
  auth.signOut().catch(() => {});
  state.user = null;
  persistUser();
  db.ref("posts").off();
  db.ref("users").off();
  db.ref("stats/successCount").off();
  _closeChatListeners();
  if (_inboxListener)      { _inboxListener.off();      _inboxListener = null; }
  if (_unreadBadgeListener){ _unreadBadgeListener.off(); _unreadBadgeListener = null; }
  state.posts = [];
  state.users = [];
  state.successCount = 0;
  state.postsLoaded = false;
  state.usersLoaded = false;
  state.usersError = null;
  state.viewedThisSession = new Set();
  state.activeChat = null;
  showScreen("login");
  if ($("#login-username")) $("#login-username").value = "";
  if ($("#login-password")) $("#login-password").value = "";
}

/* ─────────────────── Posts ─────────────────── */
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

/* ─────────────────── Renders ─────────────────── */
function postCardHTML(post, opts = {}) {
  const isWorker = post.type === "job_seeker";
  const tagClass = isWorker ? "worker" : "employer";
  const tagText  = isWorker ? "👤 Worker Profile" : "💼 Job Post";
  const ownerName = post.ownerName || "";

  let inner = `<div class="post-card">
    <div class="post-tags">
      <span class="tag ${tagClass}">${tagText}</span>
      ${post.verified ? '<span class="tag worker">✓ Verified</span>' : ""}
    </div>`;

  if (post.done) {
    inner += `<div class="done-badge">✓ ALHAMDULILLAH! KAAM HO GAYA</div>`;
  }

  if (post.category) {
    inner += `<div class="post-row bold"><span class="ic">🛠️</span><span>${escapeHtml(post.category)}</span></div>`;
  }

  if (post.salary) {
    inner += `<div class="post-row"><span class="ic">💰</span><span>${escapeHtml(post.salary)}</span></div>`;
  }

  inner += `<div class="post-row"><span class="ic">📍</span><span>${escapeHtml(post.address || "")}</span></div>`;

  if (ownerName) {
    inner += `<div class="post-row"><span class="ic">👤</span><span>${escapeHtml(ownerName)}</span></div>`;
  }

  inner += `<div class="post-meta">${timeAgo(post.createdAt)} • ${post.viewCount || 0} views</div>`;

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
      : `<button class="action-btn done" data-act="mark-done" data-id="${post.id}">✓ Mark as Done</button>`;
    const deleteBtn = opts.myMode
      ? `<button class="action-btn delete" data-act="delete-mine" data-id="${post.id}">Delete</button>`
      : "";
    inner += `
      <div class="post-actions">
        ${doneBtn}
        <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}">📞 Call</button>
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
        : `<button class="action-btn report" data-act="report-post" data-id="${post.id}">⚠️ Report</button>`;

      inner += `
        <div class="post-actions" style="display:flex;flex-direction:column;gap:5px;">
          <button type="button" class="action-btn"
            onclick="openChatWithUser('${escapeHtml(post.username || 'test_user')}','${escapeHtml(post.ownerName || 'User')}','')"
            style="background-color:#007bff;color:white;">💬 Chat</button>
          <div style="display:flex;gap:5px;width:100%;">
            <button class="action-btn call" data-act="call" data-mobile="${escapeHtml(post.mobileNumber || '')}" style="flex:1;">📞 Call</button>
            <div style="flex:1;">${reportBtn}</div>
          </div>
        </div>`;
    }
  }

  inner += `</div>`;
  return inner;
}

function renderHome() {
  const list = $("#posts-list") || $("#home-posts-list");
  if (!list) return;

  if (!state.postsLoaded) {
    list.innerHTML = _skeletonPostCards(3);
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
        <div class="big">${state.filter === "find_jobs" ? "💼" : "👥"}</div>
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
        <div class="big">📭</div>
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
      .then(() => showToast("✓ Link copy ho gaya!", "success"))
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = shareText;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        showToast("✓ Link copy ho gaya!", "success");
      });
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
    showToast("⚠️ Post report ho gaya. Admin review karega.", "info", 3500);
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
    container.innerHTML = `<div class="reported-empty muted small">Koi reported post nahi hai. ✓</div>`;
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
        .join(" • ");
      return `
      <div class="reported-post-item">
        <div class="reported-post-info">
          <div class="reported-post-title">${title}</div>
          <div class="reported-post-meta">${meta}</div>
        </div>
        <div class="report-count-tag">⚠️ ${p.reportsCount}</div>
        <button class="user-action-btn danger" data-act="delete-reported" data-id="${escapeHtml(p.id)}">🗑 Delete</button>
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
    body.innerHTML = _skeletonUserRows(4);
    return;
  }
  if (state.usersError) {
    body.innerHTML = `
      <div class="empty-block">
        <div class="big">⚠️</div>
        <div class="title">Users load nahi hue</div>
        <div class="muted small" style="margin-top:6px;word-break:break-all">${escapeHtml(state.usersError)}</div>
        <button class="btn btn-outline" style="margin-top:12px" onclick="retryLoadUsers()">↺ Phir Koshish Karein</button>
      </div>`;
    return;
  }
  if (state.users.length === 0) {
    body.innerHTML = `
      <div class="empty-block">
        <div class="big">👥</div>
        <div class="title">Abhi koi user register nahi hai</div>
      </div>`;
    return;
  }

  const postCounts = {};
  state.posts.forEach((p) => {
    if (p.username) postCounts[p.username] = (postCounts[p.username] || 0) + 1;
  });

  body.innerHTML = state.users
    .map((u) => {
      const count = postCounts[u.username] || 0;
      return `
      <div class="user-row" data-username="${escapeHtml(u.username)}" style="cursor:pointer;">
        <div class="user-name-col">
          <div class="user-name">${escapeHtml(u.fullName)}</div>
          <div class="user-handle">@${escapeHtml(u.username)}</div>
          ${u.blocked ? '<span class="blocked-tag">🚫 BLOCKED</span>' : ""}
        </div>
        <div class="user-email">${escapeHtml(u.email || "—")}</div>
        <div class="user-posts-col"><div class="user-posts-num">${count}</div></div>
        <button class="user-action-btn danger" data-act="delete-user" data-username="${escapeHtml(u.username)}">
          🗑 Delete
        </button>
      </div>`;
    })
    .join("");
}

function renderAdminUser() {
  if (!state.adminUserView) return;
  const username = state.adminUserView;
  const u = state.users.find((x) => x.username === username);
  const container = $("#admin-user-content");
  if (!container) return;

  if (!u) {
    container.innerHTML = `
      <div class="empty-block">
        <div class="big">⚠️</div>
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

  document.querySelectorAll("#admin-chat-history-card").forEach((el) => el.remove());

  container.innerHTML = `
    <div class="profile-card">
      <div class="avatar">${escapeHtml(initial)}</div>
      <div class="profile-info">
        <div class="profile-name">${escapeHtml(u.fullName)}</div>
        <div class="profile-handle">@${escapeHtml(u.username)}</div>
        <div class="profile-meta"><span class="ic">📧</span>${u.email ? `<a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email)}</a>` : "-"}</div>
        <div class="profile-meta"><span class="ic">📅</span><span class="muted">Joined ${joinedDate}</span></div>
        <div class="profile-meta"><span class="ic">📝</span><span class="bold" style="color:#007bff;font-weight:bold;">Total Posts: ${userPosts.length}</span></div>
        <div class="status-badge ${u.blocked ? "blocked" : "active"}">
          ${u.blocked ? "🚫 BLOCKED" : "✓ ACTIVE"}
        </div>
      </div>
    </div>

    <div style="margin:15px 0;">
      <button class="btn btn-outline"
        style="background:#25D366;color:white;border:none;width:100%;padding:12px;font-weight:bold;border-radius:8px;"
        onclick="openChatWithUser('${escapeHtml(u.username)}','${escapeHtml(u.fullName)}','')">
        💬 Chat With ${escapeHtml(u.fullName)}
      </button>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap;">
      <button class="user-action-btn"
        data-act="${u.blocked ? 'unblock-user' : 'block-user'}"
        data-username="${escapeHtml(u.username)}"
        style="background:${u.blocked ? '#28a745' : '#fd7e14'};color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;flex:1;">
        ${u.blocked ? "✅ Unblock User" : "🚫 Block User"}
      </button>
      <button class="user-action-btn danger"
        data-act="delete-user"
        data-username="${escapeHtml(u.username)}"
        style="background:#dc3545;color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;flex:1;">
        🗑️ Delete User
      </button>
    </div>

    <div class="posts-header">Posts by ${escapeHtml(u.fullName)} (${userPosts.length})</div>
    <div class="posts-list">
      ${userPosts.length === 0
        ? `<div class="empty-block">
             <div class="big">📭</div>
             <div class="title">Is user ne abhi koi post nahi ki</div>
           </div>`
        : userPosts.map((p) => postCardHTML(p, { adminMode: true })).join("")
      }
    </div>

    <div id="admin-chat-history-card" style="
        margin: 15px 0;
        background: #fff;
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        border-top: 4px solid #075E54;">
      <h3 style="margin-top: 0; color: #075E54; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
        📋 User Chat History (Admin View)
      </h3>
      <div id="admin-user-messages-container" style="max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 0; padding: 0;">
        <p style="color: #888; font-style: italic; font-size: 13px; padding: 8px;">⏳ Chat history load ho rahi hai...</p>
      </div>
    </div>`;

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
  if ($("#menu-name")) $("#menu-name").textContent = state.user?.fullName || "—";
  if ($("#menu-sub")) $("#menu-sub").textContent = state.user ? "@" + state.user.username : "@—";
}

/* ─────────────────── Events ─────────────────── */
function attachEvents() {
  // Login form
  if ($("#form-login")) $("#form-login").addEventListener("submit", handleLogin);

  // Google login button
  if ($("#login-google-btn")) {
    $("#login-google-btn").addEventListener("click", handleGoogleLogin);
  }

  // Signup button (Continue with Google)
  if ($("#signup-btn")) $("#signup-btn").addEventListener("click", handleSignup);

  if ($("#go-to-login-btn")) {
    $("#go-to-login-btn").addEventListener("click", () => {
      resetSignupUI();
      showScreen("login");
    });
  }

  // Eye buttons (password visibility toggle) — includes new fields
  $$(".eye-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = document.getElementById(btn.dataset.target);
      if (t) t.type = t.type === "password" ? "text" : "password";
    });
  });

  if ($("#go-signup")) $("#go-signup").addEventListener("click", () => showScreen("signup"));
  if ($("#go-login")) {
    $("#go-login").addEventListener("click", (e) => {
      e.preventDefault();
      resetSignupUI();
      showScreen("login");
    });
  }
  if ($("#back-from-signup")) {
    $("#back-from-signup").addEventListener("click", () => {
      resetSignupUI();
      showScreen("login");
    });
  }

  // Forgot password — open screen instead of modal
  if ($("#forgot-password-btn")) {
    $("#forgot-password-btn").addEventListener("click", () => {
      resetForgotUI();
      showScreen("forgot");
    });
  }
  if ($("#back-from-forgot")) {
    $("#back-from-forgot").addEventListener("click", () => {
      resetForgotUI();
      showScreen("login");
    });
  }
  if ($("#forgot-verify-btn")) {
    $("#forgot-verify-btn").addEventListener("click", handleForgotVerify);
  }
  if ($("#forgot-reset-btn")) {
    $("#forgot-reset-btn").addEventListener("click", handleForgotReset);
  }

  // Filter buttons
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

  // Hidden admin gate: 5 quick taps on login logo
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
        _showWelcomeOverlay(() => {
          auth.signInAnonymously()
            .catch(() => {
              console.warn("Anonymous auth unavailable — enable it in Firebase Console → Authentication → Sign-in providers → Anonymous.");
            })
            .finally(() => enterApp());
        });
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

/* ── Welcome overlay ─────────────────────────────── */
function _showWelcomeOverlay(onDone) {
  const ov = document.createElement("div");
  ov.id = "_admin-welcome-ov";
  ov.style.cssText = [
    "position:fixed","inset:0","z-index:99998",
    "display:flex","flex-direction:column",
    "align-items:center","justify-content:center","gap:32px",
    "background:linear-gradient(160deg,#050a14 0%,#0f172a 45%,#1a3054 100%)",
    "opacity:0","transition:opacity 0.65s ease",
    "padding:40px 28px","text-align:center","overflow:hidden",
  ].join(";");

  ov.innerHTML = `
    <div style="position:absolute;inset:0;pointer-events:none;">
      <div style="position:absolute;top:-30%;left:50%;transform:translateX(-50%);width:520px;height:520px;background:radial-gradient(circle,rgba(251,191,36,0.09) 0%,transparent 68%);border-radius:50%;"></div>
      <div style="position:absolute;bottom:-20%;right:-10%;width:300px;height:300px;background:radial-gradient(circle,rgba(30,64,175,0.15) 0%,transparent 70%);border-radius:50%;"></div>
    </div>
    <div style="font-size:clamp(17px,4.2vw,32px);font-weight:900;letter-spacing:2.5px;line-height:1.3;background:linear-gradient(135deg,#fbbf24 0%,#ffffff 55%,#fde68a 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 0 18px rgba(251,191,36,0.5));padding:0 12px;position:relative;z-index:1;">WELCOME<br>MAHAR SHOAIB<br><span style='font-size:0.62em;letter-spacing:5px;'>THE KING OF TECHNOLOGY</span></div>
    <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:0;">
      <img id="_welcome-pic" src="Shoaib.jpg" alt="Mahar Shoaib" style="width:116px;height:116px;border-radius:50%;object-fit:cover;display:block;border:2.5px solid rgba(251,191,36,0.8);box-shadow:0 0 0 6px rgba(251,191,36,0.12),0 10px 32px rgba(0,0,0,0.55),0 0 48px rgba(251,191,36,0.2);flex-shrink:0;" onerror="this.style.display='none';document.getElementById('_welcome-fb').style.display='flex';">
      <div id="_welcome-fb" style="display:none;width:116px;height:116px;border-radius:50%;background:linear-gradient(135deg,#1e3a8a,#1e40af);border:2.5px solid rgba(251,191,36,0.8);box-shadow:0 0 0 6px rgba(251,191,36,0.12),0 10px 32px rgba(0,0,0,0.55);align-items:center;justify-content:center;font-size:46px;flex-shrink:0;">🛡️</div>
    </div>`;

  document.body.appendChild(ov);
  requestAnimationFrame(() => requestAnimationFrame(() => { ov.style.opacity = "1"; }));
  setTimeout(() => {
    ov.style.opacity = "0";
    setTimeout(() => { ov.remove(); onDone(); }, 700);
  }, 5000);
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

/* ─────────────────── Boot ─────────────────── */
function enterApp() {
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
    listenForChatNotifications();
  }
}

/* ── Dark mode ─────────────────────────────── */
function initDarkMode() {
  const saved = localStorage.getItem("madadgar_theme") || "light";
  const btn   = document.getElementById("theme-toggle-btn");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
    localStorage.setItem("madadgar_theme", theme);
  }

  applyTheme(saved);

  if (btn) {
    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(cur === "dark" ? "light" : "dark");
    });
  }
}

/* ── Skeleton loaders ──────────────────────── */
function _skeletonPostCards(n) {
  n = n || 3;
  return Array.from({ length: n }, () => `
    <div class="skel-card">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <div class="skel" style="width:70px;height:10px;"></div>
        <div class="skel" style="width:50px;height:10px;"></div>
      </div>
      <div class="skel skel-line lg" style="width:85%;"></div>
      <div class="skel skel-line" style="width:65%;"></div>
      <div class="skel skel-line" style="width:75%;"></div>
      <div class="skel-actions">
        <div class="skel skel-btn"></div>
        <div class="skel skel-btn"></div>
        <div class="skel skel-btn"></div>
      </div>
    </div>`).join("");
}

function _skeletonUserRows(n) {
  n = n || 4;
  return Array.from({ length: n }, () => `
    <div class="skel-row">
      <div class="skel skel-avatar"></div>
      <div class="skel-row-body">
        <div class="skel skel-row-line" style="width:60%;"></div>
        <div class="skel skel-row-line"></div>
      </div>
      <div class="skel" style="width:36px;height:20px;flex-shrink:0;border-radius:6px;"></div>
      <div class="skel skel-btn" style="width:72px;flex-shrink:0;border-radius:8px;"></div>
    </div>`).join("");
}

function init() {
  initDarkMode();
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

/* ─────────────────── PWA ─────────────────── */
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

/* ─────────────────── Profile ─────────────────── */
const profileFilePicker = document.getElementById("profile-file-picker");
if (profileFilePicker) {
  profileFilePicker.addEventListener("change", async function (e) {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    const currentUserID = (state.user && state.user.username) ? state.user.username : "test_user";
    const myProfilePic = document.getElementById("my-profile-pic");

    if (myProfilePic) {
      const previewReader = new FileReader();
      previewReader.onload = (ev) => {
        myProfilePic.src = ev.target.result;
        myProfilePic.style.opacity = "0.5";
      };
      previewReader.readAsDataURL(file);
    }

    try {
      const base64 = await _resizeImageToBase64(file, 300, 0.80);
      if (myProfilePic) {
        myProfilePic.src = base64;
        myProfilePic.style.opacity = "1";
      }
      if (state.user) state.user.profilePic = base64;
      persistUser();
      await firebase.database().ref("users/" + currentUserID).update({ profilePic: base64 });
      showToast("Profile picture update ho gayi! ✅", "success");
    } catch (err) {
      console.error("Profile pic error:", err);
      if (myProfilePic) myProfilePic.style.opacity = "1";
      showToast("Upload mein masla aaya. Phir try karein.", "error");
    }
    e.target.value = "";
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

/* =====================================================================
   CHAT SYSTEM — Real-time Firebase chat with blue ticks & timestamps
   ===================================================================== */

let _chatRoomID          = "";
let _chatMsgListener     = null;
let _presenceListener    = null;
let _inboxListener       = null;
let _unreadBadgeListener = null;
let _adminThreadRef      = null;
let _typingTimer         = null;
let _typingRef           = null;
let _typingListenerRef   = null;
let _mediaRecorder       = null;
let _audioChunks         = [];
let _isRecording         = false;
let _recTimerInterval    = null;

function _roomId(a, b) { return a < b ? a + "_" + b : b + "_" + a; }

function formatChatTime(ts) {
  if (!ts) return "";
  const now      = new Date();
  const date     = new Date(ts);
  const diffDays = Math.floor((now - date) / 86400000);
  if (diffDays === 0) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)  return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function openChatWithUser(receiverID, receiverName, receiverPic) {
  if (!state.user || !receiverID) return;
  const me = state.user.username;
  if (me === receiverID) { alert("Aap apne aap ko message nahi bhej sakte!"); return; }

  _closeChatListeners();

  _chatRoomID      = _roomId(me, receiverID);
  state.activeChat = receiverID;

  const nameEl   = document.getElementById("chat-user-name");
  const picEl    = document.getElementById("chat-user-pic");
  const statusEl = document.getElementById("chat-user-status");
  if (nameEl)   nameEl.innerText = receiverName || receiverID;
  if (picEl)    picEl.src = receiverPic || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
  if (statusEl) { statusEl.innerText = ""; statusEl.style.color = "#888"; }

  const modal = document.getElementById("chat-modal");
  if (modal) modal.style.display = "flex";

  const area = document.getElementById("chat-messages-area");
  if (area) area.innerHTML = `<p style="text-align:center;color:#999;font-size:13px;padding:20px;">Messages load ho rahi hain...</p>`;

  const msgsRef = db.ref("chats/" + _chatRoomID);
  _chatMsgListener = msgsRef;

  msgsRef.on("child_added", (snap) => {
    _appendBubble(snap.key, snap.val(), me);
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
  });

  msgsRef.on("child_changed", (snap) => {
    const msg = snap.val();
    if (!msg || msg.senderID !== me) return;
    const el = document.getElementById("tick-" + snap.key);
    if (el && msg.seen) { el.textContent = "✓✓"; el.style.color = "#60A5FA"; }
  });

  _markSeen(_chatRoomID, me);
  db.ref("chat_rooms/" + _chatRoomID + "/unread/" + me).set(0).catch(() => {});
  _listenToPresence(receiverID);
  _ensureChatInputUI();
  _listenTyping(_chatRoomID, me, receiverID);
}

function _bubbleContent(msg, isMine) {
  const type = msg.type || "text";

  if (type === "audio") {
    return `<audio controls src="${escapeHtml(msg.audioUrl || "")}" style="max-width:230px;outline:none;border-radius:8px;display:block;"></audio>`;
  }

  if (type === "location") {
    const url = msg.locationUrl || "#";
    const bg  = isMine ? "rgba(255,255,255,0.15)" : "#EFF6FF";
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${bg};border-radius:8px;text-decoration:none;color:${isMine ? "#fff" : "#1E40AF"};"><span style="font-size:22px;">📍</span><span style="font-size:13px;font-weight:600;">View Location on Map</span></a>`;
  }

  if (type === "image") {
    return `<img src="${escapeHtml(msg.fileUrl || "")}" alt="Image" style="max-width:220px;max-height:220px;border-radius:8px;cursor:pointer;display:block;object-fit:cover;" onclick="_openImageFullscreen(this.src)" onerror="this.style.display='none'">`;
  }

  if (type === "document") {
    const bg   = isMine ? "rgba(255,255,255,0.15)" : "#EFF6FF";
    const col  = isMine ? "#fff" : "#111";
    const link = isMine ? "#9EC5FE" : "#1E40AF";
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:${bg};border-radius:8px;"><span style="font-size:26px;">📄</span><div style="min-width:0;"><div style="font-size:12px;font-weight:600;color:${col};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;">${escapeHtml(msg.fileName || "Document")}</div><a href="${escapeHtml(msg.fileUrl || "")}" target="_blank" download="${escapeHtml(msg.fileName || "file")}" style="font-size:11px;color:${link};font-weight:600;text-decoration:none;">⬇ Download</a></div></div>`;
  }

  return escapeHtml(msg.text || "");
}

function _appendBubble(key, msg, myID) {
  const area = document.getElementById("chat-messages-area");
  if (!area) return;
  const ph = area.querySelector("p");
  if (ph) ph.remove();

  const isMine  = msg.senderID === myID;
  const timeStr = formatChatTime(msg.timestamp);
  const tick    = isMine
    ? `<span id="tick-${key}" style="font-size:10px;margin-left:4px;color:${msg.seen ? "#60A5FA" : "#aaa"};">${msg.seen ? "✓✓" : "✓"}</span>`
    : "";
  const type    = msg.type || "text";
  const pad     = (type === "image") ? "4px" : "8px 12px";
  const radius  = isMine ? "14px 14px 0 14px" : "14px 14px 14px 0";

  const w = document.createElement("div");
  w.style.cssText = `display:flex;flex-direction:column;align-items:${isMine ? "flex-end" : "flex-start"};margin-bottom:6px;`;
  w.innerHTML = `
    <div style="background:${isMine ? "#1E40AF" : "#ffffff"};color:${isMine ? "#fff" : "#111"};padding:${pad};border-radius:${radius};max-width:75%;word-wrap:break-word;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,0.1);overflow:hidden;">
      ${_bubbleContent(msg, isMine)}
    </div>
    <div style="font-size:10px;color:#999;margin-top:2px;">${timeStr}${tick}</div>`;
  area.appendChild(w);
}

function _markSeen(roomId, myID) {
  db.ref("chats/" + roomId).once("value").then((snap) => {
    if (!snap.exists()) return;
    const updates = {};
    snap.forEach((child) => {
      const m = child.val();
      if (m && m.senderID !== myID && m.seen === false)
        updates["chats/" + roomId + "/" + child.key + "/seen"] = true;
    });
    if (Object.keys(updates).length) db.ref().update(updates).catch(() => {});
  }).catch(() => {});
}

function sendMessage() {
  if (!state.user || !_chatRoomID) return;
  const me     = state.user.username;
  const myName = state.user.fullName || me;

  const inputEl = document.getElementById("chat-input-text");
  const text    = inputEl ? inputEl.value.trim() : "";
  if (!text) return;

  const receiverID = state.activeChat || "";
  if (!receiverID) return;

  db.ref("chats/" + _chatRoomID).push({
    senderID:  me,
    type:      "text",
    text:      text,
    timestamp: firebase.database.ServerValue.TIMESTAMP,
    seen:      false,
  }).then(() => {
    if (inputEl) inputEl.value = "";
  }).catch((err) => console.error("sendMessage:", err));

  const receiverNameEl = document.getElementById("chat-user-name");
  const receiverName   = receiverNameEl ? receiverNameEl.innerText : receiverID;

  db.ref("chat_rooms/" + _chatRoomID).update({
    participants:     { [me]: true, [receiverID]: true },
    participantNames: { [me]: myName, [receiverID]: receiverName },
    lastMessage:      text,
    lastTimestamp:    firebase.database.ServerValue.TIMESTAMP,
  }).catch(() => {});

  db.ref("chat_rooms/" + _chatRoomID + "/unread/" + receiverID)
    .transaction((c) => (c || 0) + 1).catch(() => {});
}

function closeChatModal() {
  const modal = document.getElementById("chat-modal");
  if (modal) modal.style.display = "none";
  _closeChatListeners();
  state.activeChat = null;
}

function _closeChatListeners() {
  if (_chatMsgListener)   { _chatMsgListener.off();   _chatMsgListener = null; }
  if (_presenceListener)  { _presenceListener.off();  _presenceListener = null; }
  if (_typingListenerRef) { _typingListenerRef.off();  _typingListenerRef = null; }
  if (_typingRef) {
    _typingRef.set(false).catch(() => {});
    _typingRef = null;
  }
  clearTimeout(_typingTimer);
}

/* ─── Presence ───────────────────────────────────────────────── */
function setupUserPresence() {
  if (!state.user || state.user.isAdmin) return;
  const username = state.user.username;
  const presRef  = db.ref("users/" + username + "/status");
  const connRef  = db.ref(".info/connected");

  connRef.on("value", (snap) => {
    if (!snap.val()) return;
    presRef.onDisconnect().set("offline").catch(() => {});
    presRef.set("online").catch(() => {});
  });
}

function _listenToPresence(receiverID) {
  if (_presenceListener) { _presenceListener.off(); _presenceListener = null; }
  _presenceListener = db.ref("users/" + receiverID + "/status");
  _presenceListener.on("value", (snap) => {
    const statusEl = document.getElementById("chat-user-status");
    if (!statusEl) return;
    const status = snap.val() || "offline";
    statusEl.innerText = status === "online" ? "online" : "offline";
    statusEl.style.color = status === "online" ? "#4ade80" : "rgba(255,255,255,0.6)";
  });
}

/* ─── Typing indicator ───────────────────────────────────────── */
function _listenTyping(roomId, myID, receiverID) {
  _typingRef = db.ref("typing/" + roomId + "/" + myID);
  _typingListenerRef = db.ref("typing/" + roomId + "/" + receiverID);

  const chatInput = document.getElementById("chat-input-text");
  if (chatInput) {
    chatInput.addEventListener("input", () => {
      if (_typingRef) _typingRef.set(true).catch(() => {});
      clearTimeout(_typingTimer);
      _typingTimer = setTimeout(() => {
        if (_typingRef) _typingRef.set(false).catch(() => {});
      }, 2000);
    });
  }

  const statusEl = document.getElementById("chat-user-status");
  _typingListenerRef.on("value", (snap) => {
    if (!statusEl) return;
    if (snap.val() === true) {
      statusEl.innerText = "typing...";
      statusEl.style.color = "#fbbf24";
    }
  });
}

/* ─── Extra chat input UI (mic, location, attachment) ────────── */
function _ensureChatInputUI() {
  // Stub — extend as needed for mic/location/attachment
}

/* ─── Inbox / Chat notifications ────────────────────────────── */
function listenForChatNotifications() {
  if (!state.user || state.user.isAdmin) return;
  const me = state.user.username;

  if (_unreadBadgeListener) { _unreadBadgeListener.off(); _unreadBadgeListener = null; }

  _unreadBadgeListener = db.ref("chat_rooms");
  _unreadBadgeListener.on("value", (snap) => {
    let total = 0;
    snap.forEach((child) => {
      const room = child.val();
      if (room && room.participants && room.participants[me]) {
        total += (room.unread && room.unread[me]) || 0;
      }
    });
    const badge = document.getElementById("global-inbox-badge");
    if (badge) {
      badge.style.display = total > 0 ? "block" : "none";
      badge.textContent = total > 99 ? "99+" : total;
    }
  });
}

function openInboxScreen() {
  if (!state.user) return;
  const me = state.user.username;
  showScreen("chat-history");

  const listEl = document.getElementById("inbox-messages-list");
  if (!listEl) return;
  listEl.innerHTML = `<p style="text-align:center;color:#888;padding:20px;">Loading...</p>`;

  if (_inboxListener) { _inboxListener.off(); _inboxListener = null; }

  _inboxListener = db.ref("chat_rooms");
  _inboxListener.orderByChild("lastTimestamp").on("value", (snap) => {
    const rooms = [];
    snap.forEach((child) => {
      const r = child.val();
      if (r && r.participants && r.participants[me]) {
        rooms.push({ id: child.key, ...r });
      }
    });
    rooms.reverse();

    if (rooms.length === 0) {
      listEl.innerHTML = `<p style="text-align:center;color:#888;padding:20px;">Abhi koi chat nahi hai.</p>`;
      return;
    }

    listEl.innerHTML = rooms.map((r) => {
      const otherID   = Object.keys(r.participants || {}).find((k) => k !== me) || "";
      const otherName = (r.participantNames && r.participantNames[otherID]) || otherID;
      const unread    = (r.unread && r.unread[me]) || 0;
      const lastMsg   = escapeHtml(r.lastMessage || "");
      const timeStr   = formatChatTime(r.lastTimestamp);
      return `
        <div onclick="openChatWithUser('${escapeHtml(otherID)}','${escapeHtml(otherName)}','')"
          style="display:flex;align-items:center;gap:12px;padding:12px 10px;border-bottom:1px solid #eee;cursor:pointer;">
          <div style="width:42px;height:42px;border-radius:50%;background:#1E40AF;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0;">
            ${escapeHtml((otherName || "?").charAt(0).toUpperCase())}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;">${escapeHtml(otherName)}</div>
            <div style="font-size:12px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${lastMsg}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
            <div style="font-size:10px;color:#888;">${timeStr}</div>
            ${unread > 0 ? `<div style="background:#1E40AF;color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">${unread}</div>` : ""}
          </div>
        </div>`;
    }).join("");
  });
}

function goBackToHome() {
  if (_inboxListener) { _inboxListener.off(); _inboxListener = null; }
  showScreen("home");
}

/* ─── Admin chat history ─────────────────────────────────────── */
function loadUserChatsInAdmin(username) {
  const container = document.getElementById("admin-user-messages-container");
  if (!container) return;

  if (_adminThreadRef) { _adminThreadRef.off(); _adminThreadRef = null; }

  container.innerHTML = `<p style="color:#888;font-style:italic;font-size:13px;padding:8px;text-align:center;">⏳ Chat history load ho rahi hai...</p>`;

  db.ref("chat_rooms").once("value").then((snap) => {
    const rooms = [];
    snap.forEach((child) => {
      const r = child.val();
      if (r && r.participants && r.participants[username]) {
        rooms.push({ id: child.key, ...r });
      }
    });

    if (rooms.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:20px;">
          <div style="font-size:32px;margin-bottom:8px;">💬</div>
          <p style="color:#888;font-style:italic;font-size:13px;">Is user ki abhi tak koi chat nahi hai.</p>
        </div>`;
      return;
    }

    rooms.sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));

    container.innerHTML = rooms.map((r) => {
      const others = Object.keys(r.participants || {}).filter((k) => k !== username);
      const otherID   = others[0] || "";
      const otherName = (r.participantNames && otherID && r.participantNames[otherID]) || otherID || "—";
      const lastMsg   = escapeHtml(r.lastMessage || "Koi paigham nahi");
      const timeStr   = r.lastTimestamp ? formatChatTime(r.lastTimestamp) : "";
      const chatId    = escapeHtml(r.id);
      const initLetter = (otherName || "?").charAt(0).toUpperCase();
      return `
        <div class="admin-chat-item" onclick="showAdminChatDetail('${chatId}','${escapeHtml(username)}','${escapeHtml(otherName)}','${escapeHtml(otherID)}')" title="Chat detail dekhein">
          <div class="admin-chat-avatar">${escapeHtml(initLetter)}</div>
          <div class="admin-chat-info">
            <div class="admin-chat-names">💬 <strong>${escapeHtml(username)}</strong> ↔ <strong>${escapeHtml(otherName)}</strong></div>
            <div class="admin-chat-last">${lastMsg}</div>
          </div>
          <div class="admin-chat-meta">
            <div class="admin-chat-time">${escapeHtml(timeStr)}</div>
            <div class="admin-chat-arrow">›</div>
          </div>
        </div>`;
    }).join("");
  }).catch(() => {
    if (container) container.innerHTML = `
      <div style="text-align:center;padding:16px;">
        <p style="color:#e53e3e;font-size:13px;">⚠️ Chat history load nahi ho saki.</p>
        <button onclick="loadUserChatsInAdmin('${escapeHtml(username)}')" style="margin-top:8px;padding:6px 14px;border-radius:8px;border:1px solid #1E40AF;color:#1E40AF;background:#fff;cursor:pointer;font-size:13px;">↺ Phir Koshish Karein</button>
      </div>`;
  });
}

/* ─── Admin chat detail view ──────────────────────────────────── */
function showAdminChatDetail(chatId, username, otherName, otherID) {
  const container = document.getElementById("admin-user-messages-container");
  if (!container) return;

  container.innerHTML = `
    <div class="admin-chat-detail-header">
      <button class="admin-chat-back-btn" onclick="loadUserChatsInAdmin('${escapeHtml(username)}')">← Wapas</button>
      <div class="admin-chat-detail-title">💬 ${escapeHtml(username)} ↔ ${escapeHtml(otherName)}</div>
    </div>
    <div id="admin-chat-detail-msgs" style="display:flex;flex-direction:column;gap:6px;padding:10px 8px;">
      <p style="text-align:center;color:#888;font-size:13px;padding:16px;">⏳ Messages load ho rahi hain...</p>
    </div>`;

  db.ref("chats/" + chatId).orderByChild("timestamp").once("value").then((snap) => {
    const msgsEl = document.getElementById("admin-chat-detail-msgs");
    if (!msgsEl) return;

    if (!snap.exists()) {
      msgsEl.innerHTML = `<p style="text-align:center;color:#888;font-size:13px;padding:16px;">Koi message nahi mila.</p>`;
      return;
    }

    const messages = [];
    snap.forEach((child) => {
      messages.push({ key: child.key, ...child.val() });
    });

    if (messages.length === 0) {
      msgsEl.innerHTML = `<p style="text-align:center;color:#888;font-size:13px;padding:16px;">Koi message nahi mila.</p>`;
      return;
    }

    msgsEl.innerHTML = messages.map((msg) => {
      const isByUser   = msg.senderID === username;
      const senderLabel = isByUser ? escapeHtml(username) : escapeHtml(otherName || msg.senderID || "?");
      const timeStr    = msg.timestamp ? formatChatTime(msg.timestamp) : "";
      const seenTick   = msg.seen
        ? `<span style="color:#60A5FA;font-size:10px;">✓✓</span>`
        : `<span style="color:#aaa;font-size:10px;">✓</span>`;

      let content = "";
      const msgType = msg.type || "text";
      if (msgType === "image") {
        content = `<img src="${escapeHtml(msg.fileUrl || "")}" alt="Image" style="max-width:200px;border-radius:8px;display:block;margin-top:4px;" onerror="this.style.display='none'">`;
      } else if (msgType === "audio") {
        content = `<audio controls src="${escapeHtml(msg.audioUrl || "")}" style="max-width:200px;margin-top:4px;display:block;"></audio>`;
      } else if (msgType === "document") {
        content = `<div style="display:flex;align-items:center;gap:6px;margin-top:2px;">📄 <a href="${escapeHtml(msg.fileUrl || "")}" target="_blank" style="color:inherit;font-size:12px;">${escapeHtml(msg.fileName || "Document")}</a></div>`;
      } else if (msgType === "location") {
        content = `<a href="${escapeHtml(msg.locationUrl || "#")}" target="_blank" style="color:inherit;font-size:12px;">📍 Location dekhein</a>`;
      } else {
        content = escapeHtml(msg.text || "");
      }

      return `
        <div class="admin-msg-bubble ${isByUser ? "admin-msg-right" : "admin-msg-left"}">
          <div class="admin-msg-sender">${senderLabel}</div>
          <div class="admin-msg-box ${isByUser ? "admin-msg-box-blue" : "admin-msg-box-white"}">
            ${content}
          </div>
          <div class="admin-msg-footer">${timeStr} ${isByUser ? seenTick : ""}</div>
        </div>`;
    }).join("");

    msgsEl.scrollTop = msgsEl.scrollHeight;
  }).catch((err) => {
    const msgsEl = document.getElementById("admin-chat-detail-msgs");
    if (msgsEl) msgsEl.innerHTML = `<p style="text-align:center;color:#e53e3e;font-size:13px;padding:16px;">⚠️ Messages load nahi hue. (${escapeHtml(err.message || "")})</p>`;
  });
}

/* ─── Image helpers ──────────────────────────────────────────── */
function _openImageFullscreen(src) {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
  ov.innerHTML = `<img src="${escapeHtml(src)}" style="max-width:95vw;max-height:92vh;border-radius:8px;object-fit:contain;">`;
  ov.addEventListener("click", () => ov.remove());
  document.body.appendChild(ov);
}

async function _resizeImageToBase64(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality || 0.8));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
