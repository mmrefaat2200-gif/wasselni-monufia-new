import "./style.css";

import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
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
let selectedMethod = "phone";
let confirmationResult = null;
let verificationTimer = null;

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

  app().prepend(box);

  setTimeout(() => {
    box.remove();
  }, 5000);
}

function loading(button, state, text = "جاري التحميل...") {
  if (!button) return;

  if (state) {
    button.dataset.oldText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.oldText || button.textContent;
    button.disabled = false;
  }
}

function normalizeEgyptPhone(phone) {
  let value = phone.trim().replace(/\s+/g, "");

  if (value.startsWith("01")) {
    return "+20" + value.substring(1);
  }

  if (value.startsWith("0020")) {
    return "+" + value.substring(2);
  }

  if (value.startsWith("+20")) {
    return value;
  }

  return value;
}

/* =====================================================
   HOME
   ===================================================== */

function renderHome() {
  app().innerHTML = `
    <main class="landing">
      <div class="brand">
        <div class="logo">🚕</div>
        <h1>وصلني المنوفية</h1>
        <p>مشاويرك أسهل وأسرع</p>
      </div>

      <div class="home-card">
        <h2>أهلاً بيك 👋</h2>
        <p>
          اطلب مشوارك أو انضم للكباتن وابدأ تستقبل الرحلات.
        </p>

        <button id="loginBtn" class="primary-btn">
          تسجيل الدخول
        </button>

        <button id="registerBtn" class="secondary-btn">
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
  selectedMethod = "phone";
  confirmationResult = null;

  const isRegister = mode === "register";

  app().innerHTML = `
    <main class="auth-page">

      <button id="backBtn" class="back-btn">
        ← رجوع
      </button>

      <div class="auth-brand">
        <div class="logo small">🚕</div>
        <h1>وصلني المنوفية</h1>
      </div>

      <section class="auth-card">

        <h2>${isRegister ? "إنشاء حساب" : "تسجيل الدخول"}</h2>

        ${
          isRegister
            ? `
              <p class="hint">
                اختار نوع الحساب أولاً
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
            `
            : `
              <p class="hint">
                اختار نوع الحساب
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
            `
        }

        <div class="method-buttons">
          <button
            id="phoneMethod"
            class="method-btn active"
            type="button"
          >
            📱 رقم الهاتف
          </button>

          <button
            id="emailMethod"
            class="method-btn"
            type="button"
          >
            ✉️ البريد الإلكتروني
          </button>
        </div>

        ${
          isRegister
            ? `
              <div class="input-group">
                <label>الاسم بالكامل</label>
                <input
                  id="name"
                  type="text"
                  placeholder="اكتب اسمك بالكامل"
                />
              </div>
            `
            : ""
        }

        <div id="captainFields"></div>

        <div class="input-group">
          <label id="contactLabel">رقم الهاتف</label>

          <input
            id="contact"
            type="tel"
            dir="ltr"
            placeholder="01012345678"
          />
        </div>

        ${
          !isRegister
            ? `
              <div class="input-group">
                <label>كلمة المرور</label>
                <input
                  id="password"
                  type="password"
                  placeholder="كلمة المرور"
                />
              </div>
            `
            : `
              <div class="input-group">
                <label>كلمة المرور</label>
                <input
                  id="password"
                  type="password"
                  placeholder="6 أحرف على الأقل"
                />
              </div>
            `
        }

        <div id="recaptcha-container"></div>

        <button
          id="mainAuthBtn"
          class="primary-btn"
          type="button"
        >
          ${isRegister ? "إنشاء الحساب" : "تسجيل الدخول"}
        </button>

        <p class="switch-auth">
          ${
            isRegister
              ? `عندك حساب بالفعل؟
                 <button id="switchBtn">تسجيل الدخول</button>`
              : `مستخدم جديد؟
                 <button id="switchBtn">إنشاء حساب</button>`
          }
        </p>

      </section>
    </main>
  `;

  document.getElementById("backBtn").onclick = renderHome;

  document.getElementById("customerRole").onclick = () => {
    selectedRole = "customer";

    document
      .getElementById("customerRole")
      .classList.add("active");

    document
      .getElementById("captainRole")
      .classList.remove("active");

    renderCaptainFields(isRegister);
  };

  document.getElementById("captainRole").onclick = () => {
    selectedRole = "captain";

    document
      .getElementById("captainRole")
      .classList.add("active");

    document
      .getElementById("customerRole")
      .classList.remove("active");

    renderCaptainFields(isRegister);
  };

  document.getElementById("phoneMethod").onclick = () => {
    selectedMethod = "phone";

    document
      .getElementById("phoneMethod")
      .classList.add("active");

    document
      .getElementById("emailMethod")
      .classList.remove("active");

    updateContactField();
  };

  document.getElementById("emailMethod").onclick = () => {
    selectedMethod = "email";

    document
      .getElementById("emailMethod")
      .classList.add("active");

    document
      .getElementById("phoneMethod")
      .classList.remove("active");

    updateContactField();
  };

  document.getElementById("switchBtn").onclick = () => {
    renderAuth(isRegister ? "login" : "register");
  };

  document.getElementById("mainAuthBtn").onclick = () => {
    if (isRegister) {
      registerAccount();
    } else {
      loginAccount();
    }
  };

  renderCaptainFields(isRegister);
  updateContactField();
}

function updateContactField() {
  const label = document.getElementById("contactLabel");
  const input = document.getElementById("contact");

  if (!label || !input) return;

  if (selectedMethod === "phone") {
    label.textContent = "رقم الهاتف";
    input.type = "tel";
    input.placeholder = "01012345678";
  } else {
    label.textContent = "البريد الإلكتروني";
    input.type = "email";
    input.placeholder = "example@email.com";
  }
}

function renderCaptainFields(isRegister) {
  const container = document.getElementById("captainFields");

  if (!container) return;

  if (!isRegister || selectedRole !== "captain") {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="captain-box">

      <h3>بيانات الكابتن 🚕</h3>

      <div class="input-group">
        <label>نوع السيارة</label>
        <input
          id="carType"
          type="text"
          placeholder="سيدان / ميكروباص / غيره"
        />
      </div>

      <div class="input-group">
        <label>موديل السيارة</label>
        <input
          id="carModel"
          type="text"
          placeholder="مثال: لانسر"
        />
      </div>

      <div class="input-group">
        <label>رقم السيارة / اللوحة</label>
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
  const button = document.getElementById("mainAuthBtn");

  const name =
    document.getElementById("name")?.value.trim() || "";

  const contact =
    document.getElementById("contact")?.value.trim() || "";

  const password =
    document.getElementById("password")?.value || "";

  if (!name) {
    showMessage("اكتب الاسم بالكامل", "error");
    return;
  }

  if (!contact) {
    showMessage(
      selectedMethod === "phone"
        ? "اكتب رقم الهاتف"
        : "اكتب البريد الإلكتروني",
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
    (!document.getElementById("carType")?.value.trim() ||
      !document.getElementById("carModel")?.value.trim() ||
      !document.getElementById("carNumber")?.value.trim())
  ) {
    showMessage("اكمل بيانات السيارة", "error");
    return;
  }

  loading(button, true);

  try {
    if (selectedMethod === "email") {
      const result = await createUserWithEmailAndPassword(
        auth,
        contact,
        password
      );

      await saveUserProfile(result.user, name);

      await sendEmailVerification(result.user);

      showMessage(
        "تم إنشاء الحساب. راجع بريدك الإلكتروني لتأكيد الحساب.",
        "success"
      );

      setTimeout(() => {
        renderHome();
      }, 2500);

      return;
    }

    /*
      تسجيل الهاتف:
      Firebase Phone Auth يستخدم رمز SMS.
      كلمة المرور لا تستخدم مع تسجيل الهاتف.
    */

    if (password) {
      showMessage(
        "عند التسجيل برقم الهاتف سيتم التحقق برسالة SMS.",
        "info"
      );
    }

    await startPhoneRegistration(name);

  } catch (error) {
    console.error(error);

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  } finally {
    loading(button, false);
  }
}

/* =====================================================
   PHONE REGISTRATION
   ===================================================== */

async function startPhoneRegistration(name) {
  const phone = normalizeEgyptPhone(
    document.getElementById("contact").value
  );

  if (!phone.startsWith("+20")) {
    showMessage(
      "اكتب رقم مصري صحيح مثل 01012345678",
      "error"
    );
    return;
  }

  try {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier =
        new RecaptchaVerifier(
          auth,
          "recaptcha-container",
          {
            size: "normal"
          }
        );
    }

    confirmationResult =
      await signInWithPhoneNumber(
        auth,
        phone,
        window.recaptchaVerifier
      );

    showVerificationBox({
      mode: "register",
      name,
      phone
    });

  } catch (error) {
    console.error(error);

    if (window.recaptchaVerifier) {
      try {
        window.recaptchaVerifier.clear();
      } catch {}
      window.recaptchaVerifier = null;
    }

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  }
}

/* =====================================================
   VERIFICATION BOX
   ===================================================== */

function showVerificationBox(data) {
  const existing = document.getElementById(
    "verificationBox"
  );

  if (existing) existing.remove();

  const box = document.createElement("div");

  box.id = "verificationBox";
  box.className = "verification-box";

  box.innerHTML = `
    <h3>تأكيد رقم الهاتف 📱</h3>

    <p>
      تم إرسال رمز تحقق إلى:
      <strong>${data.phone}</strong>
    </p>

    <input
      id="verificationCode"
      type="text"
      inputmode="numeric"
      maxlength="6"
      placeholder="اكتب رمز التحقق"
    />

    <button
      id="verifyCodeBtn"
      class="primary-btn"
    >
      تأكيد الرمز
    </button>

    <button
      id="cancelVerification"
      class="secondary-btn"
    >
      إلغاء
    </button>
  `;

  document
    .querySelector(".auth-card")
    .appendChild(box);

  document.getElementById("verifyCodeBtn").onclick =
    async () => {
      const code =
        document
          .getElementById("verificationCode")
          .value
          .trim();

      if (code.length !== 6) {
        showMessage(
          "اكتب رمز التحقق المكون من 6 أرقام",
          "error"
        );
        return;
      }

      try {
        const result =
          await confirmationResult.confirm(code);

        if (data.mode === "register") {
          await saveUserProfile(
            result.user,
            data.name
          );
        }

        showMessage(
          "تم تأكيد الحساب بنجاح 🎉",
          "success"
        );

        setTimeout(() => {
          openUserApp(result.user);
        }, 1200);

      } catch (error) {
        console.error(error);

        showMessage(
          firebaseErrorMessage(error),
          "error"
        );
      }
    };

  document.getElementById("cancelVerification").onclick =
    () => {
      box.remove();
    };
}

/* =====================================================
   SAVE PROFILE
   ===================================================== */

async function saveUserProfile(user, name) {
  const profile = {
    uid: user.uid,
    name,
    role: selectedRole,
    phone: user.phoneNumber || "",
    email: user.email || "",
    createdAt: new Date().toISOString()
  };

  if (selectedRole === "captain") {
    profile.carType =
      document.getElementById("carType")?.value.trim() || "";

    profile.carModel =
      document.getElementById("carModel")?.value.trim() || "";

    profile.carNumber =
      document.getElementById("carNumber")?.value.trim() || "";
  }

  await setDoc(
    doc(db, "users", user.uid),
    profile,
    { merge: true }
  );
}

/* =====================================================
   LOGIN
   ===================================================== */

async function loginAccount() {
  const button =
    document.getElementById("mainAuthBtn");

  const contact =
    document.getElementById("contact")?.value.trim() || "";

  const password =
    document.getElementById("password")?.value || "";

  if (!contact) {
    showMessage("اكتب بيانات الدخول", "error");
    return;
  }

  if (!password) {
    showMessage("اكتب كلمة المرور", "error");
    return;
  }

  loading(button, true);

  try {
    if (selectedMethod !== "email") {
      showMessage(
        "تسجيل الدخول بالهاتف سيتم ربطه بالتحقق SMS في الخطوة التالية.",
        "info"
      );

      loading(button, false);
      return;
    }

    const result =
      await signInWithEmailAndPassword(
        auth,
        contact,
        password
      );

    if (!result.user.emailVerified) {
      showMessage(
        "لازم تؤكد بريدك الإلكتروني أولاً.",
        "error"
      );

      await sendEmailVerification(result.user);

      await signOut(auth);

      return;
    }

    const profile =
      await getDoc(
        doc(db, "users", result.user.uid)
      );

    if (!profile.exists()) {
      await saveUserProfile(
        result.user,
        result.user.displayName || "مستخدم"
      );
    } else {
      const data = profile.data();

      if (data.role !== selectedRole) {
        await signOut(auth);

        showMessage(
          "نوع الحساب الذي اخترته لا يطابق الحساب المسجل.",
          "error"
        );

        return;
      }
    }

    openUserApp(result.user);

  } catch (error) {
    console.error(error);

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  } finally {
    loading(button, false);
  }
}

/* =====================================================
   USER APP
   ===================================================== */

async function openUserApp(user) {
  try {
    const profileSnap =
      await getDoc(
        doc(db, "users", user.uid)
      );

    const profile = profileSnap.exists()
      ? profileSnap.data()
      : {
          name: user.displayName || "مستخدم",
          role: selectedRole
        };

    if (profile.role === "captain") {
      renderCaptainHome(profile);
    } else {
      renderCustomerHome(profile);
    }

  } catch (error) {
    console.error(error);

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
          <small>أهلاً بيك</small>
          <h1>${escapeHtml(profile.name || "العميل")}</h1>
        </div>

        <button id="logoutBtn" class="logout-btn">
          خروج
        </button>
      </header>

      <section class="welcome-card">
        <div class="big-icon">🚕</div>
        <h2>جاهز لمشوارك؟</h2>
        <p>
          اطلب رحلتك وحدد المكان والسعر اللي يناسبك.
        </p>
      </section>

      <div class="dashboard-grid">

        <button class="dashboard-btn">
          📍
          <span>حدد موقعي</span>
        </button>

        <button class="dashboard-btn">
          🗺️
          <span>حدد الوجهة</span>
        </button>

        <button class="dashboard-btn">
          🚗
          <span>رحلة جديدة</span>
        </button>

        <button class="dashboard-btn">
          📋
          <span>رحلاتي</span>
        </button>

        <button class="dashboard-btn">
          🔔
          <span>الإشعارات</span>
        </button>

        <button class="dashboard-btn">
          👤
          <span>حسابي</span>
        </button>

      </div>

    </main>
  `;

  document.getElementById("logoutBtn").onclick =
    async () => {
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
          <small>أهلاً يا كابتن</small>
          <h1>${escapeHtml(profile.name || "الكابتن")}</h1>
        </div>

        <button id="logoutBtn" class="logout-btn">
          خروج
        </button>
      </header>

      <section class="captain-status-card">

        <div class="big-icon">🚕</div>

        <h2>حالة الكابتن</h2>

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
          <span>الرحلات المتاحة</span>
        </button>

        <button class="dashboard-btn">
          📋
          <span>رحلاتي ككابتن</span>
        </button>

        <button class="dashboard-btn">
          🔔
          <span>الإشعارات</span>
        </button>

        <button class="dashboard-btn">
          👤
          <span>حسابي</span>
        </button>

      </div>

    </main>
  `;

  const status =
    document.getElementById("captainStatus");

  document.getElementById("availableBtn").onclick =
    () => {
      status.textContent = "متاح لاستقبال الرحلات 🟢";
    };

  document.getElementById("unavailableBtn").onclick =
    () => {
      status.textContent = "غير متاح حاليًا 🔴";
    };

  document.getElementById("logoutBtn").onclick =
    async () => {
      await signOut(auth);
      renderHome();
    };
}

/* =====================================================
   FIREBASE ERROR MESSAGES
   ===================================================== */

function firebaseErrorMessage(error) {
  const code = error?.code || "";

  const messages = {
    "auth/email-already-in-use":
      "البريد الإلكتروني مستخدم بالفعل.",

    "auth/invalid-email":
      "البريد الإلكتروني غير صحيح.",

    "auth/weak-password":
      "كلمة المرور ضعيفة.",

    "auth/user-not-found":
      "الحساب غير موجود.",

    "auth/wrong-password":
      "كلمة المرور غير صحيحة.",

    "auth/invalid-credential":
      "بيانات الدخول غير صحيحة.",

    "auth/too-many-requests":
      "تمت محاولات كثيرة. حاول مرة أخرى لاحقًا.",

    "auth/invalid-verification-code":
      "رمز التحقق غير صحيح.",

    "auth/code-expired":
      "رمز التحقق انتهت صلاحيته.",

    "auth/invalid-phone-number":
      "رقم الهاتف غير صحيح.",

    "auth/quota-exceeded":
      "تم تجاوز حد إرسال الرسائل حاليًا.",

    "auth/network-request-failed":
      "تأكد من اتصال الإنترنت."
  };

  return (
    messages[code] ||
    error?.message ||
    "حدث خطأ غير معروف."
  );
}

/* =====================================================
   ESCAPE HTML
   ===================================================== */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =====================================================
   AUTH STATE
   ===================================================== */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderHome();
    return;
  }

  /*
    لو المستخدم مسجل بالفعل، نحاول تحميل حسابه.
    أثناء التطوير ممكن نرجعه للصفحة الرئيسية
    لو Firebase Config لم يتم وضعه بعد.
  */

  try {
    const profileSnap =
      await getDoc(
        doc(db, "users", user.uid)
      );

    if (profileSnap.exists()) {
      openUserApp(user);
    } else {
      renderHome();
    }

  } catch (error) {
    console.error(error);
    renderHome();
  }
});

/* =====================================================
   START
   ===================================================== */

renderHome();
