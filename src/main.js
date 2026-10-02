import "./style.css";

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
  serverTimestamp
} from "firebase/firestore";

/* ======================================================
   FIREBASE
====================================================== */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

/* ======================================================
   HELPERS
====================================================== */

function appRoot() {
  return document.getElementById("app");
}

function showMessage(message, type = "info") {
  const old = document.querySelector(".app-message");

  if (old) {
    old.remove();
  }

  const box = document.createElement("div");

  box.className = `app-message ${type}`;
  box.textContent = message;

  appRoot().prepend(box);

  setTimeout(() => {
    if (box.parentNode) {
      box.remove();
    }
  }, 4000);
}

function loading(text = "جاري التحميل...") {
  appRoot().innerHTML = `
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

  if (value.startsWith("20") && !value.startsWith("+20")) {
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

  const messages = {
    "auth/invalid-credential":
      "رقم الهاتف أو كلمة المرور غير صحيحة.",

    "auth/email-already-in-use":
      "الحساب موجود بالفعل.",

    "auth/weak-password":
      "كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.",

    "auth/invalid-email":
      "بيانات الحساب غير صحيحة.",

    "auth/user-not-found":
      "الحساب غير موجود.",

    "auth/wrong-password":
      "كلمة المرور غير صحيحة.",

    "auth/network-request-failed":
      "تأكد من اتصال الإنترنت."
  };

  return (
    messages[code] ||
    `حدث خطأ أثناء العملية. (${code})`
  );
}

/* ======================================================
   HOME
====================================================== */

function renderHome() {
  appRoot().innerHTML = `
    <div class="page-container">

      <div class="brand">
        <h1>وصلني المنوفية</h1>
        <p>مشوارك أسهل وأسرع</p>
      </div>

      <div class="home-card">

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
  ).onclick = () =>
    renderAuth("customer", "login");

  document.getElementById(
    "captainLoginBtn"
  ).onclick = () =>
    renderAuth("captain", "login");

  document.getElementById(
    "registerBtn"
  ).onclick = () =>
    renderAuth("customer", "register");
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

  appRoot().innerHTML = `
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

        <div class="input-group">

          <label>
            رقم الهاتف
          </label>

          <input
            id="phoneInput"
            type="tel"
            inputmode="numeric"
            placeholder="01xxxxxxxxx"
          />

        </div>

        ${
          isRegister
            ? `
              <div class="input-group">

                <label>
                  الاسم بالكامل
                </label>

                <input
                  id="nameInput"
                  type="text"
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

                <label>
                  نوع السيارة
                </label>

                <input
                  id="carTypeInput"
                  type="text"
                  placeholder="سيدان"
                />

              </div>

              <div class="input-group">

                <label>
                  موديل السيارة
                </label>

                <input
                  id="carModelInput"
                  type="text"
                  placeholder="لانسر"
                />

              </div>

              <div class="input-group">

                <label>
                  رقم السيارة
                </label>

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

          <label>
            كلمة المرور
          </label>

          <input
            id="passwordInput"
            type="password"
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
  ).onclick = () =>
    renderAuth(
      "customer",
      mode
    );

  document.getElementById(
    "captainRoleBtn"
  ).onclick = () =>
    renderAuth(
      "captain",
      mode
    );

  document.getElementById(
    "authBtn"
  ).onclick = () =>
    isRegister
      ? registerAccount()
      : loginAccount();

  if (isRegister) {
    document.getElementById(
      "loginInsteadBtn"
    ).onclick = () =>
      renderAuth(
        role,
        "login"
      );
  } else {
    document.getElementById(
      "registerInsteadBtn"
    ).onclick = () =>
      renderAuth(
        role,
        "register"
      );
  }
}

/* ======================================================
   REGISTER
====================================================== */

async function registerAccount() {
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
      "اكتب رقم هاتف مصري صحيح.",
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

      createdAt:
        serverTimestamp()
    };

    if (
      selectedRole ===
      "captain"
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

    currentProfile =
      profile;

    showMessage(
      "تم إنشاء الحساب بنجاح.",
      "success"
    );

    if (
      selectedRole ===
      "captain"
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
    console.error(error);

    showMessage(
      firebaseErrorMessage(error),
      "error"
    );

    renderAuth(
      selectedRole,
      "register"
    );
  }
}

/* ======================================================
   LOGIN
====================================================== */

