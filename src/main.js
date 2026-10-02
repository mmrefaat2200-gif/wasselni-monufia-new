import "./style.css";

import { initializeApp } from "firebase/app";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "firebase/auth";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "firebase/firestore";

/* =====================================================
   FIREBASE
   ===================================================== */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

/* =====================================================
   APP STATE
   ===================================================== */

let selectedRole = "customer";

/* =====================================================
   HELPERS
   ===================================================== */

function app() {
  return document.getElementById("root");
}

function showMessage(message, type = "info") {
  const old = document.querySelector(".app-message");

  if (old) {
    old.remove();
  }

  const box = document.createElement("div");

  box.className = `app-message ${type}`;
  box.textContent = message;

  const root = app();

  if (root) {
    root.prepend(box);
  }

  setTimeout(() => {
    if (box.parentNode) {
      box.remove();
    }
  }, 5000);
}

function loading(button, state, text = "جاري التحميل...") {
  if (!button) return;

  if (state) {
    button.dataset.oldText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent =
      button.dataset.oldText || button.textContent;

    button.disabled = false;
  }
}

/* =====================================================
   PHONE HELPERS
   ===================================================== */

function normalizeEgyptPhone(phone) {
  let value = String(phone || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "");

  if (value.startsWith("0020")) {
    value = "+" + value.substring(2);
  }

  if (value.startsWith("01")) {
    value = "+20" + value.substring(1);
  }

  return value;
}

function isValidEgyptPhone(phone) {
  return /^\+201[0125]\d{8}$/.test(phone);
}

/*
  Firebase Email/Password يحتاج معرفًا على شكل email.

  المستخدم لن يرى هذا المعرف.
  يتم توليده بشكل ثابت من رقم الهاتف.

  مثال:
  01012345678
  ↓
  201012345678@login.wasselni-monufia.app

  نفس الرقم دائمًا ينتج نفس المعرف،
  وبالتالي يستطيع المستخدم الدخول من أي جهاز.
*/

function createInternalLoginEmail(phone) {
  const normalized = normalizeEgyptPhone(phone);

  const digits = normalized.replace(/\D/g, "");

  return `${digits}@login.wasselni-monufia.app`;
}

/* =====================================================
   HOME
   ===================================================== */

function renderHome() {
  app().innerHTML = `
    <main class="landing">

      <div class="brand">

        <div class="logo">
          🚕
        </div>

        <h1>
          وصلني المنوفية
        </h1>

        <p>
          مشاويرك أسهل وأسرع
        </p>

      </div>

      <div class="home-card">

        <h2>
          أهلاً بيك 👋
        </h2>

        <p>
          اطلب مشوارك أو انضم للكباتن وابدأ تستقبل الرحلات.
        </p>

        <button
          id="loginBtn"
          class="primary-btn"
        >
          تسجيل الدخول
        </button>

        <button
          id="registerBtn"
          class="secondary-btn"
        >
          إنشاء حساب جديد
        </button>

      </div>

    </main>
  `;

  document.getElementById("loginBtn").onclick = () => {
    renderAuth("login");
  };

  document.getElementById("registerBtn").onclick = () => {
    renderAuth("register");
  };
}

/* =====================================================
   AUTH PAGE
   ===================================================== */

