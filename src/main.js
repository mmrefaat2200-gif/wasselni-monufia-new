import "./style.css";

import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

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
  getDoc,
  addDoc,
  updateDoc,
  collection,
  serverTimestamp,
  query,
  where,
  onSnapshot
} from "firebase/firestore";

/* ======================================================
   FIREBASE
====================================================== */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let firebaseReady = false;
let app = null;
let auth = null;
let db = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  firebaseReady = true;
} catch (error) {
  console.error("Firebase initialization error:", error);
}

/* ======================================================
   STATE
====================================================== */

let currentUser = null;
let currentProfile = null;

let selectedRole = "customer";

let pickupLocation = null;
let destinationLocation = null;

let tripMap = null;
let pickupMarker = null;
let destinationMarker = null;

/*
  وضع الخريطة الحالي:
  pickup      = اختيار الانطلاق
  destination = اختيار الوصول
*/
let mapMode = null;

/*
  النقطة المختارة حاليًا على الخريطة.
*/
let mapSelection = null;

let selectedRoute = null;

let stopTripsListener = null;
let stopMyTripsListener = null;

/*
   رقم متابعة تحديد الموقع.
*/
let locationWatchId = null;

/* ======================================================
   HELPERS
====================================================== */

function appRoot() {
  return document.getElementById("app");
}

function showMessage(message, type = "info") {
  const root = appRoot();

  if (!root) {
    console.error(message);
    return;
  }

  document
    .querySelectorAll(".app-message")
    .forEach((item) => item.remove());

  const box = document.createElement("div");

  box.className = `app-message ${type}`;
  box.textContent = message;

  root.prepend(box);

  setTimeout(() => {
    if (box.parentNode) {
      box.remove();
    }
  }, 5000);
}

