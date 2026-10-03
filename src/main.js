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
  collection,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  orderBy
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
let app;
let auth;
let db;

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

let selectedRoute = null;

let stopCaptainTripsListener = null;

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

  const old = document.querySelector(".app-message");

  if (old) {
    old.remove();
  }

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

  if (!root) {
    return;
  }

  root.innerHTML = `
    <div class="loading-screen">
      <div class="loader"></div>
      <p>${text}</p>
    </div>
  `;
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
    "Firebase error code:",
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
      "Firebase غير متاح حاليًا. تأكد من الإنترنت وحاول مرة أخرى."
  };

  return (
    messages[code] ||
    `حدث خطأ أثناء العملية. (${code})`
  );
}

function checkFirebase() {
  if (!firebaseReady || !auth || !db) {
    showMessage(
      "تعذر تشغيل Firebase. تأكد من إعدادات Firebase في GitHub Secrets ثم أعد بناء التطبيق.",
      "error"
    );

    return false;
  }

  return true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

/* ======================================================
   HOME
====================================================== */

function renderHome() {
  const root = appRoot();

  if (!root) {
    return;
  }

  root.innerHTML = `
    <div class="page-container">

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

  const isRegister = mode === "register";

  const root = appRoot();

  if (!root) {
    return;
  }

  root.innerHTML = `
    <div class="page-container">

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
          isRegister && role === "captain"
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
  if (!checkFirebase()) {
    return;
  }

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
    loading("جاري إنشاء الحساب...");

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

    if (selectedRole === "captain") {
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
    }

    await setDoc(
      doc(
        db,
        "users",
        result.user.uid
      ),
      profile
    );

    currentUser = result.user;
    currentProfile = profile;

    if (selectedRole === "captain") {
      renderCaptainHome(profile);
    } else {
      renderCustomerHome(profile);
    }

    showMessage(
      "تم إنشاء الحساب بنجاح.",
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
  if (!checkFirebase()) {
    return;
  }

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

  const roleAtLogin = selectedRole;

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

    currentUser = result.user;

    const profileSnap =
      await getDoc(
        doc(
          db,
          "users",
          result.user.uid
        )
      );

    if (!profileSnap.exists()) {
      currentProfile = {
        uid: result.user.uid,
        phone,
        name: "",
        role: roleAtLogin
      };

      await setDoc(
        doc(
          db,
          "users",
          result.user.uid
        ),
        {
          ...currentProfile,
          createdAt:
            serverTimestamp()
        },
        {
          merge: true
        }
      );
    } else {
      currentProfile =
        profileSnap.data();
    }

    if (
      currentProfile.role &&
      currentProfile.role !== roleAtLogin
    ) {
      await signOut(auth);

      currentUser = null;
      currentProfile = null;

      renderAuth(
        roleAtLogin,
        "login"
      );

      showMessage(
        "هذا الحساب مسجل بنوع مختلف. اختار عميل أو كابتن الصحيح.",
        "error"
      );

      return;
    }

    if (roleAtLogin === "captain") {
      renderCaptainHome(
        currentProfile
      );
    } else {
      renderCustomerHome(
        currentProfile
      );
    }

    showMessage(
      roleAtLogin === "captain"
        ? "تم تسجيل الدخول ككابتن بنجاح."
        : "تم تسجيل الدخول كعميل بنجاح.",
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

function renderCustomerHome(profile) {
  stopCaptainTripsListener?.();

  appRoot().innerHTML = `
    <div class="page-container">

      <div class="dashboard">

        <div class="dashboard-header">

          <h2>
            أهلاً ${escapeHtml(
              profile.name || "بك"
            )} 👋
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

    </div>
  `;

  document.getElementById(
    "newTripBtn"
  ).onclick =
    () => renderNewTripPage();

  document.getElementById(
    "myTripsBtn"
  ).onclick = () => {
    showMessage(
      "قسم رحلاتي هنضيفه بعد شاشة الرحلات المتاحة.",
      "info"
    );
  };

  document.getElementById(
    "accountBtn"
  ).onclick = () => {
    showMessage(
      `رقم الهاتف: ${
        profile.phone || "-"
      }`,
      "info"
    );
  };

  document.getElementById(
    "logoutBtn"
  ).onclick =
    async () => {
      try {
        await signOut(auth);
      } catch (error) {
        console.error(error);
      }

      currentUser = null;
      currentProfile = null;
      pickupLocation = null;
      destinationLocation = null;

      renderHome();
    };
}

/* ======================================================
   CAPTAIN HOME
====================================================== */

function renderCaptainHome(profile) {
  stopCaptainTripsListener?.();

  appRoot().innerHTML = `
    <div class="page-container">

      <div class="dashboard">

        <div class="dashboard-header">

          <h2>
            أهلاً ${escapeHtml(
              profile.name || "كابتن"
            )} 🚕
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
              profile.carType || "-"
            )}
          </p>

          <p>
            <strong>الموديل:</strong>
            ${escapeHtml(
              profile.carModel || "-"
            )}
          </p>

          <p>
            <strong>رقم السيارة:</strong>
            ${escapeHtml(
              profile.carNumber || "-"
            )}
          </p>

        </div>

        <button
          id="logoutBtn"
          class="danger-btn">
          تسجيل الخروج
        </button>

      </div>

    </div>
  `;

  document.getElementById(
    "availableTripsBtn"
  ).onclick =
    renderAvailableTrips;

  document.getElementById(
    "captainTripsBtn"
  ).onclick = () => {
    showMessage(
      "قسم رحلات الكابتن هنضيفه بعد ربط قبول الرحلات.",
      "info"
    );
  };

  document.getElementById(
    "logoutBtn"
  ).onclick =
    async () => {
      try {
        await signOut(auth);
      } catch (error) {
        console.error(error);
      }

      currentUser = null;
      currentProfile = null;

      stopCaptainTripsListener?.();

      renderHome();
    };
}

/* ======================================================
   AVAILABLE TRIPS
====================================================== */

function renderAvailableTrips() {
  if (!currentUser) {
    showMessage(
      "يجب تسجيل الدخول ككابتن أولاً.",
      "error"
    );
    return;
  }

  stopCaptainTripsListener?.();

  appRoot().innerHTML = `
    <div class="page-container">

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
   LISTEN FOR OPEN TRIPS
====================================================== */

function listenForAvailableTrips() {
  const list =
    document.getElementById(
      "availableTripsList"
    );

  if (!list) {
    return;
  }

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
        ),
        orderBy(
          "createdAt",
          "desc"
        )
      );

    stopCaptainTripsListener =
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

          list.innerHTML = "";

          snapshot.forEach(
            (tripDoc) => {
              const trip =
                tripDoc.data();

              const tripId =
                tripDoc.id;

              list.appendChild(
                createCaptainTripCard(
                  trip,
                  tripId
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
    trip.distanceKm
      ? formatDistance(
          trip.distanceKm
        )
      : "غير محسوبة";

  const durationText =
    trip.durationMinutes
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
          ${escapeHtml(customerName)}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>📍 الانطلاق</strong>
        <span>
          ${escapeHtml(pickupAddress)}
        </span>
      </div>

      <div class="trip-info-row">
        <strong>🏁 الوصول</strong>
        <span>
          ${escapeHtml(destinationAddress)}
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
    showMessage(
      "هنضيف نظام عروض الأسعار في الخطوة التالية.",
      "info"
    );
  };

  card.querySelector(
    ".acceptTripBtn"
  ).onclick = () => {
    showMessage(
      "هنربط قبول الرحلة بالكابتن في الخطوة التالية.",
      "info"
    );
  };

  return card;
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
    <div class="page-container">

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
            مكان الانطلاق
          </label>

          <div class="location-row">

            <input
              id="pickupAddress"
              type="text"
              placeholder="اضغط لتحديد موقعي"
              readonly
            />

            <button
              id="locationBtn"
              class="location-btn">
              📍 موقعي
            </button>

          </div>

        </div>

        <div class="input-group">

          <label>
            مكان الوصول
          </label>

          <button
            id="chooseDestinationBtn"
            class="map-select-btn">
            🗺️ اختر مكان الوصول من الخريطة
          </button>

          <input
            id="destinationAddress"
            type="text"
            placeholder="لم يتم اختيار الوجهة"
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

    </div>
  `;

  document.getElementById(
    "backBtn"
  ).onclick =
    () =>
      renderCustomerHome(
        currentProfile
      );

  document.getElementById(
    "locationBtn"
  ).onclick =
    getPickupLocation;

  document.getElementById(
    "chooseDestinationBtn"
  ).onclick =
    openDestinationMap;

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
        "📍 تم تحديد موقعي الحالي";
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
   LOCATION
====================================================== */

coords.latitude;

        const lng =
          position.coords.longitude;

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

        showMessage(
          "تم تحديد موقع الانطلاق بنجاح ✅",
          "success"
        );

        if (destinationLocation) {
          await calculateRoadRoute(
            pickupLocation,
            destinationLocation
          );
        }

        return;
      } catch (nativeError) {
        console.error(
          "NATIVE LOCATION ERROR:",
          nativeError
        );

        const text =
          String(
            nativeError?.code ||
            nativeError?.message ||
            ""
          ).toLowerCase();

        if (
          text.includes("permission") ||
          text.includes("denied")
        ) {
          showMessage(
            "لم يتم السماح للتطبيق باستخدام الموقع. اسمح بإذن الموقع من أذونات التطبيق ثم حاول مرة أخرى.",
            "error"
          );

          return;
        }

        if (
          text.includes("timeout")
        ) {
          showMessage(
            "انتهى وقت تحديد الموقع. شغّل GPS وحاول مرة أخرى.",
            "error"
          );

          return;
        }

        showMessage(
          "تعذر تحديد موقعك. تأكد من تشغيل GPS وحاول مرة أخرى.",
          "error"
        );

        return;
      }
    }

    if (!navigator.geolocation) {
      showMessage(
        "الموقع غير مدعوم على هذا الجهاز.",
        "error"
      );

      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat =
          position.coords.latitude;

        const lng =
          position.coords.longitude;

        pickupLocation = {
          lat,
          lng,
          address:
async function getPickupLocation() {
  try {
    // ==========================================
    // Android / Capacitor
    // ==========================================
    if (Capacitor.isNativePlatform()) {

      // أول ما المستخدم يضغط "موقعي"
      // نطلب إذن الموقع من أندرويد مباشرة
      let permissions =
        await Geolocation.checkPermissions();

      if (permissions.location !== "granted") {
        permissions =
          await Geolocation.requestPermissions();
      }

      // لو المستخدم رفض الإذن
      if (permissions.location !== "granted") {
        showMessage(
          "لم يتم السماح باستخدام موقعك. يمكنك السماح بالموقع من إعدادات التطبيق.",
          "error"
        );

        return;
      }

      // ==========================================
      // الحصول على الموقع الحالي
      // ==========================================
      showMessage(
        "📍 جاري تحديد موقعك...",
        "info"
      );

      const position =
        await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0
        });

      const lat =
        position.coords.latitude;

      const lng =
        position.coords.longitude;

      // ==========================================
      // حفظ موقع الانطلاق
      // ==========================================
      pickupLocation = {
        lat,
        lng,
        address:
          `موقع العميل (${lat.toFixed(6)}, ${lng.toFixed(6)})`
      };

      // ==========================================
      // تحديث خانة مكان الانطلاق
      // ==========================================
      const input =
        document.getElementById(
          "pickupAddress"
        );

      if (input) {
        input.value =
          "📍 تم تحديد موقعي الحالي";
      }

      // ==========================================
      // حساب الطريق لو الوجهة موجودة
      // ==========================================
      if (destinationLocation) {
        await calculateRoadRoute(
          pickupLocation,
          destinationLocation
        );
      }

      showMessage(
        "تم تحديد موقع الانطلاق بنجاح ✅",
        "success"
      );

      return;
    }

    // ==========================================
    // Browser fallback
    // ==========================================
    if (!navigator.geolocation) {
      showMessage(
        "الموقع غير مدعوم على هذا الجهاز.",
        "error"
      );

      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {

        const lat =
          position.coords.latitude;

        const lng =
          position.coords.longitude;

        pickupLocation = {
          lat,
          lng,
          address:
            `موقع العميل (${lat.toFixed(6)}, ${lng.toFixed(6)})`
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

        showMessage(
          "تم تحديد موقع الانطلاق بنجاح ✅",
          "success"
        );
      },

      (error) => {
        console.error(
          "WEB GEOLOCATION ERROR:",
          error
        );

        if (error.code === 1) {
          showMessage(
            "لم يتم السماح باستخدام الموقع.",
            "error"
          );
        } else if (error.code === 2) {
          showMessage(
            "تعذر تحديد موقعك. شغّل GPS وحاول مرة أخرى.",
            "error"
          );
        } else if (error.code === 3) {
          showMessage(
            "انتهى وقت تحديد الموقع. حاول مرة أخرى.",
            "error"
          );
        } else {
          showMessage(
            "تعذر تحديد موقعك. حاول مرة أخرى.",
            "error"
          );
        }
      },

      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );

  } catch (error) {

    console.error(
      "GET LOCATION ERROR:",
      error
    );

    const errorText =
      String(
        error?.message ||
        error?.code ||
        ""
      ).toLowerCase();

    if (
      errorText.includes("permission") ||
      errorText.includes("denied")
    ) {
      showMessage(
        "لم يتم السماح باستخدام الموقع.",
        "error"
      );

      return;
    }

    if (
      errorText.includes("timeout")
    ) {
      showMessage(
        "انتهى وقت تحديد الموقع. شغّل GPS وحاول مرة أخرى.",
        "error"
      );

      return;
    }

    showMessage(
      "حدث خطأ أثناء تحديد موقعك. حاول مرة أخرى.",
      "error"
    );
  }
} 
/* ======================================================
   DESTINATION MAP
====================================================== */

function openDestinationMap() {
  appRoot().innerHTML = `
    <div class="map-page">

      <div class="map-topbar">

        <button id="closeMapBtn">
          ✕
        </button>

        <input
          id="placeSearch"
          type="search"
          placeholder="ابحث عن مدينة، شارع، مستشفى، بنك..."
        />

        <button id="searchBtn">
          🔎
        </button>

      </div>

      <div id="destinationMap"></div>

      <div
        class="map-bottom-panel">

        <div id="selectedPlace">
          حرّك الخريطة وحدد مكان الوصول
        </div>

        <div
          id="mapRouteInfo"
          style="
            margin-top:8px;
            padding:8px;
            display:none;
            border-radius:10px;
            background:#eef7ff;
            text-align:center;
          ">
        </div>

        <button
          id="confirmDestinationBtn"
          class="primary-btn">
          تأكيد مكان الوصول
        </button>

      </div>

    </div>
  `;

  document.getElementById(
    "closeMapBtn"
  ).onclick = () => {
    destroyMap();
    renderNewTripPage(true);
  };

  document.getElementById(
    "searchBtn"
  ).onclick =
    searchPlace;

  document.getElementById(
    "placeSearch"
  ).addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter"
      ) {
        searchPlace();
      }
    }
  );

  document.getElementById(
    "confirmDestinationBtn"
  ).onclick =
    confirmDestination;

  setTimeout(
    initializeDestinationMap,
    100
  );
}

/* ======================================================
   DESTROY MAP
====================================================== */

function destroyMap() {
  if (tripMap) {
    try {
      tripMap.remove();
    } catch (error) {
      console.log(error);
    }
  }

  tripMap = null;
  pickupMarker = null;
  destinationMarker = null;
}

/* ======================================================
   INITIALIZE MAP
====================================================== */

function initializeDestinationMap() {
  let center = [
    30.5526,
    31.0106
  ];

  let zoom = 7;

  if (pickupLocation) {
    center = [
      pickupLocation.lat,
      pickupLocation.lng
    ];

    zoom = 15;
  }

  tripMap =
    L.map(
      "destinationMap",
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
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'
    }
  ).addTo(
    tripMap
  );

  if (pickupLocation) {
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

  destinationMarker =
    L.marker(
      center,
      {
        draggable: false
      }
    )
      .addTo(tripMap)
      .bindPopup(
        "🏁 مكان الوصول"
      );

  tripMap.on(
    "moveend",
    updateMapCenter
  );

  tripMap.on(
    "click",
    async (event) => {
      await selectMapLocation(
        event.latlng.lat,
        event.latlng.lng
      );
    }
  );

  updateMapCenter();
}

/* ======================================================
   MAP CENTER
====================================================== */

async function updateMapCenter() {
  if (!tripMap) {
    return;
  }

  const center =
    tripMap.getCenter();

  await selectMapLocation(
    center.lat,
    center.lng,
    false
  );
}

/* ======================================================
   SELECT MAP LOCATION
====================================================== */

async function selectMapLocation(
  lat,
  lng,
  reverseGeocode = true
) {
  destinationLocation = {
    lat,
    lng,
    address:
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
      `📍 ${lat.toFixed(
        6
      )}, ${lng.toFixed(
        6
      )}`;
  }

  if (reverseGeocode) {
    await reverseGeocodeDestination(
      lat,
      lng
    );
  }

  if (pickupLocation) {
    await calculateRoadRoute(
      pickupLocation,
      destinationLocation
    );
  }
}

/* ======================================================
   SEARCH PLACE
====================================================== */

async function searchPlace() {
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
      await fetch(url, {
        headers: {
          Accept:
            "application/json"
        }
      });

    if (!response.ok) {
      throw new Error(
        "SEARCH_FAILED"
      );
    }

    const results =
      await response.json();

    if (!results.length) {
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

    destinationLocation = {
      lat,
      lng,
      address:
        first.display_name
    };

    if (tripMap) {
      tripMap.setView(
        [lat, lng],
        17,
        {
          animate: true
        }
      );
    }

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
        `📍 ${first.display_name}`;
    }

    if (pickupLocation) {
      await calculateRoadRoute(
        pickupLocation,
        destinationLocation
      );
    }

    showMessage(
      "تم العثور على المكان.",
      "success"
    );
  } catch (error) {
    console.error(error);

    showMessage(
      "حصل خطأ أثناء البحث عن المكان.",
      "error"
    );
  }
}