function renderAuth(mode = "login") {
  selectedRole = "customer";

  const isRegister = mode === "register";

  app().innerHTML = `
    <main class="auth-page">

      <button
        id="backBtn"
        class="back-btn"
        type="button"
      >
        ← رجوع
      </button>

      <div class="auth-brand">

        <div class="logo small">
          🚕
        </div>

        <h1>
          وصلني المنوفية
        </h1>

      </div>

      <section class="auth-card">

        <h2>
          ${
            isRegister
              ? "إنشاء حساب"
              : "تسجيل الدخول"
          }
        </h2>

        <p class="hint">
          ${
            isRegister
              ? "اختار نوع الحساب"
              : "اختار نوع الحساب وسجل دخولك"
          }
        </p>

        <div class="role-buttons">

          <button
            id="customerRole"
            class="role-btn active"
            type="button"
          >
            👤 عميل
          </button>

          <button
            id="captainRole"
            class="role-btn"
            type="button"
          >
            🚕 كابتن
          </button>

        </div>

        ${
          isRegister
            ? `
              <div class="input-group">

                <label>
                  الاسم بالكامل
                </label>

                <input
                  id="name"
                  type="text"
                  placeholder="اكتب اسمك بالكامل"
                  autocomplete="name"
                />

              </div>
            `
            : ""
        }

        <div id="captainFields"></div>

        <div class="input-group">

          <label>
            رقم الهاتف
          </label>

          <input
            id="contact"
            type="tel"
            dir="ltr"
            inputmode="tel"
            placeholder="01012345678"
            autocomplete="tel"
          />

        </div>

        <div class="input-group">

          <label>
            كلمة المرور
          </label>

          <input
            id="password"
            type="password"
            placeholder="6 أحرف على الأقل"
            autocomplete="${
              isRegister
                ? "new-password"
                : "current-password"
            }"
          />

        </div>

        <button
          id="mainAuthBtn"
          class="primary-btn"
          type="button"
        >
          ${
            isRegister
              ? "إنشاء الحساب"
              : "تسجيل الدخول"
          }
        </button>

        <p class="switch-auth">

          ${
            isRegister
              ? `
                عندك حساب بالفعل؟
                <button
                  id="switchBtn"
                  type="button"
                >
                  تسجيل الدخول
                </button>
              `
              : `
                مستخدم جديد؟
                <button
                  id="switchBtn"
                  type="button"
                >
                  إنشاء حساب
                </button>
              `
          }

        </p>

      </section>

    </main>
  `;

  /* ===================================================
     BACK
     =================================================== */

  document.getElementById("backBtn").onclick =
    renderHome;

  /* ===================================================
     CUSTOMER
     =================================================== */

  document.getElementById("customerRole").onclick =
    () => {

      selectedRole = "customer";

      document
        .getElementById("customerRole")
        .classList.add("active");

      document
        .getElementById("captainRole")
        .classList.remove("active");

      renderCaptainFields(isRegister);
    };

  /* ===================================================
     CAPTAIN
     =================================================== */

  document.getElementById("captainRole").onclick =
    () => {

      selectedRole = "captain";

      document
        .getElementById("captainRole")
        .classList.add("active");

      document
        .getElementById("customerRole")
        .classList.remove("active");

      renderCaptainFields(isRegister);
    };

  /* ===================================================
     SWITCH LOGIN / REGISTER
     =================================================== */

  document.getElementById("switchBtn").onclick =
    () => {

      renderAuth(
        isRegister
          ? "login"
          : "register"
      );

    };

  /* ===================================================
     MAIN BUTTON
     =================================================== */

  document.getElementById("mainAuthBtn").onclick =
    () => {

      if (isRegister) {
        registerAccount();
      } else {
        loginAccount();
      }

    };

  renderCaptainFields(isRegister);
}

/* =====================================================
   CAPTAIN FIELDS
   ===================================================== */

function renderCaptainFields(isRegister) {

  const container =
    document.getElementById("captainFields");

  if (!container) {
    return;
  }

  if (
    !isRegister ||
    selectedRole !== "captain"
  ) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `

    <div class="captain-box">

      <h3>
        بيانات الكابتن 🚕
      </h3>

      <div class="input-group">

        <label>
          نوع السيارة
        </label>

        <input
          id="carType"
          type="text"
          placeholder="سيدان / ميكروباص / غيره"
        />

      </div>

      <div class="input-group">

        <label>
          موديل السيارة
        </label>

        <input
          id="carModel"
          type="text"
          placeholder="مثال: لانسر"
        />

      </div>

      <div class="input-group">

        <label>
          رقم السيارة / اللوحة
        </label>

        <input
          id="carNumber"
          type="text"
          placeholder="مثال: م ن 1234"
        />

      </div>

    </div>

  `;
}

