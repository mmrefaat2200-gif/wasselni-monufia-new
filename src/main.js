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
   STATE
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

  if (old) old.remove();

  const box = document.createElement("div");

  box.className = `app-message ${type}`;
  box.textContent = message;

  if (app()) {
    app().prepend(box);
  }

  setTimeout(() => {
    if (box.parentNode) {
      box.remove();
    }
  }, 5000);
}

function loading(
  button,
  state,
  text = "جاري التحميل..."
) {
  if (!button) return;

  if (state) {
    button.dataset.oldText =
      button.textContent;

    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent =
      button.dataset.oldText ||
      button.textContent;

    button.disabled = false;
  }
}

/* =====================================================
   PHONE
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

/* =====================================================
   INTERNAL FIREBASE LOGIN ID
   =====================================================

   نفس الرقم يمكن أن يكون:

   01012345678 + customer

   وفي نفس الوقت:

   01012345678 + captain

   لذلك كل دور له حساب Firebase مستقل.
*/

function createInternalLoginEmail(
  phone,
  role
) {
  const normalized =
    normalizeEgyptPhone(phone);

  const digits =
    normalized.replace(/\D/g, "");

  const roleName =
    role === "captain"
      ? "captain"
      : "customer";

  return `${digits}.${roleName}@login.wasselni-monufia.app`;
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
          اختار طريقة استخدامك للتطبيق
        </p>

        <button
          id="customerLoginBtn"
          class="primary-btn"
        >
          👤 الدخول كعميل
        </button>

        <button
          id="captainLoginBtn"
          class="secondary-btn"
        >
          🚕 الدخول ككابتن
        </button>

        <div style="height:12px"></div>

        <button
          id="registerBtn"
          class="secondary-btn"
        >
          إنشاء حساب جديد
        </button>

      </div>

    </main>
  `;

  document.getElementById(
    "customerLoginBtn"
  ).onclick = () => {

    renderAuth(
      "login",
      "customer"
    );

  };

  document.getElementById(
    "captainLoginBtn"
  ).onclick = () => {

    renderAuth(
      "login",
      "captain"
    );

  };

  document.getElementById(
    "registerBtn"
  ).onclick = () => {

    renderAuth(
      "register",
      "customer"
    );

  };
}

/* =====================================================
   AUTH PAGE
   ===================================================== */

function renderAuth(
  mode = "login",
  role = "customer"
) {

  selectedRole = role;

  const isRegister =
    mode === "register";

  const roleText =
    selectedRole === "captain"
      ? "كابتن 🚕"
      : "عميل 👤";

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
          ${roleText}
        </p>

        <div class="role-buttons">

          <button
            id="customerRole"
            class="role-btn ${
              selectedRole === "customer"
                ? "active"
                : ""
            }"
            type="button"
          >
            👤 عميل
          </button>

          <button
            id="captainRole"
            class="role-btn ${
              selectedRole === "captain"
                ? "active"
                : ""
            }"
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

  document.getElementById(
    "backBtn"
  ).onclick = renderHome;

  /* ===================================================
     CUSTOMER
     =================================================== */

  document.getElementById(
    "customerRole"
  ).onclick = () => {

    renderAuth(
      mode,
      "customer"
    );

  };

  /* ===================================================
     CAPTAIN
     =================================================== */

  document.getElementById(
    "captainRole"
  ).onclick = () => {

    renderAuth(
      mode,
      "captain"
    );

  };

  /* ===================================================
     SWITCH
     =================================================== */

  document.getElementById(
    "switchBtn"
  ).onclick = () => {

    renderAuth(
      isRegister
        ? "login"
        : "register",
      selectedRole
    );

  };

  /* ===================================================
     MAIN
     =================================================== */

  document.getElementById(
    "mainAuthBtn"
  ).onclick = () => {

    if (isRegister) {
      registerAccount();
    } else {
      loginAccount();
    }

  };

  renderCaptainFields(
    isRegister
  );
}

/* =====================================================
   CAPTAIN FIELDS
   ===================================================== */

function renderCaptainFields(
  isRegister
) {

  const container =
    document.getElementById(
      "captainFields"
    );

  if (!container) return;

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
    document.getElementById(
      "mainAuthBtn"
    );

  const name =
    document.getElementById(
      "name"
    )?.value.trim() || "";

  const phoneInput =
    document.getElementById(
      "contact"
    )?.value.trim() || "";

  const password =
    document.getElementById(
      "password"
    )?.value || "";

  if (!name) {

    showMessage(
      "اكتب الاسم بالكامل",
      "error"
    );

    return;
  }

  const phone =
    normalizeEgyptPhone(
      phoneInput
    );

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

  /* ===================================================
     CAPTAIN VALIDATION
     =================================================== */

  if (
    selectedRole === "captain" &&
    (
      !document.getElementById(
        "carType"
      )?.value.trim() ||

      !document.getElementById(
        "carModel"
      )?.value.trim() ||

      !document.getElementById(
        "carNumber"
      )?.value.trim()
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
       ROLE-SPECIFIC FIREBASE ID
       ================================================= */

    const internalEmail =
      createInternalLoginEmail(
        phone,
        selectedRole
      );

    /* =================================================
       CREATE ACCOUNT
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
      phone,
      selectedRole
    );

    showMessage(
      selectedRole === "captain"
        ? "تم إنشاء حساب الكابتن بنجاح 🚕"
        : "تم إنشاء حساب العميل بنجاح 👤",
      "success"
    );

    setTimeout(() => {

      openUserApp(
        result.user
      );

    }, 1000);

  } catch (error) {

    console.error(
      "REGISTER ERROR:",
      error
    );

    showMessage(
      firebaseErrorMessage(
        error
      ),
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
  phone,
  role
) {

  const profile = {

    uid: user.uid,

    name: name,

    role: role,

    phone: phone,

    createdAt:
      new Date().toISOString()

  };

  if (role === "captain") {

    profile.carType =
      document.getElementById(
        "carType"
      )?.value.trim() || "";

    profile.carModel =
      document.getElementById(
        "carModel"
      )?.value.trim() || "";

    profile.carNumber =
      document.getElementById(
        "carNumber"
      )?.value.trim() || "";

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
    document.getElementById(
      "mainAuthBtn"
    );

  const phoneInput =
    document.getElementById(
      "contact"
    )?.value.trim() || "";

  const password =
    document.getElementById(
      "password"
    )?.value || "";

  const phone =
    normalizeEgyptPhone(
      phoneInput
    );

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
       SAME PHONE + DIFFERENT ROLE = DIFFERENT ACCOUNT
       ================================================= */

    const internalEmail =
      createInternalLoginEmail(
        phone,
        selectedRole
      );

    const result =
      await signInWithEmailAndPassword(
        auth,
        internalEmail,
        password
      );

    /* =================================================
       LOAD PROFILE
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

      await signOut(auth);

      showMessage(
        "الحساب موجود لكن بياناته غير موجودة.",
        "error"
      );

      return;
    }

    const profile =
      profileSnap.data();

    /* =================================================
       OPEN CORRECT PLATFORM
       ================================================= */

    if (
      profile.role !== selectedRole
    ) {

      await signOut(auth);

      showMessage(
        "نوع الحساب غير صحيح.",
        "error"
      );

      return;
    }

    openUserApp(
      result.user
    );

  } catch (error) {

    console.error(
      "LOGIN ERROR:",
      error
    );

    showMessage(
      firebaseErrorMessage(
        error
      ),
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
   OPEN USER APP
   ===================================================== */

async function openUserApp(
  user
) {

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
      "OPEN APP ERROR:",
      error
    );

    showMessage(
      "تم تسجيل الدخول لكن حصلت مشكلة في تحميل الحساب.",
      "error"
    );
  }
}

/* =====================================================
   CUSTOMER PLATFORM
   ===================================================== */

function renderCustomerHome(
  profile
) {

  app().innerHTML = `

    <main class="dashboard">

      <header class="dashboard-header">

        <div>

          <small>
            أهلاً بيك يا عميل 👤
          </small>

          <h1>
            ${escapeHtml(
              profile.name ||
              "العميل"
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
   CAPTAIN PLATFORM
   ===================================================== */

function renderCaptainHome(
  profile
) {

  app().innerHTML = `

    <main class="dashboard">

      <header class="dashboard-header">

        <div>

          <small>
            أهلاً يا كابتن 🚕
          </small>

          <h1>
            ${escapeHtml(
              profile.name ||
              "الكابتن"
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
          منصة الكابتن
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

      <section class="welcome-card">

        <h3>
          بيانات السيارة
        </h3>

        <p>
          النوع:
          ${escapeHtml(
            profile.carType ||
            "-"
          )}
        </p>

        <p>
          الموديل:
          ${escapeHtml(
            profile.carModel ||
            "-"
          )}
        </p>

        <p>
          اللوحة:
          ${escapeHtml(
            profile.carNumber ||
            "-"
          )}
        </p>

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
   FIREBASE ERRORS
   ===================================================== */

function firebaseErrorMessage(
  error
) {

  const code =
    error?.code || "";

  const messages = {

    "auth/email-already-in-use":
      "الحساب ده موجود بالفعل لهذا الدور. جرّب تسجيل الدخول.",

    "auth/invalid-email":
      "بيانات الحساب غير صحيحة.",

    "auth/weak-password":
      "كلمة المرور لازم تكون 6 أحرف أو أكثر.",

    "auth/user-not-found":
      "لا يوجد حساب بهذا الرقم لهذا الدور.",

    "auth/wrong-password":
      "رقم الهاتف أو كلمة المرور غير صحيحة.",

    "auth/invalid-credential":
      "رقم الهاتف أو كلمة المرور غير صحيحة.",

    "auth/too-many-requests":
      "تمت محاولات كثيرة. حاول مرة أخرى لاحقًا.",

    "auth/network-request-failed":
      "تأكد من اتصال الإنترنت.",

    "auth/operation-not-allowed":
      "Email/Password غير مفعّل في Firebase.",

    "auth/invalid-api-key":
      "مفتاح Firebase غير صحيح.",

    "auth/project-not-found":
      "مشروع Firebase غير موجود أو الإعدادات غير صحيحة."

  };

  return (
    messages[code] ||
    `حدث خطأ أثناء العملية. (${code || "unknown"})`
  );
}

/* =====================================================
   ESCAPE HTML
   ===================================================== */

function escapeHtml(
  value
) {

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