/* ======================================================
   REVERSE GEOCODING
====================================================== */

async function reverseGeocodeDestination(
  lat,
  lng
) {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&lat=${lat}&lon=${lng}`;

    const response =
      await fetch(url, {
        headers: {
          Accept:
            "application/json"
        }
      });

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    if (
      data?.display_name
    ) {
      destinationLocation.address =
        data.display_name;
    }

    const selected =
      document.getElementById(
        "selectedPlace"
      );

    if (selected) {
      selected.textContent =
        `📍 ${
          destinationLocation.address
        }`;
    }
  } catch (error) {
    console.log(
      "Reverse geocoding failed",
      error
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
      ${formatDistance(
        distanceKm
      )}
    </strong>
    <br>
    ⏱️ الوقت التقريبي:
    <strong>
      ${formatDuration(
        durationMinutes
      )}
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
   CONFIRM DESTINATION
====================================================== */

async function confirmDestination() {
  if (!destinationLocation) {
    showMessage(
      "حدد مكان الوصول أولاً.",
      "error"
    );

    return;
  }

  if (!pickupLocation) {
    showMessage(
      "حدد مكان الانطلاق أولاً علشان نحسب المسافة.",
      "error"
    );

    return;
  }

  try {
    await reverseGeocodeDestination(
      destinationLocation.lat,
      destinationLocation.lng
    );

    const route =
      await calculateRoadRoute(
        pickupLocation,
        destinationLocation
      );

    if (!route) {
      showMessage(
        "تم تحديد المكان، لكن لم نتمكن من حساب مسافة الطريق. حاول مرة أخرى.",
        "error"
      );

      return;
    }

    const savedDestination = {
      ...destinationLocation
    };

    destroyMap();

    renderNewTripPage(true);

    destinationLocation =
      savedDestination;

    const destinationInput =
      document.getElementById(
        "destinationAddress"
      );

    if (destinationInput) {
      destinationInput.value =
        destinationLocation.address ||
        "";
    }

    selectedRoute = {
      distanceKm:
        savedDestination.distanceKm,

      durationMinutes:
        savedDestination.durationMinutes
    };

    showRouteInfo(
      selectedRoute.distanceKm,
      selectedRoute.durationMinutes
    );

    showMessage(
      `تم تحديد الوصول: ${formatDistance(
        selectedRoute.distanceKm
      )} - حوالي ${formatDuration(
        selectedRoute.durationMinutes
      )}`,
      "success"
    );
  } catch (error) {
    console.error(error);

    showMessage(
      "حصل خطأ أثناء تأكيد مكان الوصول.",
      "error"
    );
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
      "حدد مكان الانطلاق أولاً.",
      "error"
    );

    return;
  }

  if (!destinationLocation) {
    showMessage(
      "حدد مكان الوصول أولاً.",
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

  if (!passengerCount) {
    showMessage(
      "حدد عدد الركاب.",
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
      !route.distanceKm ||
      !route.durationMinutes
    ) {
      route =
        await calculateRoadRoute(
          pickupLocation,
          destinationLocation
        );
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

      /* تم إصلاح الخطأ هنا */
      distanceKm:
        route
          ? route.distanceKm
          : null,

      durationMinutes:
        route
          ? route.durationMinutes
          : null,

      passengerCount,

      notes,

      proposedPrice,

      status: "open",

      createdAt:
        serverTimestamp()
    };

    const tripRef =
      await addDoc(
        collection(db, "trips"),
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
                  route?.distanceKm
                )}
              </strong>
            </p>

            <p>
              ⏱️ الوقت التقريبي:
              <strong>
                ${formatDuration(
                  route?.durationMinutes
                )}
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
            id="backCustomerBtn"
            class="primary-btn big-btn"
            style="margin-top:20px;">
            ← العودة للرئيسية
          </button>

        </div>

      </div>
    `;

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
          currentUser = null;
          currentProfile = null;

          await signOut(auth);

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
          firebaseErrorMessage(error),
          "error"
        );
      }
    }
  );
} else {
  renderHome();
}