/* =====================================================
   REGISTER
   ===================================================== */

async function registerAccount() {

  const button =
    document.getElementById("mainAuthBtn");

  const name =
    document
      .getElementById("name")
      ?.value
      .trim() || "";

  const phoneInput =
    document
      .getElementById("contact")
      ?.value
      .trim() || "";

  const password =
    document
      .getElementById("password")
      ?.value || "";

  /* ===================================================
     VALIDATION
     =================================================== */

  if (!name) {

    showMessage(
      "اكتب الاسم بالكامل",
      "error"
    );

    return;
  }

  const phone =
    normalizeEgyptPhone(phoneInput);

  if (!isValidEgyptPhone(phone)) {

    showMessage(
      "اكتب رقم هاتف مصري صحيح مثل 01012345678",
      "error"
    );

    return;
  }

  if (password.length < 6) {

    showMessage(
      "كلمة المرور لازم تكون 6 أحرف على الأقل",
      "error"
    );

    return;
  }

  if (
    selectedRole === "captain" &&
    (
      !document
        .getElementById("carType")
        ?.value
        .trim() ||

      !document
        .getElementById("carModel")
        ?.value
        .trim() ||

      !document
        .getElementById("carNumber")
        ?.value
        .trim()
    )
  ) {

    showMessage(
      "اكمل بيانات السيارة",
      "error"
    );

    return;
  }

  loading(
    button,
    true,
    "جاري إنشاء الحساب..."
  );

  try {

    /* =================================================
       INTERNAL FIREBASE LOGIN ID
       ================================================= */

    const internalEmail =
      createInternalLoginEmail(phone);

    /* =================================================
       CREATE FIREBASE ACCOUNT
       ================================================= */

    const result =
      await createUserWithEmailAndPassword(
        auth,
        internalEmail,
        password
      );

    /* =================================================
       SAVE PROFILE
       ================================================= */

    await saveUserProfile(
      result.user,
      name,
      phone
    );

    showMessage(
      "تم إنشاء حسابك بنجاح 🎉",
      "success"
    );

    setTimeout(() => {

      openUserApp(result.user);

    }, 1000);

  } catch (error) {

    console.error(
      "REGISTER ERROR:",
      error
    );

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );

  } finally {

    loading(
      button,
      false
    );

  }
}

/* =====================================================
   SAVE PROFILE
   ===================================================== */

async function saveUserProfile(
  user,
  name,
  phone
) {

  const profile = {

    uid: user.uid,

    name: name,

    role: selectedRole,

    phone: phone,

    createdAt:
      new Date().toISOString()

  };

  if (selectedRole === "captain") {

    profile.carType =
      document
        .getElementById("carType")
        ?.value
        .trim() || "";

    profile.carModel =
      document
        .getElementById("carModel")
        ?.value
        .trim() || "";

    profile.carNumber =
      document
        .getElementById("carNumber")
        ?.value
        .trim() || "";

  }

  await setDoc(
    doc(
      db,
      "users",
      user.uid
    ),
    profile,
    {
      merge: true
    }
  );
}

/* =====================================================
   LOGIN
   ===================================================== */