async function loginAccount() {
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

  if (!isValidEgyptPhone(phone)) {
    showMessage(
      "اكتب رقم هاتف مصري صحيح.",
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
      selectedRole
    );

  try {
    loading(
      "جاري تسجيل الدخول..."
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
      throw new Error(
        "PROFILE_NOT_FOUND"
      );
    }

    currentProfile =
      profileSnap.data();

    if (
      currentProfile.role !==
      selectedRole
    ) {
      await signOut(auth);

      showMessage(
        "نوع الحساب غير مطابق.",
        "error"
      );

      renderHome();

      return;
    }

    if (
      selectedRole ===
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
    console.error(error);

    showMessage(
      error.message ===
        "PROFILE_NOT_FOUND"
        ? "بيانات الحساب غير موجودة."
        : firebaseErrorMessage(
            error
          ),
      "error"
    );

    renderAuth(
      selectedRole,
      "login"
    );
  }
}

/* ======================================================
   CUSTOMER HOME
====================================================== */

function renderCustomerHome(
  profile
) {
  appRoot().innerHTML = `
    <div class="page-container">

      <div class="dashboard">

        <div class="dashboard-header">

          <h2>
            أهلاً ${
              profile.name ||
              "بك"
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

    </div>
  `;

  document.getElementById(
    "newTripBtn"
  ).onclick =
    () =>
      renderNewTripPage();

  document.getElementById(
    "myTripsBtn"
  ).onclick = () => {
    showMessage(
      "قسم رحلاتي هنضيفه بعد شاشة الرحلة.",
      "info"
    );
  };

  document.getElementById(
    "accountBtn"
  ).onclick = () => {
    showMessage(
      `رقم الهاتف: ${profile.phone}`,
      "info"
    );
  };

  document.getElementById(
    "logoutBtn"
  ).onclick =
    async () => {
      await signOut(auth);

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

function renderCaptainHome(
  profile
) {
  appRoot().innerHTML = `
    <div class="page-container">

      <div class="dashboard">

        <div class="dashboard-header">

          <h2>
            أهلاً ${
              profile.name ||
              "كابتن"
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
            <strong>
              نوع السيارة:
            </strong>
            ${
              profile.carType ||
              "-"
            }
          </p>

          <p>
            <strong>
              الموديل:
            </strong>
            ${
              profile.carModel ||
              "-"
            }
          </p>

          <p>
            <strong>
              رقم السيارة:
            </strong>
            ${
              profile.carNumber ||
              "-"
            }
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
  ).onclick = () => {
    showMessage(
      "قسم الرحلات المتاحة هنكمله في الخطوة التالية.",
      "info"
    );
  };

  document.getElementById(
    "captainTripsBtn"
  ).onclick = () => {
    showMessage(
      "قسم رحلات الكابتن هنكمله في الخطوة التالية.",
      "info"
    );
  };

  document.getElementById(
    "logoutBtn"
  ).onclick =
    async () => {
      await signOut(auth);

      currentUser = null;
      currentProfile = null;

      renderHome();
    };
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

        <div class="input-group">

          <label>
            عدد الركاب
          </label>

          <select
            id="passengerCount">

            ${Array.from(
              { length: 8 },
              (_, i) => `
                <option
                  value="${i + 1}">
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
    const pickupInput =
      document.getElementById(
        "pickupAddress"
      );

    if (pickupInput) {
      pickupInput.value =
        "📍 تم تحديد موقعي الحالي";
    }
  }

  if (destinationLocation) {
    const destinationInput =
      document.getElementById(
        "destinationAddress"
      );

    if (destinationInput) {
      destinationInput.value =
        destinationLocation.address ||
        "";
    }
  }
}

/* ======================================================
   CURRENT LOCATION
   NO CAPACITOR GEOLOCATION
====================================================== */

async function getPickupLocation() {
  try {
    showMessage(
      "جاري تحديد موقعك...",
      "info"
    );

    if (
      !navigator.geolocation
    ) {
      showMessage(
        "الموقع غير مدعوم على الجهاز.",
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
          "تم تحديد موقع الانطلاق بنجاح.",
          "success"
        );
      },

      (error) => {

        console.error(
          "Geolocation error:",
          error
        );

        let message =
          "لم نتمكن من تحديد موقعك.";

        if (
          error.code === 1
        ) {
          message =
            "اسمح للتطبيق باستخدام الموقع من إعدادات الهاتف.";
        }

        else if (
          error.code === 2
        ) {
          message =
            "تعذر تحديد موقعك. شغّل GPS وحاول مرة أخرى.";
        }

        else if (
          error.code === 3
        ) {
          message =
            "انتهى وقت تحديد الموقع. تأكد من تشغيل GPS وحاول مرة أخرى.";
        }

        showMessage(
          message,
          "error"
        );
      },

      {
        enableHighAccuracy: true,

        timeout: 20000,

        maximumAge: 5000
      }
    );

  } catch (error) {

    console.error(error);

    showMessage(
      "حدث خطأ أثناء تحديد موقعك.",
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

        <button
          id="closeMapBtn">
          ✕
        </button>

        <input
          id="placeSearch"
          type="search"
          placeholder="ابحث عن مدينة، شارع، مستشفى، بنك..."
        />

        <button
          id="searchBtn">
          🔎
        </button>

      </div>

      <div
        id="destinationMap">
      </div>

      <div
        class="map-bottom-panel">

        <div
          id="selectedPlace">
          حرّك الخريطة وحدد مكان الوصول
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

    if (tripMap) {
      try {
        tripMap.remove();
      } catch (e) {
        console.log(e);
      }

      tripMap = null;
      pickupMarker = null;
    }

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
        event.key ===
        "Enter"
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
    () => {
      initializeDestinationMap();
    },
    100
  );
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
        )
        .openPopup();
  }

  tripMap.on(
    "moveend",
    updateMapCenter
  );

  updateMapCenter();
}

/* ======================================================
   MAP CENTER
====================================================== */

function updateMapCenter() {

  if (!tripMap) {
    return;
  }

  const center =
    tripMap.getCenter();

  const lat =
    center.lat;

  const lng =
    center.lng;

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
   SEARCH PLACE
====================================================== */

async function searchPlace() {

  const input =
    document.getElementById(
      "placeSearch"
    );

  const query =
    input?.value.trim();

  if (!query) {

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
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ar&q=${encodeURIComponent(
        query
      )}`;

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        "SEARCH_FAILED"
      );
    }

    const results =
      await response.json();

    if (
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

    tripMap.setView(
      [
        lat,
        lng
      ],
      17,
      {
        animate: true
      }
    );

    destinationLocation = {
      lat,
      lng,
      address:
        first.display_name
    };

    const selected =
      document.getElementById(
        "selectedPlace"
      );

    if (selected) {
      selected.textContent =
        `📍 ${first.display_name}`;
    }

    showMessage(
      "تم العثور على المكان. يمكنك تحريك الخريطة للتحديد بدقة.",
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
   CONFIRM DESTINATION
====================================================== */

async function confirmDestination() {

  if (
    !destinationLocation
  ) {

    showMessage(
      "حدد مكان الوصول أولاً.",
      "error"
    );

    return;
  }

  try {

    const lat =
      destinationLocation.lat;

    const lng =
      destinationLocation.lng;

    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&lat=${lat}&lon=${lng}`;

    const response =
      await fetch(url);

    if (response.ok) {

      const data =
        await response.json();

      destinationLocation.address =
        data.display_name ||
        destinationLocation.address;
    }

  } catch (error) {

    console.log(
      "Reverse geocoding failed",
      error
    );
  }

  const savedDestination =
    {
      ...destinationLocation
    };

  if (tripMap) {

    try {
      tripMap.remove();
    } catch (e) {
      console.log(e);
    }

    tripMap = null;
    pickupMarker = null;
  }

  renderNewTripPage(
    true
  );

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

  if (
    !destinationLocation
  ) {

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
    )?.value.trim() ||
    "";

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

      button.disabled =
        true;

      button.textContent =
        "جاري إرسال الرحلة...";
    }

    const tripData = {

      customerId:
        currentUser.uid,

      customerName:
        currentProfile.name ||
        "",

      customerPhone:
        currentProfile.phone ||
        "",

      pickup: {

        lat:
          pickupLocation.lat,

        lng:
          pickupLocation.lng,

        address:
          pickupLocation.address ||
          ""
      },

      destination: {

        lat:
          destinationLocation.lat,

        lng:
          destinationLocation.lng,

        address:
          destinationLocation.address ||
          ""
      },

      passengerCount,

      notes,

      proposedPrice,

      status:
        "open",

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
      "Trip created:",
      tripRef.id
    );

    appRoot().innerHTML = `
      <div class="page-container">

        <div class="success-card">

          <div
            class="success-icon">
            ✓
          </div>

          <h2>
            تم طلب الرحلة
          </h2>

          <p>
            رحلتك ظهرت الآن للكباتن.
          </p>

          <p>
            السعر المقترح:
            <strong>
              ${proposedPrice}
              جنيه
            </strong>
          </p>

          <button
            id="backHomeBtn"
            class="primary-btn">
            العودة للرئيسية
          </button>

        </div>

      </div>
    `;

    document.getElementById(
      "backHomeBtn"
    ).onclick =
      () =>
        renderCustomerHome(
          currentProfile
        );

  } catch (error) {

    console.error(error);

    const button =
      document.getElementById(
        "submitTripBtn"
      );

    if (button) {

      button.disabled =
        false;

      button.textContent =
        "🚕 اطلب الرحلة";
    }

    showMessage(
      "لم يتم إرسال الرحلة. تأكد من اتصال الإنترنت.",
      "error"
    );
  }
}

/* ======================================================
   AUTH STATE
====================================================== */

onAuthStateChanged(
  auth,
  async (user) => {

    if (!user) {

      if (!currentUser) {
        renderHome();
      }

      return;
    }

    currentUser =
      user;

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
        !profileSnap.exists()
      ) {

        renderHome();

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

      console.error(error);

      renderHome();
    }
  }
);