function loading(text = "جاري التحميل...") {
  const root = appRoot();

  if (!root) return;

  root.innerHTML = `
    <div class="loading-screen">
      <div class="loader"></div>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeEgyptPhone(phone) {
  let value = String(phone || "").trim();

  value = value.replace(/\s+/g, "");

  if (value.startsWith("01")) {
    value = "+20" + value.substring(1);
  }

  if (
    value.startsWith("20") &&
    !value.startsWith("+20")
  ) {
    value = "+" + value;
  }

  return value;
}

function isValidEgyptPhone(phone) {
  return /^\+201[0125]\d{8}$/.test(phone);
}

function createInternalLoginEmail(phone, role) {
  const digits = phone.replace(/\D/g, "");

  const roleName =
    role === "captain"
      ? "captain"
      : "customer";

  return `${digits}.${roleName}@login.wasselni-monufia.app`;
}

function firebaseErrorMessage(error) {
  const code = error?.code || "unknown";

  console.error(
    "Firebase error:",
    code,
    error
  );

  const messages = {
    "auth/invalid-credential":
      "رقم الهاتف أو كلمة المرور غير صحيحة.",

    "auth/invalid-login-credentials":
      "رقم الهاتف أو كلمة المرور غير صحيحة.",

    "auth/email-already-in-use":
      "الحساب موجود بالفعل. استخدم تسجيل الدخول.",

    "auth/weak-password":
      "كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.",

    "auth/invalid-email":
      "بيانات الحساب غير صحيحة.",

    "auth/user-not-found":
      "الحساب غير موجود. تأكد من اختيار عميل أو كابتن بشكل صحيح.",

    "auth/wrong-password":
      "كلمة المرور غير صحيحة.",

    "auth/network-request-failed":
      "تأكد من اتصال الإنترنت.",

    "auth/too-many-requests":
      "تمت محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.",

    "permission-denied":
      "صلاحية Firebase غير مسموحة.",

    "failed-precondition":
      "يوجد إعداد ناقص في Firebase.",

    "unavailable":
      "Firebase غير متاح حاليًا. تأكد من الإنترنت وحاول مرة أخرى.",

    "not-found":
      "البيانات المطلوبة غير موجودة."
  };

  return (
    messages[code] ||
    `حدث خطأ أثناء العملية. (${code})`
  );
}

function checkFirebase() {
  if (!firebaseReady || !auth || !db) {
    showMessage(
      "تعذر تشغيل Firebase. تأكد من إعدادات Firebase ثم أعد بناء التطبيق.",
      "error"
    );

    return false;
  }

  return true;
}

function formatDistance(km) {
  const value = Number(km);

  if (!Number.isFinite(value)) {
    return "-";
  }

  if (value < 1) {
    return `${Math.round(value * 1000)} متر`;
  }

  return `${value.toFixed(1)} كم`;
}

function formatDuration(minutes) {
  const value = Number(minutes);

  if (!Number.isFinite(value)) {
    return "-";
  }

  if (value < 60) {
    return `${Math.max(1, Math.round(value))} دقيقة`;
  }

  const hours = Math.floor(value / 60);
  const mins = Math.round(value % 60);

  if (mins === 0) {
    return `${hours} ساعة`;
  }

  return `${hours} ساعة و ${mins} دقيقة`;
}

function formatDate(timestamp) {
  if (!timestamp) return "";

  try {
    const date =
      timestamp.toDate
        ? timestamp.toDate()
        : new Date(timestamp);

    return date.toLocaleString("ar-EG", {
      dateStyle: "short",
      timeStyle: "short"
    });
  } catch {
    return "";
  }
}

function stopAllListeners() {
  if (stopTripsListener) {
    stopTripsListener();
    stopTripsListener = null;
  }

  if (stopMyTripsListener) {
    stopMyTripsListener();
    stopMyTripsListener = null;
  }
}

/* ======================================================
   LOCATION WATCH CLEANUP
====================================================== */

async function stopLocationWatch() {
  if (locationWatchId === null) {
    return;
  }

  try {
    await Geolocation.clearWatch({
      id: locationWatchId
    });
  } catch (error) {
    console.log(
      "CLEAR LOCATION WATCH ERROR:",
      error
    );
  }

  locationWatchId = null;
}

/* ======================================================
   SAVE GPS LOCATION
====================================================== */

async function savePickupPosition(position) {
  const lat =
    Number(position?.coords?.latitude);

  const lng =
    Number(position?.coords?.longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    throw new Error("INVALID_LOCATION");
  }

  pickupLocation = {
    lat,
    lng,
    address:
      `موقع العميل (${lat.toFixed(
        6
      )}, ${lng.toFixed(
        6
      )})`
  };

  const input =
    document.getElementById(
      "pickupAddress"
    );

  if (input) {
    input.value =
      "📍 تم تحديد موقعي الحالي";
  }

  if (destinationLocation) {
    await calculateRoadRoute(
      pickupLocation,
      destinationLocation
    );
  }

  return pickupLocation;
}

/* ======================================================
   LOCATION ERROR
====================================================== */

function locationErrorText(error) {
  const code =
    error?.code ||
    error?.message ||
    "";

  const text =
    String(code).toLowerCase();

  if (
    text.includes("permission") ||
    text.includes("denied") ||
    String(code) === "1"
  ) {
    return "إذن الموقع غير مسموح. يمكنك اختيار مكان الانطلاق يدويًا من الخريطة.";
  }

  if (
    text.includes("timeout") ||
    String(code) === "3"
  ) {
    return "تحديد الموقع أخذ وقتًا أطول من المتوقع. يمكنك اختيار مكان الانطلاق يدويًا من الخريطة.";
  }

  if (
    text.includes("unavailable") ||
    text.includes("location unavailable") ||
    String(code) === "2"
  ) {
    return "الموقع غير متاح حاليًا. يمكنك اختيار مكان الانطلاق يدويًا من الخريطة.";
  }

  return "تعذر تحديد موقعك الحالي. يمكنك اختيار مكان الانطلاق يدويًا من الخريطة.";
}

/* ======================================================
   NORMAL GPS
====================================================== */

async function getNormalNativePosition() {
  return await Geolocation.getCurrentPosition({
    enableHighAccuracy: false,
    timeout: 15000,
    maximumAge: 30000
  });
}

/* ======================================================
   HIGH ACCURACY GPS
====================================================== */

async function getHighAccuracyNativePosition() {
  return await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 0
  });
}

/* ======================================================
   GPS WATCH FALLBACK
====================================================== */

async function watchNativeLocation() {
  await stopLocationWatch();

  return new Promise(
    async (resolve, reject) => {

      let finished = false;

      const timer =
        setTimeout(
          async () => {

            if (finished) return;

            finished = true;

            await stopLocationWatch();

            reject(
              new Error(
                "LOCATION_WATCH_TIMEOUT"
              )
            );

          },
          60000
        );

      try {

        locationWatchId =
          await Geolocation.watchPosition(
            {
              enableHighAccuracy: false,
              timeout: 30000,
              maximumAge: 10000
            },

            async (position, error) => {

              if (finished) return;

              if (error) {
                console.log(
                  "WATCH LOCATION ERROR:",
                  error
                );

                return;
              }

              const lat =
                Number(
                  position?.coords?.latitude
                );

              const lng =
                Number(
                  position?.coords?.longitude
                );

              if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lng)
              ) {
                return;
              }

              finished = true;

              clearTimeout(timer);

              await stopLocationWatch();

              resolve(position);
            }
          );

      } catch (error) {

        clearTimeout(timer);

        if (!finished) {
          finished = true;

          await stopLocationWatch();

          reject(error);
        }
      }
    }
  );
}

/* ======================================================
   OPTIONAL CURRENT LOCATION
====================================================== */

async function getPickupLocation() {

  showMessage(
    "📍 جاري محاولة تحديد موقعك...",
    "info"
  );

  try {

    if (
      Capacitor.isNativePlatform()
    ) {

      if (
        !Capacitor.isPluginAvailable(
          "Geolocation"
        )
      ) {

        showMessage(
          "إضافة الموقع غير موجودة. يمكنك اختيار الانطلاق من الخريطة.",
          "error"
        );

        return;
      }

      let permissions =
        await Geolocation.checkPermissions();

      if (
        permissions.location !==
        "granted"
      ) {

        permissions =
          await Geolocation.requestPermissions({
            permissions: [
              "location"
            ]
          });
      }

      if (
        permissions.location !==
        "granted"
      ) {

        showMessage(
          "لم يتم السماح بالموقع. اختر مكان الانطلاق من الخريطة.",
          "error"
        );

        return;
      }

      try {

        const position =
          await getNormalNativePosition();

        await savePickupPosition(
          position
        );

        await stopLocationWatch();

        showMessage(
          "تم تحديد موقع الانطلاق بنجاح ✅",
          "success"
        );

        return;

      } catch (error) {
        console.log(
          "NORMAL GPS FAILED:",
          error
        );
      }

      try {

        const position =
          await getHighAccuracyNativePosition();

        await savePickupPosition(
          position
        );

        await stopLocationWatch();

        showMessage(
          "تم تحديد موقع الانطلاق بنجاح ✅",
          "success"
        );

        return;

      } catch (error) {
        console.log(
          "HIGH GPS FAILED:",
          error
        );
      }

      try {

        const position =
          await watchNativeLocation();

        await savePickupPosition(
          position
        );

        showMessage(
          "تم تحديد موقع الانطلاق بنجاح ✅",
          "success"
        );

        return;

      } catch (error) {

        console.error(
          "WATCH GPS FAILED:",
          error
        );

        showMessage(
          "تعذر تحديد الموقع الحالي. استخدم الخريطة لاختيار مكان الانطلاق.",
          "error"
        );

        return;
      }
    }

    if (!navigator.geolocation) {

      showMessage(
        "الموقع غير مدعوم على هذا الجهاز. استخدم الخريطة.",
        "error"
      );

      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {

        try {

          await savePickupPosition(
            position
          );

          showMessage(
            "تم تحديد موقع الانطلاق بنجاح ✅",
            "success"
          );

        } catch (error) {

          console.error(
            error
          );

          showMessage(
            "تعذر قراءة موقعك الحالي.",
            "error"
          );
        }
      },

      (firstError) => {

        console.log(
          "BROWSER GPS FAILED:",
          firstError
        );

        navigator.geolocation.getCurrentPosition(
          async (position) => {

            try {

              await savePickupPosition(
                position
              );

              showMessage(
                "تم تحديد موقع الانطلاق بنجاح ✅",
                "success"
              );

            } catch (error) {

              showMessage(
                "تعذر قراءة موقعك الحالي.",
                "error"
              );
            }
          },

          (secondError) => {

            console.error(
              secondError
            );

            showMessage(
              locationErrorText(
                secondError
              ),
              "error"
            );
          },

          {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 0
          }
        );
      },

      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 30000
      }
    );

  } catch (error) {

    console.error(
      "GET PICKUP LOCATION ERROR:",
      error
    );

    showMessage(
      locationErrorText(error),
      "error"
    );
  }
}

/* ======================================================
   HOME
====================================================== */

function renderHome() {
  stopAllListeners();

  const root = appRoot();

  if (!root) return;

  root.innerHTML = `
    <div class="brand">
      <h1>وصلني المنوفية</h1>
      <p>مشوارك أسهل وأسرع</p>
    </div>

    <div class="home-card">
      <h3>اختار طريقة الدخول</h3>

      <button
        id="customerLoginBtn"
        class="primary-btn">
        👤 الدخول كعميل
      </button>

      <button
        id="captainLoginBtn"
        class="secondary-btn">
        🚕 الدخول ككابتن
      </button>

      <button
        id="registerBtn"
        class="secondary-btn">
        إنشاء حساب جديد
      </button>
    </div>
  `;

  document.getElementById(
    "customerLoginBtn"
  ).onclick = () => {
    selectedRole = "customer";
    renderAuth("customer", "login");
  };

  document.getElementById(
    "captainLoginBtn"
  ).onclick = () => {
    selectedRole = "captain";
    renderAuth("captain", "login");
  };

  document.getElementById(
    "registerBtn"
  ).onclick = () => {
    selectedRole = "customer";
    renderAuth("customer", "register");
  };
}

/* ======================================================
   AUTH
====================================================== */

function renderAuth(
  role = "customer",
  mode = "login"
) {
  selectedRole = role;

  const isRegister =
    mode === "register";

  const root = appRoot();

  if (!root) return;

  root.innerHTML = `
    <button
      id="backBtn"
      class="back-btn">
      ← رجوع
    </button>

    <div class="auth-card">

      <h2>
        ${
          isRegister
            ? "إنشاء حساب جديد"
            : "تسجيل الدخول"
        }
      </h2>

      <div class="role-switch">

        <button
          id="customerRoleBtn"
          class="${
            role === "customer"
              ? "active"
              : ""
          }">
          👤 عميل
        </button>

        <button
          id="captainRoleBtn"
          class="${
            role === "captain"
              ? "active"
              : ""
          }">
          🚕 كابتن
        </button>

      </div>

      <div class="selected-role-text">
        ${
          role === "customer"
            ? "أنت الآن تدخل كعميل"
            : "أنت الآن تدخل ككابتن"
        }
      </div>

      <div class="input-group">
        <label>رقم الهاتف</label>

        <input
          id="phoneInput"
          type="tel"
          inputmode="numeric"
          autocomplete="tel"
          placeholder="01xxxxxxxxx"
        />
      </div>

      ${
        isRegister
          ? `
            <div class="input-group">
              <label>الاسم بالكامل</label>

              <input
                id="nameInput"
                type="text"
                autocomplete="name"
                placeholder="اكتب اسمك"
              />
            </div>
          `
          : ""
      }

      ${
        isRegister &&
        role === "captain"
          ? `
            <div class="input-group">
              <label>نوع السيارة</label>

              <input
                id="carTypeInput"
                type="text"
                placeholder="سيدان"
              />
            </div>

            <div class="input-group">
              <label>موديل السيارة</label>

              <input
                id="carModelInput"
                type="text"
                placeholder="لانسر"
              />
            </div>

            <div class="input-group">
              <label>رقم السيارة</label>

              <input
                id="carNumberInput"
                type="text"
                placeholder="م ن 1234"
              />
            </div>
          `
          : ""
      }

      <div class="input-group">
        <label>كلمة المرور</label>

        <input
          id="passwordInput"
          type="password"
          autocomplete="${
            isRegister
              ? "new-password"
              : "current-password"
          }"
          placeholder="كلمة المرور"
        />
      </div>

      <button
        id="authBtn"
        class="primary-btn">
        ${
          isRegister
            ? "إنشاء الحساب"
            : "دخول"
        }
      </button>

      ${
        isRegister
          ? `
            <button
              id="loginInsteadBtn"
              class="link-btn">
              عندي حساب بالفعل
            </button>
          `
          : `
            <button
              id="registerInsteadBtn"
              class="link-btn">
              إنشاء حساب جديد
            </button>
          `
      }

    </div>
  `;

  document.getElementById(
    "backBtn"
  ).onclick = renderHome;

  document.getElementById(
    "customerRoleBtn"
  ).onclick = () => {
    renderAuth("customer", mode);
  };

  document.getElementById(
    "captainRoleBtn"
  ).onclick = () => {
    renderAuth("captain", mode);
  };

  document.getElementById(
    "authBtn"
  ).onclick = () => {
    if (isRegister) {
      registerAccount();
    } else {
      loginAccount();
    }
  };

  if (isRegister) {
    document.getElementById(
      "loginInsteadBtn"
    ).onclick = () => {
      renderAuth(role, "login");
    };
  } else {
    document.getElementById(
      "registerInsteadBtn"
    ).onclick = () => {
      renderAuth(role, "register");
    };
  }
}

/* ======================================================
   REGISTER
====================================================== */

async function registerAccount() {
  if (!checkFirebase()) return;

  const phone =
    normalizeEgyptPhone(
      document.getElementById(
        "phoneInput"
      )?.value
    );

  const password =
    document.getElementById(
      "passwordInput"
    )?.value || "";

  const name =
    document.getElementById(
      "nameInput"
    )?.value.trim() || "";

  if (!isValidEgyptPhone(phone)) {
    showMessage(
      "اكتب رقم هاتف مصري صحيح مثل 01012345678.",
      "error"
    );
    return;
  }

  if (password.length < 6) {
    showMessage(
      "كلمة المرور يجب أن تكون 6 أحرف على الأقل.",
      "error"
    );
    return;
  }

  if (!name) {
    showMessage(
      "اكتب الاسم بالكامل.",
      "error"
    );
    return;
  }

  const email =
    createInternalLoginEmail(
      phone,
      selectedRole
    );

  try {
    loading(
      "جاري إنشاء الحساب..."
    );

    const result =
      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

    const profile = {
      uid: result.user.uid,
      phone,
      name,
      role: selectedRole,
      createdAt: serverTimestamp()
    };

    if (
      selectedRole === "captain"
    ) {

      profile.carType =
        document.getElementById(
          "carTypeInput"
        )?.value.trim() || "";

      profile.carModel =
        document.getElementById(
          "carModelInput"
        )?.value.trim() || "";

      profile.carNumber =
        document.getElementById(
          "carNumberInput"
        )?.value.trim() || "";

      if (
        !profile.carType ||
        !profile.carModel ||
        !profile.carNumber
      ) {

        await signOut(auth);

        renderAuth(
          "captain",
          "register"
        );

        showMessage(
          "اكتب نوع السيارة والموديل ورقم السيارة.",
          "error"
        );

        return;
      }
    }

    await setDoc(
      doc(
        db,
        "users",
        result.user.uid
      ),
      profile
    );

    currentUser =
      result.user;

    currentProfile = {
      ...profile,
      createdAt: null
    };

    if (
      selectedRole === "captain"
    ) {

      renderCaptainHome(
        currentProfile
      );

    } else {

      renderCustomerHome(
        currentProfile
      );
    }

    showMessage(
      "تم إنشاء الحساب بنجاح ✅",
      "success"
    );

  } catch (error) {

    console.error(
      "REGISTER ERROR:",
      error
    );

    renderAuth(
      selectedRole,
      "register"
    );

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  }
}

/* ======================================================
   LOGIN
====================================================== */

async function loginAccount() {
  if (!checkFirebase()) return;

  const phone =
    normalizeEgyptPhone(
      document.getElementById(
        "phoneInput"
      )?.value
    );

  const password =
    document.getElementById(
      "passwordInput"
    )?.value || "";

  const roleAtLogin =
    selectedRole;

  if (!isValidEgyptPhone(phone)) {
    showMessage(
      "اكتب رقم هاتف مصري صحيح مثل 01012345678.",
      "error"
    );
    return;
  }

  if (!password) {
    showMessage(
      "اكتب كلمة المرور.",
      "error"
    );
    return;
  }

  const email =
    createInternalLoginEmail(
      phone,
      roleAtLogin
    );

  try {

    loading(
      roleAtLogin === "captain"
        ? "جاري دخول الكابتن..."
        : "جاري دخول العميل..."
    );

    const result =
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    currentUser =
      result.user;

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

      currentUser = null;
      currentProfile = null;

      renderAuth(
        roleAtLogin,
        "login"
      );

      showMessage(
        "بيانات الحساب غير موجودة.",
        "error"
      );

      return;
    }

    currentProfile =
      profileSnap.data();

    if (
      currentProfile.role &&
      currentProfile.role !==
        roleAtLogin
    ) {

      await signOut(auth);

      currentUser = null;
      currentProfile = null;

      renderAuth(
        roleAtLogin,
        "login"
      );

      showMessage(
        "هذا الحساب مسجل بنوع مختلف.",
        "error"
      );

      return;
    }

    if (
      roleAtLogin === "captain"
    ) {

      renderCaptainHome(
        currentProfile
      );

    } else {

      renderCustomerHome(
        currentProfile
      );
    }

    showMessage(
      "تم تسجيل الدخول بنجاح ✅",
      "success"
    );

  } catch (error) {

    console.error(
      "LOGIN ERROR:",
      error
    );

    renderAuth(
      roleAtLogin,
      "login"
    );

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  }
}

/* ======================================================
   CUSTOMER HOME
====================================================== */

function renderCustomerHome(
  profile
) {
  stopAllListeners();

  const root = appRoot();

  if (!root) return;

  root.innerHTML = `
    <div class="dashboard">

      <div class="dashboard-header">
        <h2>
          أهلاً ${
            escapeHtml(
              profile?.name || "بك"
            )
          } 👋
        </h2>

        <p>
          عميل - وصلني المنوفية
        </p>
      </div>

      <button
        id="newTripBtn"
        class="primary-btn big-btn">
        🚕 رحلة جديدة
      </button>

      <button
        id="myTripsBtn"
        class="secondary-btn">
        📋 رحلاتي
      </button>

      <button
        id="accountBtn"
        class="secondary-btn">
        👤 حسابي
      </button>

      <button
        id="logoutBtn"
        class="danger-btn">
        تسجيل الخروج
      </button>

    </div>
  `;

  document.getElementById(
    "newTripBtn"
  ).onclick =
    () => renderNewTripPage();

  document.getElementById(
    "myTripsBtn"
  ).onclick =
    renderCustomerTrips;

  document.getElementById(
    "accountBtn"
  ).onclick =
    renderCustomerAccount;

  document.getElementById(
    "logoutBtn"
  ).onclick =
    logoutUser;
}

/* ======================================================
   CUSTOMER ACCOUNT
====================================================== */

function renderCustomerAccount() {
  const profile =
    currentProfile || {};

  appRoot().innerHTML = `
    <button
      id="backBtn"
      class="back-btn">
      ← رجوع
    </button>

    <div class="dashboard">

      <div class="dashboard-header">
        <h2>👤 حسابي</h2>
      </div>

      <div class="profile-box">

        <p>
          <strong>الاسم:</strong>
          ${escapeHtml(
            profile.name || "-"
          )}
        </p>

        <p>
          <strong>رقم الهاتف:</strong>
          ${escapeHtml(
            profile.phone || "-"
          )}
        </p>

        <p>
          <strong>نوع الحساب:</strong>
          عميل
        </p>

      </div>

    </div>
  `;

  document.getElementById(
    "backBtn"
  ).onclick = () => {
    renderCustomerHome(
      currentProfile
    );
  };
}

/* ======================================================
   CAPTAIN HOME
====================================================== */

function renderCaptainHome(
  profile
) {
  stopAllListeners();

  const root = appRoot();

  if (!root) return;

  root.innerHTML = `
    <div class="dashboard">

      <div class="dashboard-header">

        <h2>
          أهلاً ${
            escapeHtml(
              profile?.name || "كابتن"
            )
          } 🚕
        </h2>

        <p>
          منصة الكباتن - وصلني المنوفية
        </p>

      </div>

      <button
        id="availableTripsBtn"
        class="primary-btn big-btn">
        🚕 الرحلات المتاحة
      </button>

      <button
        id="captainTripsBtn"
        class="secondary-btn">
        📋 رحلاتي ككابتن
      </button>

      <div class="profile-box">

        <p>
          <strong>نوع السيارة:</strong>
          ${escapeHtml(
            profile?.carType || "-"
          )}
        </p>

        <p>
          <strong>الموديل:</strong>
          ${escapeHtml(
            profile?.carModel || "-"
          )}
        </p>

        <p>
          <strong>رقم السيارة:</strong>
          ${escapeHtml(
            profile?.carNumber || "-"
          )}
        </p>

      </div>

      <button
        id="logoutBtn"
        class="danger-btn">
        تسجيل الخروج
      </button>

    </div>
  `;

  document.getElementById(
    "availableTripsBtn"
  ).onclick =
    renderAvailableTrips;

  document.getElementById(
    "captainTripsBtn"
  ).onclick =
    renderCaptainTrips;

  document.getElementById(
    "logoutBtn"
  ).onclick =
    logoutUser;
}

/* ======================================================
   LOGOUT
====================================================== */

async function logoutUser() {
  stopAllListeners();

  await stopLocationWatch();

  try {

    if (auth) {
      await signOut(auth);
    }

  } catch (error) {

    console.error(
      "LOGOUT ERROR:",
      error
    );
  }

  currentUser = null;
  currentProfile = null;

  pickupLocation = null;
  destinationLocation = null;
  selectedRoute = null;
  mapMode = null;
  mapSelection = null;

  destroyMap();

  renderHome();
}

/* ======================================================
   NEW TRIP
====================================================== */

function renderNewTripPage(
  preserveLocations = false
) {

  if (!preserveLocations) {
    pickupLocation = null;
    destinationLocation = null;
    selectedRoute = null;
  }

  appRoot().innerHTML = `
    <button
      id="backBtn"
      class="back-btn">
      ← رجوع
    </button>

    <div class="trip-card">

      <h2>
        🚕 رحلة جديدة
      </h2>

      <div class="input-group">

        <label>
          📍 مكان الانطلاق
        </label>

        <button
          id="choosePickupBtn"
          class="map-select-btn">
          ${
            pickupLocation
              ? "📍 تعديل مكان الانطلاق من الخريطة"
              : "🗺️ اختر مكان الانطلاق من الخريطة"
          }
        </button>

        <input
          id="pickupAddress"
          type="text"
          placeholder="لم يتم اختيار مكان الانطلاق"
          readonly
        />

        <button
          id="locationBtn"
          class="secondary-btn"
          style="margin-top:8px;">
          📍 حاول تحديد موقعي الحالي
        </button>

      </div>

      <div class="input-group">

        <label>
          🏁 مكان الوصول
        </label>

        <button
          id="chooseDestinationBtn"
          class="map-select-btn">
          ${
            destinationLocation
              ? "🏁 تعديل مكان الوصول من الخريطة"
              : "🗺️ اختر مكان الوصول من الخريطة"
          }
        </button>

        <input
          id="destinationAddress"
          type="text"
          placeholder="لم يتم اختيار مكان الوصول"
          readonly
        />

      </div>

      <div
        id="routeInfo"
        style="
          display:none;
          margin:12px 0;
          padding:14px;
          border-radius:12px;
          background:#eef7ff;
          text-align:center;
        ">
      </div>

      <div class="input-group">

        <label>
          عدد الركاب
        </label>

        <select id="passengerCount">

          ${Array.from(
            { length: 8 },
            (_, i) => `
              <option value="${i + 1}">
                ${i + 1}
                ${
                  i === 0
                    ? "راكب"
                    : "ركاب"
                }
              </option>
            `
          ).join("")}

        </select>

      </div>

      <div class="input-group">

        <label>
          ملاحظات
        </label>

        <textarea
          id="tripNotes"
          rows="3"
          placeholder="مثلاً: شنطة كبيرة أو محتاج عربية واسعة"></textarea>

      </div>

      <div class="input-group">

        <label>
          السعر المقترح
        </label>

        <input
          id="proposedPrice"
          type="number"
          min="1"
          inputmode="numeric"
          placeholder="اكتب السعر بالجنيه"
        />

      </div>

      <button
        id="submitTripBtn"
        class="primary-btn big-btn">
        🚕 اطلب الرحلة
      </button>

    </div>
  `;

  document.getElementById(
    "backBtn"
  ).onclick =
    () =>
      renderCustomerHome(
        currentProfile
      );

  /*
    الانطلاق الآن من الخريطة.
  */
  document.getElementById(
    "choosePickupBtn"
  ).onclick = () =>
    openLocationMap("pickup");

  /*
    GPS أصبح اختياري فقط.
  */
  document.getElementById(
    "locationBtn"
  ).onclick =
    getPickupLocation;

  /*
    الوصول من الخريطة.
  */
  document.getElementById(
    "chooseDestinationBtn"
  ).onclick = () =>
    openLocationMap("destination");

  document.getElementById(
    "submitTripBtn"
  ).onclick =
    createTrip;

  if (pickupLocation) {

    const input =
      document.getElementById(
        "pickupAddress"
      );

    if (input) {
      input.value =
        pickupLocation.address ||
        "📍 تم تحديد الانطلاق";
    }
  }

  if (destinationLocation) {

    const input =
      document.getElementById(
        "destinationAddress"
      );

    if (input) {
      input.value =
        destinationLocation.address ||
        "";
    }
  }

  if (
    selectedRoute &&
    destinationLocation
  ) {

    showRouteInfo(
      selectedRoute.distanceKm,
      selectedRoute.durationMinutes
    );
  }
}

/* ======================================================
   SHARED LOCATION MAP
====================================================== */

function openLocationMap(
  mode
) {

  mapMode = mode;

  destroyMap();

  const isPickup =
    mode === "pickup";

  const existingLocation =
    isPickup
      ? pickupLocation
      : destinationLocation;

  /*
    لو فيه نقطة محفوظة نبدأ منها.
    لو مفيش نبدأ من منطقة المنوفية/مصر.
  */

  if (existingLocation) {

    mapSelection = {
      lat:
        Number(
          existingLocation.lat
        ),

      lng:
        Number(
          existingLocation.lng
        ),

      address:
        existingLocation.address ||
        ""
    };

  } else {

    mapSelection = null;
  }

  appRoot().innerHTML = `
    <div
      style="
        width:100%;
        height:100vh;
        display:flex;
        flex-direction:column;
        background:#fff;
        overflow:hidden;
        direction:rtl;
      "
    >

      <div
        class="map-topbar"
        style="
          flex-shrink:0;
          z-index:1000;
          display:flex;
          gap:6px;
          align-items:center;
          padding:8px;
          background:#fff;
        "
      >

        <button
          id="closeMapBtn"
          type="button">
          ✕
        </button>

        <input
          id="placeSearch"
          type="search"
          style="flex:1;"
          placeholder="${
            isPickup
              ? "ابحث عن مكان الانطلاق..."
              : "ابحث عن مكان الوصول..."
          }"
        />

        <button
          id="searchBtn"
          type="button">
          🔎
        </button>

      </div>

      <div
        style="
          padding:8px 12px;
          background:#f5f9ff;
          border-bottom:1px solid #ddd;
          text-align:center;
          flex-shrink:0;
          font-weight:bold;
        "
      >
        ${
          isPickup
            ? "📍 حدد مكان الانطلاق"
            : "🏁 حدد مكان الوصول"
        }
      </div>

      <div
        id="locationMap"
        style="
          width:100%;
          height:calc(100vh - 235px);
          min-height:360px;
          flex:1;
          background:#e5e5e5;
          position:relative;
        "
      ></div>

      <div
        class="map-bottom-panel"
        style="
          flex-shrink:0;
          z-index:1000;
          background:#fff;
          padding:10px;
          box-shadow:0 -3px 12px rgba(0,0,0,.10);
        "
      >

        <div
          id="selectedPlace"
          style="
            min-height:40px;
            padding:8px;
            border-radius:10px;
            background:#f5f7fa;
            text-align:center;
            font-size:14px;
          "
        >
          ${
            existingLocation?.address ||
            "حرّك الخريطة وضع العلامة على المكان المطلوب"
          }
        </div>

        <button
          id="useGpsBtn"
          type="button"
          class="secondary-btn"
          style="margin-top:8px;"
        >
          📍 حاول تحديد موقعي الحالي
        </button>

        <button
          id="confirmLocationBtn"
          type="button"
          class="primary-btn"
          style="margin-top:8px;"
        >
          ${
            isPickup
              ? "✅ تأكيد مكان الانطلاق"
              : "✅ تأكيد مكان الوصول"
          }
        </button>

      </div>

    </div>
  `;

  document.getElementById(
    "closeMapBtn"
  ).onclick = () => {

    destroyMap();

    renderNewTripPage(
      true
    );
  };

  document.getElementById(
    "searchBtn"
  ).onclick =
    searchLocationOnMap;

  document.getElementById(
    "placeSearch"
  ).addEventListener(
    "keydown",
    (event) => {

      if (event.key === "Enter") {
        searchLocationOnMap();
      }

    }
  );

  document.getElementById(
    "useGpsBtn"
  ).onclick =
    useCurrentLocationOnMap;

  document.getElementById(
    "confirmLocationBtn"
  ).onclick =
    confirmMapLocation;

  setTimeout(
    initializeLocationMap,
    250
  );
}

/* ======================================================
   DESTROY MAP
====================================================== */

function destroyMap() {

  if (tripMap) {

    try {

      tripMap.off();
      tripMap.remove();

    } catch (error) {

      console.log(
        "MAP DESTROY ERROR:",
        error
      );
    }
  }

  tripMap = null;

  pickupMarker = null;

  destinationMarker = null;

  mapSelection = null;
}

/* ======================================================
   INITIALIZE LOCATION MAP
====================================================== */

function initializeLocationMap() {

  const mapElement =
    document.getElementById(
      "locationMap"
    );

  if (!mapElement) return;

  if (tripMap) {
    destroyMap();
  }

  const isPickup =
    mapMode === "pickup";

  let center = [
    30.5526,
    31.0106
  ];

  let zoom = 7;

  /*
    لو فيه اختيار سابق نبدأ عليه.
  */

  const existingLocation =
    isPickup
      ? pickupLocation
      : destinationLocation;

  if (
    existingLocation &&
    Number.isFinite(
      Number(existingLocation.lat)
    ) &&
    Number.isFinite(
      Number(existingLocation.lng)
    )
  ) {

    center = [
      Number(existingLocation.lat),
      Number(existingLocation.lng)
    ];

    zoom = 16;

  } else if (pickupLocation) {

    /*
      عند اختيار الوصول، نبدأ من مكان الانطلاق.
    */

    if (!isPickup) {

      center = [
        Number(pickupLocation.lat),
        Number(pickupLocation.lng)
      ];

      zoom = 14;
    }
  }

  tripMap =
    L.map(
      mapElement,
      {
        zoomControl: true,
        attributionControl: true
      }
    ).setView(
      center,
      zoom
    );

  L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        "© OpenStreetMap contributors"
    }
  ).addTo(tripMap);

  /*
    Marker ثابت في منتصف الخريطة.
  */

  destinationMarker =
    L.marker(center)
      .addTo(tripMap);

  destinationMarker.bindPopup(
    isPickup
      ? "📍 مكان الانطلاق"
      : "🏁 مكان الوصول"
  );

  /*
    لو فيه نقطة انطلاق ونختار الوصول
    نظهرها بعلامة إضافية.
  */

  if (
    !isPickup &&
    pickupLocation
  ) {

    pickupMarker =
      L.marker([
        pickupLocation.lat,
        pickupLocation.lng
      ])
        .addTo(tripMap)
        .bindPopup(
          "📍 مكان الانطلاق"
        );
  }

  /*
    لو فيه نقطة وصول ونختار الانطلاق
    نظهرها بعلامة إضافية.
  */

  if (
    isPickup &&
    destinationLocation
  ) {

    destinationMarker.bindPopup(
      "📍 مكان الانطلاق"
    );
  }

  /*
    عند تحريك الخريطة:
    العلامة تظل في المنتصف.
  */

  tripMap.on(
    "moveend",
    updateLocationMapCenter
  );

  /*
    عند الضغط على الخريطة
    ننقل مركز الخريطة للنقطة.
  */

  tripMap.on(
    "click",
    (event) => {

      if (!tripMap) return;

      tripMap.setView(
        [
          event.latlng.lat,
          event.latlng.lng
        ],
        Math.max(
          tripMap.getZoom(),
          15
        ),
        {
          animate: true
        }
      );

    }
  );

  /*
    إصلاح مشكلة اختفاء الخريطة.
  */

  setTimeout(() => {

    if (tripMap) {
      tripMap.invalidateSize(true);
    }

  }, 100);

  setTimeout(() => {

    if (tripMap) {
      tripMap.invalidateSize(true);
    }

  }, 500);

  setTimeout(() => {

    if (tripMap) {
      tripMap.invalidateSize(true);
    }

  }, 1000);

  /*
    إنشاء اختيار أولي.
  */

  updateLocationMapCenter();
}

/* ======================================================
   UPDATE MAP CENTER
====================================================== */

function updateLocationMapCenter() {

  if (!tripMap) return;

  const center =
    tripMap.getCenter();

  const lat =
    Number(center.lat);

  const lng =
    Number(center.lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return;
  }

  /*
    لا نعمل Reverse Geocoding مع كل حركة.
    ده يمنع كثرة الطلبات ومشاكل الخريطة.
  */

  const oldAddress =
    mapSelection?.address || "";

  mapSelection = {
    lat,
    lng,
    address:
      oldAddress &&
      !oldAddress.startsWith(
        "نقطة على الخريطة"
      )
        ? oldAddress
        : `نقطة على الخريطة (${lat.toFixed(
            6
          )}, ${lng.toFixed(
            6
          )})`
  };

  if (destinationMarker) {

    destinationMarker.setLatLng([
      lat,
      lng
    ]);
  }

  const selected =
    document.getElementById(
      "selectedPlace"
    );

  if (selected) {

    selected.textContent =
      `📍 ${lat.toFixed(
        6
      )}, ${lng.toFixed(
        6
      )}`;
  }
}

/* ======================================================
   SELECT MAP LOCATION
====================================================== */

async function selectLocationOnMap(
  lat,
  lng,
  address = ""
) {

  lat = Number(lat);
  lng = Number(lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return;
  }

  mapSelection = {
    lat,
    lng,
    address:
      address ||
      `نقطة على الخريطة (${lat.toFixed(
        6
      )}, ${lng.toFixed(
        6
      )})`
  };

  if (destinationMarker) {

    destinationMarker.setLatLng([
      lat,
      lng
    ]);
  }

  const selected =
    document.getElementById(
      "selectedPlace"
    );

  if (selected) {

    selected.textContent =
      `📍 ${
        mapSelection.address
      }`;
  }
}

/* ======================================================
   SEARCH LOCATION ON MAP
====================================================== */

async function searchLocationOnMap() {

  const input =
    document.getElementById(
      "placeSearch"
    );

  const searchQuery =
    input?.value.trim();

  if (!searchQuery) {

    showMessage(
      "اكتب اسم المكان أولاً.",
      "error"
    );

    return;
  }

  try {

    showMessage(
      "جاري البحث عن المكان...",
      "info"
    );

    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ar&countrycodes=eg&q=${encodeURIComponent(
        searchQuery
      )}`;

    const response =
      await fetch(
        url,
        {
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        "SEARCH_FAILED"
      );
    }

    const results =
      await response.json();

    if (
      !Array.isArray(results) ||
      !results.length
    ) {

      showMessage(
        "لم يتم العثور على المكان.",
        "error"
      );

      return;
    }

    const first =
      results[0];

    const lat =
      Number(first.lat);

    const lng =
      Number(first.lon);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {

      showMessage(
        "إحداثيات المكان غير صحيحة.",
        "error"
      );

      return;
    }

    await selectLocationOnMap(
      lat,
      lng,
      first.display_name ||
        `المكان المحدد (${lat.toFixed(
          6
        )}, ${lng.toFixed(
          6
        )})`
    );

    if (tripMap) {

      tripMap.setView(
        [lat, lng],
        17,
        {
          animate: true
        }
      );

      setTimeout(() => {

        if (tripMap) {
          tripMap.invalidateSize(
            true
          );
        }

      }, 300);
    }

    const selected =
      document.getElementById(
        "selectedPlace"
      );

    if (selected) {

      selected.textContent =
        `📍 ${
          first.display_name
        }`;
    }

    showMessage(
      "تم العثور على المكان ✅",
      "success"
    );

  } catch (error) {

    console.error(
      "MAP SEARCH ERROR:",
      error
    );

    showMessage(
      "حصل خطأ أثناء البحث عن المكان.",
      "error"
    );
  }
}