async function loginAccount() {

  const button =
    document.getElementById("mainAuthBtn");

  const phoneInput =
    document
      .getElementById("contact")
      ?.value
      .trim() || "";

  const password =
    document
      .getElementById("password")
      ?.value || "";

  /* ===================================================
     VALIDATION
     =================================================== */

  const phone =
    normalizeEgyptPhone(phoneInput);

  if (!isValidEgyptPhone(phone)) {

    showMessage(
      "اكتب رقم هاتف مصري صحيح مثل 01012345678",
      "error"
    );

    return;
  }

  if (!password) {

    showMessage(
      "اكتب كلمة المرور",
      "error"
    );

    return;
  }

  loading(
    button,
    true,
    "جاري تسجيل الدخول..."
  );

  try {

    /* =================================================
       CREATE SAME INTERNAL LOGIN ID
       ================================================= */

    const internalEmail =
      createInternalLoginEmail(phone);

    /* =================================================
       FIREBASE LOGIN
       ================================================= */

    const result =
      await signInWithEmailAndPassword(
        auth,
        internalEmail,
        password
      );

    /* =================================================
       GET PROFILE
       ================================================= */

    const profileSnap =
      await getDoc(
        doc(
          db,
          "users",
          result.user.uid
        )
      );

    if (!profileSnap.exists()) {

      showMessage(
        "الحساب موجود ولكن بيانات الحساب غير مكتملة.",
        "error"
      );

      await signOut(auth);

      return;
    }

    const profile =
      profileSnap.data();

    /* =================================================
       CHECK ROLE
       ================================================= */

    if (
      profile.role &&
      profile.role !== selectedRole
    ) {

      await signOut(auth);

      showMessage(
        "نوع الحساب الذي اخترته لا يطابق الحساب المسجل.",
        "error"
      );

      return;
    }

    /* =================================================
       OPEN APP
       ================================================= */

    openUserApp(
      result.user
    );

  } catch (error) {

    console.error(
      "LOGIN ERROR:",
      error
    );

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );

  } finally {

    loading(
      button,
      false
    );

  }
}

/* =====================================================
   USER APP
   ===================================================== */

async function openUserApp(user) {

  try {

    const profileSnap =
      await getDoc(
        doc(
          db,
          "users",
          user.uid
        )
      );

    if (!profileSnap.exists()) {

      showMessage(
        "لم يتم العثور على بيانات الحساب.",
        "error"
      );

      await signOut(auth);

      renderHome();

      return;
    }

    const profile =
      profileSnap.data();

    if (
      profile.role === "captain"
    ) {

      renderCaptainHome(
        profile
      );

    } else {

      renderCustomerHome(
        profile
      );

    }

  } catch (error) {

    console.error(
      "PROFILE ERROR:",
      error
    );

    showMessage(
      "تم تسجيل الدخول، لكن حدثت مشكلة في تحميل الحساب.",
      "error"
    );

  }
}

/* =====================================================
   CUSTOMER HOME
   ===================================================== */

function renderCustomerHome(profile) {

  app().innerHTML = `

    <main class="dashboard">

      <header class="dashboard-header">

        <div>

          <small>
            أهلاً بيك
          </small>

          <h1>
            ${escapeHtml(
              profile.name || "العميل"
            )}
          </h1>

        </div>

        <button
          id="logoutBtn"
          class="logout-btn"
        >
          خروج
        </button>

      </header>

      <section class="welcome-card">

        <div class="big-icon">
          🚕
        </div>

        <h2>
          جاهز لمشوارك؟
        </h2>

        <p>
          اطلب رحلتك وحدد المكان والسعر اللي يناسبك.
        </p>

      </section>

      <div class="dashboard-grid">

        <button class="dashboard-btn">
          📍
          <span>
            حدد موقعي
          </span>
        </button>

        <button class="dashboard-btn">
          🗺️
          <span>
            حدد الوجهة
          </span>
        </button>

        <button class="dashboard-btn">
          🚗
          <span>
            رحلة جديدة
          </span>
        </button>

        <button class="dashboard-btn">
          📋
          <span>
            رحلاتي
          </span>
        </button>

        <button class="dashboard-btn">
          🔔
          <span>
            الإشعارات
          </span>
        </button>

        <button class="dashboard-btn">
          👤
          <span>
            حسابي
          </span>
        </button>

      </div>

    </main>

  `;

  document.getElementById(
    "logoutBtn"
  ).onclick = async () => {

    await signOut(auth);

    renderHome();

  };
}

/* =====================================================
   CAPTAIN HOME
   ===================================================== */

function renderCaptainHome(profile) {

  app().innerHTML = `

    <main class="dashboard">

      <header class="dashboard-header">

        <div>

          <small>
            أهلاً يا كابتن
          </small>

          <h1>
            ${escapeHtml(
              profile.name || "الكابتن"
            )}
          </h1>

        </div>

        <button
          id="logoutBtn"
          class="logout-btn"
        >
          خروج
        </button>

      </header>

      <section class="captain-status-card">

        <div class="big-icon">
          🚕
        </div>

        <h2>
          حالة الكابتن
        </h2>

        <p id="captainStatus">
          غير متاح حاليًا
        </p>

        <button
          id="availableBtn"
          class="available-btn"
        >
          🟢 متاح
        </button>

        <button
          id="unavailableBtn"
          class="unavailable-btn"
        >
          🔴 غير متاح
        </button>

      </section>

      <div class="dashboard-grid">

        <button class="dashboard-btn">
          🚕
          <span>
            الرحلات المتاحة
          </span>
        </button>

        <button class="dashboard-btn">
          📋
          <span>
            رحلاتي ككابتن
          </span>
        </button>

        <button class="dashboard-btn">
          🔔
          <span>
            الإشعارات
          </span>
        </button>

        <button class="dashboard-btn">
          👤
          <span>
            حسابي
          </span>
        </button>

      </div>

    </main>

  `;

  const status =
    document.getElementById(
      "captainStatus"
    );

  document.getElementById(
    "availableBtn"
  ).onclick = () => {

    status.textContent =
      "متاح لاستقبال الرحلات 🟢";

  };

  document.getElementById(
    "unavailableBtn"
  ).onclick = () => {

    status.textContent =
      "غير متاح حاليًا 🔴";

  };

  document.getElementById(
    "logoutBtn"
  ).onclick = async () => {

    await signOut(auth);

    renderHome();

  };
}

/* =====================================================
   FIREBASE ERROR MESSAGES
   ===================================================== */

function firebaseErrorMessage(error) {

  const code =
    error?.code || "";

  const messages = {

    "auth/email-already-in-use":
      "رقم الهاتف ده مسجل بالفعل. جرّب تسجيل الدخول.",

    "auth/invalid-email":
      "بيانات تسجيل الدخول غير صحيحة.",

    "auth/weak-password":
      "كلمة المرور ضعيفة. استخدم 6 أحرف أو أكثر.",

    "auth/user-not-found":
      "رقم الهاتف غير مسجل.",

    "auth/wrong-password":
      "رقم الهاتف أو كلمة المرور غير صحيحة.",

    "auth/invalid-credential":
      "رقم الهاتف أو كلمة المرور غير صحيحة.",

    "auth/too-many-requests":
      "تمت محاولات كثيرة. حاول مرة أخرى لاحقًا.",

    "auth/network-request-failed":
      "تأكد من اتصال الإنترنت.",

    "auth/operation-not-allowed":
      "طريقة تسجيل الدخول غير مفعلة في Firebase.",

    "auth/internal-error":
      "حدث خطأ داخلي. حاول مرة أخرى."

  };

  return (
    messages[code] ||
    "حدث خطأ أثناء تنفيذ العملية."
  );
}

/* =====================================================
   ESCAPE HTML
   ===================================================== */

function escapeHtml(value) {

  return String(value)

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );

}

/* =====================================================
   AUTH STATE
   ===================================================== */

onAuthStateChanged(
  auth,
  async (user) => {

    if (!user) {

      renderHome();

      return;
    }

    try {

      const profileSnap =
        await getDoc(
          doc(
            db,
            "users",
            user.uid
          )
        );

      if (
        profileSnap.exists()
      ) {

        openUserApp(
          user
        );

      } else {

        await signOut(
          auth
        );

        renderHome();

      }

    } catch (error) {

      console.error(
        "AUTH STATE ERROR:",
        error
      );

      renderHome();

    }

  }
);

/* =====================================================
   START
   ===================================================== */

renderHome();