/* ======================================================
   REVERSE GEOCODING
====================================================== */

async function reverseGeocodeLocation(
  lat,
  lng
) {

  try {

    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&lat=${lat}&lon=${lng}`;

    const response =
      await fetch(
        url,
        {
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    if (!response.ok) {
      return null;
    }

    const data =
      await response.json();

    return (
      data?.display_name ||
      null
    );

  } catch (error) {

    console.log(
      "Reverse geocoding failed:",
      error
    );

    return null;
  }
}

/* ======================================================
   USE CURRENT LOCATION INSIDE MAP
====================================================== */

async function useCurrentLocationOnMap() {

  try {

    showMessage(
      "📍 جاري محاولة تحديد موقعك...",
      "info"
    );

    let position = null;

    /*
      Android / Capacitor
    */

    if (
      Capacitor.isNativePlatform()
    ) {

      if (
        !Capacitor.isPluginAvailable(
          "Geolocation"
        )
      ) {

        showMessage(
          "تحديد الموقع غير متاح. اختار المكان يدويًا من الخريطة.",
          "error"
        );

        return;
      }

      let permissions =
        await Geolocation.checkPermissions();

      if (
        permissions.location !==
        "granted"
      ) {

        permissions =
          await Geolocation.requestPermissions({
            permissions: [
              "location"
            ]
          });
      }

      if (
        permissions.location !==
        "granted"
      ) {

        showMessage(
          "لم يتم السماح بالموقع. اختار المكان يدويًا من الخريطة.",
          "error"
        );

        return;
      }

      try {

        position =
          await getNormalNativePosition();

      } catch {

        try {

          position =
            await getHighAccuracyNativePosition();

        } catch {

          position = null;
        }
      }

    } else {

      /*
        Browser fallback
      */

      if (
        !navigator.geolocation
      ) {

        showMessage(
          "الموقع غير مدعوم. اختار المكان يدويًا.",
          "error"
        );

        return;
      }

      position =
        await new Promise(
          (resolve) => {

            navigator.geolocation.getCurrentPosition(
              resolve,
              () => resolve(null),
              {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 30000
              }
            );

          }
        );
    }

    const lat =
      Number(
        position?.coords?.latitude
      );

    const lng =
      Number(
        position?.coords?.longitude
      );

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {

      showMessage(
        "تعذر تحديد موقعك الحالي. يمكنك اختيار المكان يدويًا من الخريطة.",
        "error"
      );

      return;
    }

    const address =
      await reverseGeocodeLocation(
        lat,
        lng
      );

    await selectLocationOnMap(
      lat,
      lng,
      address ||
        `موقعك الحالي (${lat.toFixed(
          6
        )}, ${lng.toFixed(
          6
        )})`
    );

    if (tripMap) {

      tripMap.setView(
        [lat, lng],
        17,
        {
          animate: true
        }
      );

      setTimeout(() => {

        if (tripMap) {
          tripMap.invalidateSize(
            true
          );
        }

      }, 300);
    }

    showMessage(
      "تم وضع موقعك الحالي على الخريطة ✅",
      "success"
    );

  } catch (error) {

    console.error(
      "USE CURRENT LOCATION ON MAP ERROR:",
      error
    );

    showMessage(
      "تعذر تحديد موقعك الحالي. اختار المكان يدويًا من الخريطة.",
      "error"
    );
  }
}

/* ======================================================
   CONFIRM MAP LOCATION
====================================================== */

async function confirmMapLocation() {

  if (
    !mapSelection ||
    !Number.isFinite(
      Number(mapSelection.lat)
    ) ||
    !Number.isFinite(
      Number(mapSelection.lng)
    )
  ) {

    showMessage(
      mapMode === "pickup"
        ? "حدد مكان الانطلاق من الخريطة أولاً."
        : "حدد مكان الوصول من الخريطة أولاً.",
      "error"
    );

    return;
  }

  const button =
    document.getElementById(
      "confirmLocationBtn"
    );

  if (button) {
    button.disabled = true;
    button.textContent =
      "جاري تحديد العنوان...";
  }

  try {

    const lat =
      Number(mapSelection.lat);

    const lng =
      Number(mapSelection.lng);

    /*
      نجيب عنوان حقيقي من الخريطة.
    */

    let address =
      mapSelection.address || "";

    if (
      !address ||
      address.startsWith(
        "نقطة على الخريطة"
      )
    ) {

      const reverseAddress =
        await reverseGeocodeLocation(
          lat,
          lng
        );

      if (reverseAddress) {
        address =
          reverseAddress;
      }
    }

    if (!address) {

      address =
        `نقطة على الخريطة (${lat.toFixed(
          6
        )}, ${lng.toFixed(
          6
        )})`;
    }

    const savedLocation = {
      lat,
      lng,
      address
    };

    /*
      حفظ الانطلاق.
    */

    if (
      mapMode === "pickup"
    ) {

      pickupLocation =
        savedLocation;

    } else {

      /*
        حفظ الوصول.
      */

      destinationLocation =
        savedLocation;
    }

    destroyMap();

    /*
      لو النقطتين موجودين نحسب الطريق.
    */

    if (
      pickupLocation &&
      destinationLocation
    ) {

      await calculateRoadRoute(
        pickupLocation,
        destinationLocation
      );
    }

    renderNewTripPage(
      true
    );

    showMessage(
      mapMode === "pickup"
        ? "تم تحديد مكان الانطلاق بنجاح ✅"
        : "تم تحديد مكان الوصول بنجاح ✅",
      "success"
    );

    mapMode = null;

  } catch (error) {

    console.error(
      "CONFIRM MAP LOCATION ERROR:",
      error
    );

    if (button) {
      button.disabled = false;
      button.textContent =
        mapMode === "pickup"
          ? "✅ تأكيد مكان الانطلاق"
          : "✅ تأكيد مكان الوصول";
    }

    showMessage(
      "حصل خطأ أثناء تأكيد المكان. حاول مرة أخرى.",
      "error"
    );
  }
}

/* ======================================================
   ROAD ROUTE - OSRM
====================================================== */

async function calculateRoadRoute(
  from,
  to
) {

  if (!from || !to) {
    return null;
  }

  const mapRouteInfo =
    document.getElementById(
      "mapRouteInfo"
    );

  const pageRouteInfo =
    document.getElementById(
      "routeInfo"
    );

  if (mapRouteInfo) {

    mapRouteInfo.style.display =
      "block";

    mapRouteInfo.innerHTML =
      "⏳ جاري حساب مسافة الطريق...";
  }

  if (pageRouteInfo) {

    pageRouteInfo.style.display =
      "block";

    pageRouteInfo.innerHTML =
      "⏳ جاري حساب مسافة الطريق...";
  }

  try {

    const url =
      `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&steps=false`;

    const response =
      await fetch(url);

    if (!response.ok) {

      throw new Error(
        "ROUTE_REQUEST_FAILED"
      );
    }

    const data =
      await response.json();

    if (
      data.code !== "Ok" ||
      !data.routes ||
      !data.routes.length
    ) {

      throw new Error(
        "NO_ROUTE"
      );
    }

    const route =
      data.routes[0];

    const distanceKm =
      route.distance / 1000;

    const durationMinutes =
      route.duration / 60;

    selectedRoute = {
      distanceKm,
      durationMinutes
    };

    if (destinationLocation) {

      destinationLocation.distanceKm =
        distanceKm;

      destinationLocation.durationMinutes =
        durationMinutes;
    }

    showRouteInfo(
      distanceKm,
      durationMinutes
    );

    return selectedRoute;

  } catch (error) {

    console.error(
      "OSRM ROUTE ERROR:",
      error
    );

    selectedRoute = null;

    if (mapRouteInfo) {

      mapRouteInfo.style.display =
        "block";

      mapRouteInfo.innerHTML =
        "⚠️ تعذر حساب مسافة الطريق حاليًا.";
    }

    if (pageRouteInfo) {

      pageRouteInfo.style.display =
        "block";

      pageRouteInfo.innerHTML =
        "⚠️ تعذر حساب مسافة الطريق حاليًا.";
    }

    return null;
  }
}

/* ======================================================
   SHOW ROUTE INFO
====================================================== */

function showRouteInfo(
  distanceKm,
  durationMinutes
) {

  const html = `
    📏 المسافة:
    <strong>
      ${formatDistance(distanceKm)}
    </strong>
    <br>
    ⏱️ الوقت التقريبي:
    <strong>
      ${formatDuration(durationMinutes)}
    </strong>
  `;

  const mapRouteInfo =
    document.getElementById(
      "mapRouteInfo"
    );

  if (mapRouteInfo) {

    mapRouteInfo.style.display =
      "block";

    mapRouteInfo.innerHTML =
      html;
  }

  const pageRouteInfo =
    document.getElementById(
      "routeInfo"
    );

  if (pageRouteInfo) {

    pageRouteInfo.style.display =
      "block";

    pageRouteInfo.innerHTML =
      html;
  }
}

/* ======================================================
   CREATE TRIP
====================================================== */

async function createTrip() {

  if (
    !currentUser ||
    !currentProfile
  ) {

    showMessage(
      "يجب تسجيل الدخول أولاً.",
      "error"
    );

    return;
  }

  if (!pickupLocation) {

    showMessage(
      "حدد مكان الانطلاق من الخريطة أولاً.",
      "error"
    );

    return;
  }

  if (!destinationLocation) {

    showMessage(
      "حدد مكان الوصول من الخريطة أولاً.",
      "error"
    );

    return;
  }

  const passengerCount =
    Number(
      document.getElementById(
        "passengerCount"
      )?.value
    );

  const notes =
    document.getElementById(
      "tripNotes"
    )?.value.trim() || "";

  const proposedPrice =
    Number(
      document.getElementById(
        "proposedPrice"
      )?.value
    );

  if (
    !passengerCount ||
    passengerCount < 1 ||
    passengerCount > 8
  ) {

    showMessage(
      "حدد عدد الركاب من 1 إلى 8.",
      "error"
    );

    return;
  }

  if (
    !proposedPrice ||
    proposedPrice <= 0
  ) {

    showMessage(
      "اكتب السعر المقترح.",
      "error"
    );

    return;
  }

  try {

    const button =
      document.getElementById(
        "submitTripBtn"
      );

    if (button) {

      button.disabled = true;

      button.textContent =
        "جاري حساب المسافة...";
    }

    let route =
      selectedRoute;

    if (
      !route ||
      !Number.isFinite(
        Number(
          route.distanceKm
        )
      )
    ) {

      route =
        await calculateRoadRoute(
          pickupLocation,
          destinationLocation
        );
    }

    if (!route) {

      if (button) {

        button.disabled = false;

        button.textContent =
          "🚕 اطلب الرحلة";
      }

      showMessage(
        "لم نتمكن من حساب مسافة الطريق.",
        "error"
      );

      return;
    }

    if (button) {

      button.textContent =
        "جاري إرسال الرحلة...";
    }

    const tripData = {

      customerId:
        currentUser.uid,

      customerName:
        currentProfile.name || "",

      customerPhone:
        currentProfile.phone || "",

      pickup: {

        lat:
          pickupLocation.lat,

        lng:
          pickupLocation.lng,

        address:
          pickupLocation.address || ""
      },

      destination: {

        lat:
          destinationLocation.lat,

        lng:
          destinationLocation.lng,

        address:
          destinationLocation.address || ""
      },

      distanceKm:
        Number(
          route.distanceKm
        ),

      durationMinutes:
        Number(
          route.durationMinutes
        ),

      passengerCount,

      notes,

      proposedPrice,

      status:
        "open",

      acceptedCaptainId:
        null,

      acceptedCaptainName:
        null,

      acceptedCaptainPhone:
        null,

      acceptedAt:
        null,

      createdAt:
        serverTimestamp()
    };

    const tripRef =
      await addDoc(
        collection(
          db,
          "trips"
        ),
        tripData
      );

    console.log(
      "TRIP CREATED:",
      tripRef.id
    );

    if (button) {

      button.disabled = false;

      button.textContent =
        "🚕 اطلب الرحلة";
    }

    appRoot().innerHTML = `
      <div class="page-container">

        <div class="success-card">

          <div
            style="
              font-size:60px;
              margin-bottom:15px;
            ">
            ✅
          </div>

          <h2>
            تم طلب الرحلة بنجاح
          </h2>

          <p>
            تم إرسال رحلتك للكباتن المتاحين.
          </p>

          <div
            style="
              margin-top:18px;
              padding:15px;
              border-radius:12px;
              background:#eef7ff;
            ">

            <p>
              📏 المسافة:
              <strong>
                ${formatDistance(
                  route.distanceKm
                )}
              </strong>
            </p>

            <p>
              ⏱️ الوقت التقريبي:
              <strong>
                ${formatDuration(
                  route.durationMinutes
                )}
              </strong>
            </p>

            <p>
              👥 عدد الركاب:
              <strong>
                ${passengerCount}
              </strong>
            </p>

            <p>
              💰 السعر المقترح:
              <strong>
                ${proposedPrice} جنيه
              </strong>
            </p>

          </div>

          <button
            id="myTripNowBtn"
            class="secondary-btn"
            style="margin-top:15px;">
            📋 متابعة الرحلة
          </button>

          <button
            id="backCustomerBtn"
            class="primary-btn big-btn"
            style="margin-top:10px;">
            ← العودة للرئيسية
          </button>

        </div>

      </div>
    `;

    document.getElementById(
      "myTripNowBtn"
    ).onclick =
      renderCustomerTrips;

    document.getElementById(
      "backCustomerBtn"
    ).onclick = () => {

      renderCustomerHome(
        currentProfile
      );
    };

  } catch (error) {

    console.error(
      "CREATE TRIP ERROR:",
      error
    );

    const button =
      document.getElementById(
        "submitTripBtn"
      );

    if (button) {

      button.disabled = false;

      button.textContent =
        "🚕 اطلب الرحلة";
    }

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  }
}

/* ======================================================
   AVAILABLE TRIPS
====================================================== */

function renderAvailableTrips() {

  if (
    !currentUser ||
    currentProfile?.role !==
      "captain"
  ) {

    showMessage(
      "يجب تسجيل الدخول ككابتن أولاً.",
      "error"
    );

    return;
  }

  stopAllListeners();

  appRoot().innerHTML = `
    <button
      id="backCaptainHomeBtn"
      class="back-btn">
      ← رجوع
    </button>

    <div class="dashboard">

      <div class="dashboard-header">

        <h2>
          🚕 الرحلات المتاحة
        </h2>

        <p>
          الرحلات الجديدة تظهر هنا تلقائيًا
        </p>

      </div>

      <div id="availableTripsList">

        <div class="loading-screen">
          <div class="loader"></div>
          <p>جاري تحميل الرحلات...</p>
        </div>

      </div>

    </div>
  `;

  document.getElementById(
    "backCaptainHomeBtn"
  ).onclick = () => {

    renderCaptainHome(
      currentProfile
    );
  };

  listenForAvailableTrips();
}

/* ======================================================
   LISTEN OPEN TRIPS
====================================================== */

function listenForAvailableTrips() {

  const list =
    document.getElementById(
      "availableTripsList"
    );

  if (!list) return;

  try {

    const tripsQuery =
      query(
        collection(
          db,
          "trips"
        ),
        where(
          "status",
          "==",
          "open"
        )
      );

    stopTripsListener =
      onSnapshot(
        tripsQuery,
        (snapshot) => {

          if (snapshot.empty) {

            list.innerHTML = `
              <div class="empty-state">

                <div class="empty-icon">
                  🚕
                </div>

                <h3>
                  لا توجد رحلات متاحة الآن
                </h3>

                <p>
                  عندما يطلب عميل رحلة ستظهر هنا تلقائيًا.
                </p>

              </div>
            `;

            return;
          }

          const trips = [];

          snapshot.forEach(
            (tripDoc) => {

              trips.push({
                id:
                  tripDoc.id,
                ...tripDoc.data()
              });

            }
          );

          trips.sort(
            (a, b) => {

              const aTime =
                a.createdAt?.seconds ||
                0;

              const bTime =
                b.createdAt?.seconds ||
                0;

              return bTime - aTime;
            }
          );

          list.innerHTML = "";

          trips.forEach(
            (trip) => {

              list.appendChild(
                createCaptainTripCard(
                  trip,
                  trip.id
                )
              );

            }
          );

        },

        (error) => {

          console.error(
            "CAPTAIN TRIPS ERROR:",
            error
          );

          list.innerHTML = `
            <div class="empty-state">

              <h3>
                حصل خطأ في تحميل الرحلات
              </h3>

              <p>
                ${escapeHtml(
                  firebaseErrorMessage(
                    error
                  )
                )}
              </p>

            </div>
          `;
        }
      );

  } catch (error) {

    console.error(error);

    list.innerHTML = `
      <div class="empty-state">
        <h3>
          تعذر تحميل الرحلات
        </h3>
      </div>
    `;
  }
}

/* ======================================================
   CAPTAIN TRIP CARD
====================================================== */

function createCaptainTripCard(
  trip,
  tripId
) {

  const card =
    document.createElement(
      "div"
    );

  card.className =
    "captain-trip-card trip-card";

  const pickupAddress =
    trip.pickup?.address ||
    "موقع الانطلاق غير محدد";

  const destinationAddress =
    trip.destination?.address ||
    "مكان الوصول غير محدد";

  const passengerCount =
    trip.passengerCount || 1;

  const notes =
    trip.notes ||
    "لا توجد ملاحظات";

  const price =
    trip.proposedPrice || 0;

  const customerName =
    trip.customerName ||
    "عميل";

  const customerPhone =
    trip.customerPhone ||
    "";

  const distanceText =
    trip.distanceKm != null
      ? formatDistance(
          trip.distanceKm
        )
      : "غير محسوبة";

  const durationText =
    trip.durationMinutes != null
      ? formatDuration(
          trip.durationMinutes
        )
      : "غير محسوبة";

  card.innerHTML = `
    <div class="trip-card-header">

      <h3>
        🚕 رحلة جديدة
      </h3>

      <span class="trip-status">
        مفتوحة
      </span>

    </div>

    <div class="trip-info">

      <div class="trip-info-row">
        <strong>👤 العميل</strong>
        <span>
          ${escapeHtml(
            customerName
          )}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>📍 الانطلاق</strong>
        <span>
          ${escapeHtml(
            pickupAddress
          )}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>🏁 الوصول</strong>
        <span>
          ${escapeHtml(
            destinationAddress
          )}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>📏 المسافة</strong>
        <span>
          ${distanceText}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>⏱️ المدة</strong>
        <span>
          ${durationText}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>👥 الركاب</strong>
        <span>
          ${passengerCount}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>📝 الملاحظات</strong>
        <span>
          ${escapeHtml(notes)}
        </span>
      </div>

      <div class="trip-price">
        💰 السعر المقترح:
        <strong>
          ${price} جنيه
        </strong>
      </div>

    </div>

    <div class="trip-actions">

      ${
        customerPhone
          ? `
            <a
              class="primary-btn"
              href="tel:${escapeHtml(
                customerPhone
              )}">
              📞 اتصال بالعميل
            </a>
          `
          : ""
      }

      <button
        class="secondary-btn offerTripBtn">
        💰 تقديم عرض سعر
      </button>

      <button
        class="primary-btn acceptTripBtn">
        ✅ قبول الرحلة
      </button>

    </div>
  `;

  card.querySelector(
    ".offerTripBtn"
  ).onclick = () => {

    openOfferDialog(
      trip,
      tripId
    );
  };

  card.querySelector(
    ".acceptTripBtn"
  ).onclick = () => {

    acceptTrip(
      trip,
      tripId
    );
  };

  return card;
}

/* ======================================================
   OFFER DIALOG
====================================================== */

function openOfferDialog(
  trip,
  tripId
) {

  const old =
    document.getElementById(
      "offerDialog"
    );

  if (old) old.remove();

  const dialog =
    document.createElement(
      "div"
    );

  dialog.id =
    "offerDialog";

  dialog.style.cssText = `
    position:fixed;
    inset:0;
    background:rgba(0,0,0,.55);
    display:flex;
    align-items:center;
    justify-content:center;
    z-index:99999;
    padding:15px;
  `;

  dialog.innerHTML = `
    <div
      style="
        background:#fff;
        width:100%;
        max-width:420px;
        border-radius:18px;
        padding:20px;
        direction:rtl;
      ">

      <h3>
        💰 تقديم عرض سعر
      </h3>

      <p>
        السعر المقترح من العميل:
        <strong>
          ${escapeHtml(
            trip.proposedPrice || 0
          )} جنيه
        </strong>
      </p>

      <div class="input-group">

        <label>
          السعر الذي تقترحه
        </label>

        <input
          id="offerPriceInput"
          type="number"
          min="1"
          inputmode="numeric"
          placeholder="اكتب السعر"
          value="${
            trip.proposedPrice || ""
          }"
        />

      </div>

      <div
        style="
          display:flex;
          gap:10px;
          margin-top:15px;
        ">

        <button
          id="cancelOfferBtn"
          class="secondary-btn">
          إلغاء
        </button>

        <button
          id="sendOfferBtn"
          class="primary-btn">
          إرسال العرض
        </button>

      </div>

    </div>
  `;

  document.body.appendChild(
    dialog
  );

  document.getElementById(
    "cancelOfferBtn"
  ).onclick = () => {

    dialog.remove();
  };

  document.getElementById(
    "sendOfferBtn"
  ).onclick = async () => {

    const value =
      Number(
        document.getElementById(
          "offerPriceInput"
        )?.value
      );

    if (!value || value <= 0) {

      showMessage(
        "اكتب سعر صحيح.",
        "error"
      );

      return;
    }

    dialog.remove();

    await sendTripOffer(
      trip,
      tripId,
      value
    );
  };
}

/* ======================================================
   SEND OFFER
====================================================== */

async function sendTripOffer(
  trip,
  tripId,
  price
) {

  if (
    !currentUser ||
    currentProfile?.role !==
      "captain"
  ) {

    showMessage(
      "يجب تسجيل الدخول ككابتن.",
      "error"
    );

    return;
  }

  try {

    const existingQuery =
      query(
        collection(
          db,
          "trips",
          tripId,
          "offers"
        ),
        where(
          "captainId",
          "==",
          currentUser.uid
        )
      );

    const existingSnapshot =
      await new Promise(
        (resolve, reject) => {

          const unsubscribe =
            onSnapshot(
              existingQuery,
              (snapshot) => {

                unsubscribe();

                resolve(
                  snapshot
                );
              },

              (error) => {

                unsubscribe();

                reject(error);
              }
            );
        }
      );

    if (
      !existingSnapshot.empty
    ) {

      showMessage(
        "أنت قدمت عرضًا لهذه الرحلة بالفعل.",
        "error"
      );

      return;
    }

    await addDoc(
      collection(
        db,
        "trips",
        tripId,
        "offers"
      ),
      {

        captainId:
          currentUser.uid,

        captainName:
          currentProfile.name || "",

        captainPhone:
          currentProfile.phone || "",

        carType:
          currentProfile.carType || "",

        carModel:
          currentProfile.carModel || "",

        carNumber:
          currentProfile.carNumber || "",

        price:
          Number(price),

        status:
          "pending",

        createdAt:
          serverTimestamp()
      }
    );

    showMessage(
      "تم إرسال عرض السعر للعميل ✅",
      "success"
    );

  } catch (error) {

    console.error(
      "SEND OFFER ERROR:",
      error
    );

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  }
}

/* ======================================================
   ACCEPT TRIP
====================================================== */

async function acceptTrip(
  trip,
  tripId
) {

  if (
    !currentUser ||
    currentProfile?.role !==
      "captain"
  ) {

    showMessage(
      "يجب تسجيل الدخول ككابتن.",
      "error"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `هل تريد قبول الرحلة بسعر ${
        trip.proposedPrice || 0
      } جنيه؟`
    );

  if (!confirmed) return;

  try {

    const tripRef =
      doc(
        db,
        "trips",
        tripId
      );

    const freshTrip =
      await getDoc(
        tripRef
      );

    if (!freshTrip.exists()) {

      showMessage(
        "الرحلة غير موجودة.",
        "error"
      );

      return;
    }

    const currentTrip =
      freshTrip.data();

    if (
      currentTrip.status !==
      "open"
    ) {

      showMessage(
        "الرحلة تم قبولها بالفعل أو لم تعد متاحة.",
        "error"
      );

      return;
    }

    await updateDoc(
      tripRef,
      {

        status:
          "accepted",

        acceptedCaptainId:
          currentUser.uid,

        acceptedCaptainName:
          currentProfile.name || "",

        acceptedCaptainPhone:
          currentProfile.phone || "",

        acceptedCaptainCarType:
          currentProfile.carType || "",

        acceptedCaptainCarModel:
          currentProfile.carModel || "",

        acceptedCaptainCarNumber:
          currentProfile.carNumber || "",

        finalPrice:
          Number(
            trip.proposedPrice || 0
          ),

        acceptedAt:
          serverTimestamp()
      }
    );

    showMessage(
      "تم قبول الرحلة بنجاح ✅",
      "success"
    );

    renderCaptainTrips();

  } catch (error) {

    console.error(
      "ACCEPT TRIP ERROR:",
      error
    );

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  }
}

/* ======================================================
   CUSTOMER TRIPS
====================================================== */

function renderCustomerTrips() {

  if (
    !currentUser ||
    currentProfile?.role !==
      "customer"
  ) {

    showMessage(
      "يجب تسجيل الدخول كعميل.",
      "error"
    );

    return;
  }

  stopAllListeners();

  appRoot().innerHTML = `
    <button
      id="backBtn"
      class="back-btn">
      ← رجوع
    </button>

    <div class="dashboard">

      <div class="dashboard-header">

        <h2>
          📋 رحلاتي
        </h2>

        <p>
          تابع رحلاتك والعروض المقدمة عليها
        </p>

      </div>

      <div id="customerTripsList">

        <div class="loading-screen">
          <div class="loader"></div>
          <p>جاري تحميل رحلاتك...</p>
        </div>

      </div>

    </div>
  `;

  document.getElementById(
    "backBtn"
  ).onclick = () => {

    renderCustomerHome(
      currentProfile
    );
  };

  listenForCustomerTrips();
}

/* ======================================================
   CUSTOMER TRIP LISTENER
====================================================== */

function listenForCustomerTrips() {

  const list =
    document.getElementById(
      "customerTripsList"
    );

  if (!list) return;

  const tripsQuery =
    query(
      collection(
        db,
        "trips"
      ),
      where(
        "customerId",
        "==",
        currentUser.uid
      )
    );

  stopMyTripsListener =
    onSnapshot(
      tripsQuery,
      (snapshot) => {

        if (snapshot.empty) {

          list.innerHTML = `
            <div class="empty-state">

              <div class="empty-icon">
                📋
              </div>

              <h3>
                لا توجد رحلات حتى الآن
              </h3>

              <p>
                عندما تطلب رحلة ستظهر هنا.
              </p>

            </div>
          `;

          return;
        }

        const trips = [];

        snapshot.forEach(
          (tripDoc) => {

            trips.push({
              id:
                tripDoc.id,
              ...tripDoc.data()
            });

          }
        );

        trips.sort(
          (a, b) => {

            const aTime =
              a.createdAt?.seconds ||
              0;

            const bTime =
              b.createdAt?.seconds ||
              0;

            return bTime - aTime;
          }
        );

        list.innerHTML = "";

        trips.forEach(
          (trip) => {

            list.appendChild(
              createCustomerTripCard(
                trip,
                trip.id
              )
            );

          }
        );
      },

      (error) => {

        console.error(
          "CUSTOMER TRIPS ERROR:",
          error
        );

        list.innerHTML = `
          <div class="empty-state">

            <h3>
              تعذر تحميل الرحلات
            </h3>

            <p>
              ${escapeHtml(
                firebaseErrorMessage(
                  error
                )
              )}
            </p>

          </div>
        `;
      }
    );
}

/* ======================================================
   CUSTOMER TRIP CARD
====================================================== */

function createCustomerTripCard(
  trip,
  tripId
) {

  const card =
    document.createElement(
      "div"
    );

  card.className =
    "trip-card";

  let statusText =
    "مفتوحة";

  if (
    trip.status ===
    "accepted"
  ) {

    statusText =
      "تم قبولها";
  }

  if (
    trip.status ===
    "completed"
  ) {

    statusText =
      "مكتملة";
  }

  card.innerHTML = `
    <div class="trip-card-header">

      <h3>
        🚕 رحلتي
      </h3>

      <span class="trip-status">
        ${statusText}
      </span>

    </div>

    <div class="trip-info">

      <div class="trip-info-row">
        <strong>📍 الانطلاق</strong>
        <span>
          ${escapeHtml(
            trip.pickup?.address ||
            "-"
          )}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>🏁 الوصول</strong>
        <span>
          ${escapeHtml(
            trip.destination?.address ||
            "-"
          )}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>📏 المسافة</strong>
        <span>
          ${
            trip.distanceKm != null
              ? formatDistance(
                  trip.distanceKm
                )
              : "-"
          }
        </span>
      </div>

      <div class="trip-info-row">
        <strong>⏱️ المدة</strong>
        <span>
          ${
            trip.durationMinutes != null
              ? formatDuration(
                  trip.durationMinutes
                )
              : "-"
          }
        </span>
      </div>

      <div class="trip-info-row">
        <strong>👥 الركاب</strong>
        <span>
          ${trip.passengerCount || 1}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>📝 الملاحظات</strong>
        <span>
          ${escapeHtml(
            trip.notes ||
            "لا توجد"
          )}
        </span>
      </div>

      <div class="trip-price">
        💰 السعر المقترح:
        <strong>
          ${
            trip.proposedPrice ||
            0
          } جنيه
        </strong>
      </div>

      ${
        trip.acceptedCaptainName
          ? `
            <div
              style="
                margin-top:12px;
                padding:12px;
                border-radius:12px;
                background:#eef7ff;
              ">

              <strong>
                🚕 الكابتن:
              </strong>

              <div>
                ${escapeHtml(
                  trip.acceptedCaptainName
                )}
              </div>

              ${
                trip.acceptedCaptainCarType
                  ? `
                    <div>
                      🚘 السيارة:
                      ${escapeHtml(
                        trip.acceptedCaptainCarType
                      )}
                    </div>
                  `
                  : ""
              }

              ${
                trip.acceptedCaptainCarModel
                  ? `
                    <div>
                      🚗 الموديل:
                      ${escapeHtml(
                        trip.acceptedCaptainCarModel
                      )}
                    </div>
                  `
                  : ""
              }

              ${
                trip.acceptedCaptainCarNumber
                  ? `
                    <div>
                      🔢 رقم السيارة:
                      ${escapeHtml(
                        trip.acceptedCaptainCarNumber
                      )}
                    </div>
                  `
                  : ""
              }

              ${
                trip.acceptedCaptainPhone
                  ? `
                    <a
                      class="primary-btn"
                      style="margin-top:10px;"
                      href="tel:${escapeHtml(
                        trip.acceptedCaptainPhone
                      )}">
                      📞 اتصال بالكابتن
                    </a>
                  `
                  : ""
              }

              ${
                trip.finalPrice != null
                  ? `
                    <div class="trip-price">
                      💰 السعر النهائي:
                      <strong>
                        ${trip.finalPrice} جنيه
                      </strong>
                    </div>
                  `
                  : ""
              }

            </div>
          `
          : ""
      }

    </div>

    ${
      trip.status === "open"
        ? `
          <button
            class="secondary-btn viewOffersBtn">
            💰 مشاهدة العروض
          </button>
        `
        : ""
    }
  `;

  const offersButton =
    card.querySelector(
      ".viewOffersBtn"
    );

  if (offersButton) {

    offersButton.onclick =
      () => {

        renderTripOffers(
          trip,
          tripId
        );
      };
  }

  return card;
}

/* ======================================================
   TRIP OFFERS
====================================================== */

function renderTripOffers(
  trip,
  tripId
) {

  stopAllListeners();

  appRoot().innerHTML = `
    <button
      id="backBtn"
      class="back-btn">
      ← رجوع
    </button>

    <div class="dashboard">

      <div class="dashboard-header">

        <h2>
          💰 عروض الكباتن
        </h2>

        <p>
          السعر المقترح:
          <strong>
            ${
              trip.proposedPrice ||
              0
            } جنيه
          </strong>
        </p>

      </div>

      <div id="offersList">

        <div class="loading-screen">
          <div class="loader"></div>
          <p>جاري تحميل العروض...</p>
        </div>

      </div>

    </div>
  `;

  document.getElementById(
    "backBtn"
  ).onclick =
    renderCustomerTrips;

  listenForTripOffers(
    trip,
    tripId
  );
}

/* ======================================================
   LISTEN OFFERS
====================================================== */

function listenForTripOffers(
  trip,
  tripId
) {

  const list =
    document.getElementById(
      "offersList"
    );

  if (!list) return;

  const offersQuery =
    query(
      collection(
        db,
        "trips",
        tripId,
        "offers"
      ),
      where(
        "status",
        "==",
        "pending"
      )
    );

  stopMyTripsListener =
    onSnapshot(
      offersQuery,
      (snapshot) => {

        if (snapshot.empty) {

          list.innerHTML = `
            <div class="empty-state">

              <div class="empty-icon">
                💰
              </div>

              <h3>
                لا توجد عروض حتى الآن
              </h3>

              <p>
                عندما يقدم أحد الكباتن عرضًا سيظهر هنا.
              </p>

            </div>
          `;

          return;
        }

        const offers = [];

        snapshot.forEach(
          (offerDoc) => {

            offers.push({
              id:
                offerDoc.id,
              ...offerDoc.data()
            });

          }
        );

        offers.sort(
          (a, b) => {

            const aTime =
              a.createdAt?.seconds ||
              0;

            const bTime =
              b.createdAt?.seconds ||
              0;

            return bTime - aTime;
          }
        );

        list.innerHTML = "";

        offers.forEach(
          (offer) => {

            const card =
              document.createElement(
                "div"
              );

            card.className =
              "trip-card";

            card.innerHTML = `
              <div class="trip-card-header">

                <h3>
                  🚕 ${
                    escapeHtml(
                      offer.captainName ||
                      "كابتن"
                    )
                  }
                </h3>

                <span class="trip-status">
                  عرض جديد
                </span>

              </div>

              <div class="trip-info">

                <div class="trip-info-row">
                  <strong>🚕 السيارة</strong>
                  <span>
                    ${escapeHtml(
                      offer.carType ||
                      "-"
                    )}
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>🚘 الموديل</strong>
                  <span>
                    ${escapeHtml(
                      offer.carModel ||
                      "-"
                    )}
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>🔢 رقم السيارة</strong>
                  <span>
                    ${escapeHtml(
                      offer.carNumber ||
                      "-"
                    )}
                  </span>
                </div>

                <div class="trip-price">
                  💰 عرض الكابتن:
                  <strong>
                    ${offer.price} جنيه
                  </strong>
                </div>

              </div>

              <div class="trip-actions">

                <button
                  class="primary-btn acceptOfferBtn">
                  ✅ قبول العرض
                </button>

                ${
                  offer.captainPhone
                    ? `
                      <a
                        class="secondary-btn"
                        href="tel:${escapeHtml(
                          offer.captainPhone
                        )}">
                        📞 اتصال
                      </a>
                    `
                    : ""
                }

              </div>
            `;

            card.querySelector(
              ".acceptOfferBtn"
            ).onclick = () => {

              acceptCaptainOffer(
                trip,
                tripId,
                offer
              );
            };

            list.appendChild(
              card
            );
          }
        );
      },

      (error) => {

        console.error(
          "OFFERS ERROR:",
          error
        );

        list.innerHTML = `
          <div class="empty-state">

            <h3>
              تعذر تحميل العروض
            </h3>

            <p>
              ${escapeHtml(
                firebaseErrorMessage(
                  error
                )
              )}
            </p>

          </div>
        `;
      }
    );
}

/* ======================================================
   ACCEPT CAPTAIN OFFER
====================================================== */

async function acceptCaptainOffer(
  trip,
  tripId,
  offer
) {

  if (
    !currentUser ||
    currentProfile?.role !==
      "customer"
  ) {

    showMessage(
      "يجب تسجيل الدخول كعميل.",
      "error"
    );

    return;
  }

  const confirmed =
    window.confirm(
      `هل تريد قبول عرض ${
        offer.price
      } جنيه من الكابتن ${
        offer.captainName || ""
      }؟`
    );

  if (!confirmed) return;

  try {

    const tripRef =
      doc(
        db,
        "trips",
        tripId
      );

    const freshTrip =
      await getDoc(
        tripRef
      );

    if (!freshTrip.exists()) {

      showMessage(
        "الرحلة غير موجودة.",
        "error"
      );

      return;
    }

    const currentTrip =
      freshTrip.data();

    if (
      currentTrip.status !==
      "open"
    ) {

      showMessage(
        "الرحلة لم تعد مفتوحة.",
        "error"
      );

      return;
    }

    await updateDoc(
      tripRef,
      {

        status:
          "accepted",

        acceptedCaptainId:
          offer.captainId,

        acceptedCaptainName:
          offer.captainName || "",

        acceptedCaptainPhone:
          offer.captainPhone || "",

        acceptedCaptainCarType:
          offer.carType || "",

        acceptedCaptainCarModel:
          offer.carModel || "",

        acceptedCaptainCarNumber:
          offer.carNumber || "",

        finalPrice:
          Number(
            offer.price
          ),

        acceptedAt:
          serverTimestamp()
      }
    );

    await updateDoc(
      doc(
        db,
        "trips",
        tripId,
        "offers",
        offer.id
      ),
      {
        status:
          "accepted"
      }
    );

    showMessage(
      "تم قبول عرض الكابتن بنجاح ✅",
      "success"
    );

    renderCustomerTrips();

  } catch (error) {

    console.error(
      "ACCEPT OFFER ERROR:",
      error
    );

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );
  }
}
/* ======================================================
   CAPTAIN TRIPS
====================================================== */

function renderCaptainTrips() {

  if (
    !currentUser ||
    currentProfile?.role !==
      "captain"
  ) {

    showMessage(
      "يجب تسجيل الدخول ككابتن.",
      "error"
    );

    return;
  }

  stopAllListeners();

  appRoot().innerHTML = `
    <button
      id="backBtn"
      class="back-btn">
      ← رجوع
    </button>

    <div class="dashboard">

      <div class="dashboard-header">

        <h2>
          📋 رحلاتي ككابتن
        </h2>

        <p>
          الرحلات التي قبلتها
        </p>

      </div>

      <div id="captainTripsList">

        <div class="loading-screen">
          <div class="loader"></div>
          <p>جاري تحميل الرحلات...</p>
        </div>

      </div>

    </div>
  `;

  document.getElementById(
    "backBtn"
  ).onclick = () => {

    renderCaptainHome(
      currentProfile
    );
  };

  listenForCaptainTrips();
}

/* ======================================================
   CAPTAIN TRIPS LISTENER
====================================================== */

function listenForCaptainTrips() {

  const list =
    document.getElementById(
      "captainTripsList"
    );

  if (!list) return;

  const acceptedQuery =
    query(
      collection(
        db,
        "trips"
      ),
      where(
        "acceptedCaptainId",
        "==",
        currentUser.uid
      )
    );

  stopTripsListener =
    onSnapshot(
      acceptedQuery,
      (snapshot) => {

        if (snapshot.empty) {

          list.innerHTML = `
            <div class="empty-state">

              <div class="empty-icon">
                🚕
              </div>

              <h3>
                لا توجد رحلات حتى الآن
              </h3>

              <p>
                الرحلات التي تقبلها ستظهر هنا.
              </p>

            </div>
          `;

          return;
        }

        const trips = [];

        snapshot.forEach(
          (tripDoc) => {

            trips.push({
              id:
                tripDoc.id,
              ...tripDoc.data()
            });

          }
        );

        trips.sort(
          (a, b) => {

            const aTime =
              a.acceptedAt?.seconds ||
              a.createdAt?.seconds ||
              0;

            const bTime =
              b.acceptedAt?.seconds ||
              b.createdAt?.seconds ||
              0;

            return bTime - aTime;
          }
        );

        list.innerHTML = "";

        trips.forEach(
          (trip) => {

            const card =
              document.createElement(
                "div"
              );

            card.className =
              "trip-card";

            card.innerHTML = `
              <div class="trip-card-header">

                <h3>
                  🚕 رحلة مقبولة
                </h3>

                <span class="trip-status">
                  ${
                    trip.status ===
                    "completed"
                      ? "مكتملة"
                      : "مقبولة"
                  }
                </span>

              </div>

              <div class="trip-info">

                <div class="trip-info-row">
                  <strong>👤 العميل</strong>
                  <span>
                    ${escapeHtml(
                      trip.customerName ||
                      "-"
                    )}
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>📞 الهاتف</strong>
                  <span>
                    ${escapeHtml(
                      trip.customerPhone ||
                      "-"
                    )}
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>📍 الانطلاق</strong>
                  <span>
                    ${escapeHtml(
                      trip.pickup?.address ||
                      "-"
                    )}
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>🏁 الوصول</strong>
                  <span>
                    ${escapeHtml(
                      trip.destination?.address ||
                      "-"
                    )}
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>📏 المسافة</strong>
                  <span>
                    ${
                      trip.distanceKm != null
                        ? formatDistance(
                            trip.distanceKm
                          )
                        : "-"
                    }
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>⏱️ المدة</strong>
                  <span>
                    ${
                      trip.durationMinutes != null
                        ? formatDuration(
                            trip.durationMinutes
                          )
                        : "-"
                    }
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>👥 الركاب</strong>
                  <span>
                    ${
                      trip.passengerCount ||
                      1
                    }
                  </span>
                </div>

                <div class="trip-info-row">
                  <strong>📝 الملاحظات</strong>
                  <span>
                    ${escapeHtml(
                      trip.notes ||
                      "لا توجد"
                    )}
                  </span>
                </div>

                <div class="trip-price">
                  💰 السعر النهائي:
                  <strong>
                    ${
                      trip.finalPrice ??
                      trip.proposedPrice ??
                      0
                    } جنيه
                  </strong>
                </div>

              </div>

              ${
                trip.customerPhone
                  ? `
                    <a
                      class="primary-btn"
                      href="tel:${escapeHtml(
                        trip.customerPhone
                      )}">
                      📞 اتصال بالعميل
                    </a>
                  `
                  : ""
              }

            `;

            list.appendChild(
              card
            );
          }
        );
      },

      (error) => {

        console.error(
          "CAPTAIN HISTORY ERROR:",
          error
        );

        list.innerHTML = `
          <div class="empty-state">

            <h3>
              تعذر تحميل رحلاتك
            </h3>

            <p>
              ${escapeHtml(
                firebaseErrorMessage(
                  error
                )
              )}
            </p>

          </div>
        `;
      }
    );
}

/* ======================================================
   AUTH STATE
====================================================== */

if (firebaseReady) {

  onAuthStateChanged(
    auth,
    async (user) => {

      if (!user) {

        currentUser = null;
        currentProfile = null;

        renderHome();

        return;
      }

      try {

        currentUser = user;

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

          currentUser = null;
          currentProfile = null;

          renderHome();

          showMessage(
            "لم يتم العثور على بيانات الحساب.",
            "error"
          );

          return;
        }

        currentProfile =
          profileSnap.data();

        if (
          currentProfile.role ===
          "captain"
        ) {

          renderCaptainHome(
            currentProfile
          );

        } else {

          renderCustomerHome(
            currentProfile
          );
        }

      } catch (error) {

        console.error(
          "AUTH STATE ERROR:",
          error
        );

        currentUser = null;
        currentProfile = null;

        renderHome();

        showMessage(
          firebaseErrorMessage(
            error
          ),
          "error"
        );
      }
    }
  );

} else {

  renderHome();

    }
