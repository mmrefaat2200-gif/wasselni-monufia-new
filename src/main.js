import "./style.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { initializeApp } from "firebase/app";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  signOut,
  deleteUser
} from "firebase/auth";

import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from "firebase/firestore";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";

import { Geolocation } from "@capacitor/geolocation";


/* =========================================================
   FIREBASE
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyD1w6MD5QYYIOn0QLz5r8KqXo8z8WRjJKs",
  authDomain: "wasselni-monufia-ac5fc.firebaseapp.com",
  projectId: "wasselni-monufia-ac5fc",
  storageBucket: "wasselni-monufia-ac5fc.firebasestorage.app",
  messagingSenderId: "1079664487535",
  appId: "1:1079664487535:web:4de61934fa993aca81f19a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);


/* =========================================================
   STATE
   ========================================================= */

let user = null;
let profile = null;

let map = null;

let pickupMarker = null;
let destMarker = null;
let routeLayer = null;
let accuracyCircle = null;

let watchRides = null;
let watchCustomer = null;
let watchCaptainAccepted = null;

let pickup = null;
let destination = null;

let authBusy = false;

let mapMode = "destination";

/* =========================================================
   LIVE TRACKING STATE
   ========================================================= */

let trackingMap = null;
let trackingCaptainMarker = null;
let trackingPickupMarker = null;
let trackingDestinationMarker = null;
let trackingRouteLayer = null;

let captainLocationWatchId = null;
let trackingRideUnsubscribe = null;
let activeTrackingRideId = null;
let trackingHasFitted = false;
let trackingLastRouteAt = 0;
let trackingLastRoutePoint = null;


/* =========================================================
   HELPERS
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[m]
  );


/* =========================================================
   PHONE
   ========================================================= */

function phone(value) {
  let v = String(value || "")
    .trim()
    .replace(/[\s()-]/g, "");

  if (v.startsWith("00")) {
    v = "+" + v.slice(2);
  }

  if (v.startsWith("+20")) {
    return v;
  }

  if (v.startsWith("20") && v.length === 12) {
    return "+" + v;
  }

  if (v.startsWith("01") && v.length === 11) {
    return "+20" + v.slice(1);
  }

  return v;
}


/* =========================================================
   INTERNAL FIREBASE EMAIL
   ========================================================= */

function loginEmail(phoneNumber, role) {
  const digits = phone(phoneNumber).replace(/\D/g, "");

  const roleName =
    role === "captain"
      ? "captain"
      : "customer";

  return `${digits}.${roleName}@login.wasselni-monufia.app`;
}


/* =========================================================
   LEGACY ACCOUNT
   ========================================================= */

function legacyLoginEmail(phoneNumber) {
  const digits = String(phoneNumber || "").replace(/\D/g, "");

  if (digits.startsWith("01") && digits.length === 11) {
    return `${digits}@phone.wasselni.app`;
  }

  return "";
}


/* =========================================================
   ACCOUNT NUMBER
   ========================================================= */

function accountNo() {
  return String(
    Math.floor(10000000 + Math.random() * 90000000)
  );
}


/* =========================================================
   MESSAGE
   ========================================================= */

function msg(text, type = "info") {
  const element = $("#message");

  if (!element) return;

  element.textContent = text;
  element.className = `message-box ${type}`;
  element.style.display = "block";

  clearTimeout(window.__msg);

  window.__msg = setTimeout(() => {
    element.style.display = "none";
  }, 4500);
}


/* =========================================================
   SCREEN
   ========================================================= */

function screen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((x) => x.classList.remove("active"));

  $("#" + id)?.classList.add("active");

  if ($("#nav")) {
    $("#nav").style.display =
      ["login", "register"].includes(id)
        ? "none"
        : "flex";
  }

  if (id === "trackingScreen" && trackingMap) {
    setTimeout(() => {
      trackingMap.invalidateSize();
    }, 200);
  }
}


/* =========================================================
   STATUS
   ========================================================= */

function statusText(status) {
  return (
    {
      open: "بانتظار كابتن",
      price_offered: "الكابتن اقترح سعر جديد",
      accepted: "تم قبول الرحلة",
      captain_to_customer: "الكابتن في الطريق إليك",
      arrived: "الكابتن وصل إليك",
      started: "الرحلة بدأت",
      completed: "انتهت الرحلة",
      cancelled: "ملغاة"
    }[status] ||
    status ||
    "غير معروف"
  );
}


/* =========================================================
   DATE
   ========================================================= */

function dayName(date) {
  if (!date) return "";

  return new Intl.DateTimeFormat("ar-EG", {
    weekday: "long"
  }).format(new Date(`${date}T12:00:00`));
}


function formatDate(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("ar-EG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00`));
}


/* =========================================================
   DISTANCE
   ========================================================= */

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;

  const R = 6371000;

  const lat1 =
    Number(a.lat) * Math.PI / 180;

  const lat2 =
    Number(b.lat) * Math.PI / 180;

  const dLat =
    (Number(b.lat) - Number(a.lat)) *
    Math.PI / 180;

  const dLng =
    (Number(b.lng) - Number(a.lng)) *
    Math.PI / 180;

  const x =
    Math.sin(dLat / 2) *
    Math.sin(dLat / 2) +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(x),
      Math.sqrt(1 - x)
    )
  );
}


/* =========================================================
   APP HTML
   ========================================================= */

$("#app").innerHTML = `
<div class="app">

<header class="header">
  <div class="logo">
    🚕 وصلني <span>المنوفية</span>
  </div>

  <button id="profileTop" class="icon-button">
    👤
  </button>
</header>

<div id="message" class="message-box" style="display:none"></div>


<!-- LOGIN -->

<section id="login" class="screen active">

  <div class="auth-card">

    <div class="auth-logo">
      🚕
    </div>

    <h1>
      وصلني المنوفية
    </h1>

    <p class="muted">
      تسجيل الدخول برقم الموبايل وكلمة المرور
    </p>

    <label>
      نوع الحساب
    </label>

    <select id="loginRole">

      <option value="customer">
        👤 عميل
      </option>

      <option value="captain">
        🚗 كابتن
      </option>

    </select>


    <label>
      📱 رقم الموبايل
    </label>

    <input
      id="loginPhone"
      type="tel"
      inputmode="tel"
      placeholder="010xxxxxxxx"
    />


    <label>
      🔐 كلمة المرور
    </label>

    <input
      id="loginPass"
      type="password"
      placeholder="كلمة المرور"
    />


    <button
      id="loginBtn"
      class="btn primary"
    >
      تسجيل الدخول
    </button>


    <button
      id="registerOpen"
      class="btn outline"
    >
      إنشاء حساب جديد
    </button>


    <div
      id="loginMsg"
      class="status"
    ></div>

  </div>

</section>


<!-- REGISTER -->

<section id="register" class="screen">

  <div class="auth-card">

    <button
      id="backLogin"
      class="back-btn"
    >
      ← رجوع
    </button>

    <h2>
      إنشاء حساب
    </h2>


    <label>
      نوع الحساب
    </label>

    <select id="role">

      <option value="customer">
        👤 عميل
      </option>

      <option value="captain">
        🚗 كابتن
      </option>

    </select>


    <label>
      الاسم بالكامل
    </label>

    <input
      id="name"
      placeholder="الاسم"
    />


    <label>
      📱 رقم الموبايل
    </label>

    <input
      id="regPhone"
      type="tel"
      inputmode="tel"
      placeholder="010xxxxxxxx"
    />


    <label>
      🔐 كلمة المرور
    </label>

    <input
      id="regPass"
      type="password"
      placeholder="6 أحرف أو أرقام على الأقل"
    />


    <label>
      🔐 تأكيد كلمة المرور
    </label>

    <input
      id="regPass2"
      type="password"
      placeholder="تأكيد كلمة المرور"
    />


    <div
      id="captainFields"
      style="display:none"
    >

      <label>
        🎂 السن
      </label>

      <input
        id="age"
        type="number"
        min="18"
        placeholder="السن"
      />


      <label>
        🚗 نوع العربية
      </label>

      <input
        id="carType"
        placeholder="سيدان / ميكروباص / نص نقل"
      />


      <label>
        🚘 موديل العربية
      </label>

      <input
        id="carModel"
        placeholder="مثال: لانسر 2018"
      />


      <label>
        🔢 رقم اللوحة
      </label>

      <input
        id="plate"
        placeholder="رقم اللوحة"
      />

    </div>


    <button
      id="finishReg"
      class="btn green"
    >
      إنشاء الحساب
    </button>


    <div
      id="regMsg"
      class="status"
    ></div>

  </div>

</section>


<!-- CUSTOMER HOME -->

<section id="home" class="screen">

  <div class="hero">

    <h2>
      أهلاً بيك 👋
    </h2>

    <p>
      اطلب رحلتك وحدد كل التفاصيل.
    </p>

  </div>


  <div class="card">

    <label>
      📍 الانطلاق
    </label>

    <button
      id="choosePickup"
      class="btn outline"
    >
      🗺️ تحديد مكان الانطلاق على الخريطة
    </button>

    <button
      id="myLocation"
      class="btn outline"
    >
      🎯 استخدام موقعي الحالي
    </button>

    <div
      id="pickupText"
      class="status"
    >
      لم يتم تحديد مكان الانطلاق
    </div>

  </div>


  <div class="card">

    <label>
      🏁 الوصول
    </label>

    <button
      id="chooseDest"
      class="btn outline"
    >
      🗺️ تحديد مكان النزول على الخريطة
    </button>

    <div
      id="destText"
      class="status"
    >
      لم يتم تحديد مكان الوصول
    </div>

  </div>


  <div class="card">

    <label>
      📅 يوم الرحلة
    </label>

    <input
      id="rideDate"
      type="date"
    />

    <div
      id="dayPreview"
      class="status"
    ></div>


    <label>
      🕐 وقت الرحلة
    </label>

    <input
      id="rideTime"
      type="time"
    />


    <label>
      👥 عدد الركاب
    </label>

    <select id="passengers">

      ${Array.from(
        { length: 8 },
        (_, i) =>
          `<option value="${i + 1}">
            ${i + 1}
          </option>`
      ).join("")}

    </select>


    <label>
      💰 السعر المقترح
    </label>

    <input
      id="price"
      type="number"
      min="1"
      placeholder="مثال 150"
    />


    <label>
      📝 الرسالة / الملاحظات
    </label>

    <textarea
      id="notes"
      rows="3"
      placeholder="شنطة كبيرة، طفل، شارع ضيق، أي ملاحظة للكابتن..."
    ></textarea>


    <button
      id="request"
      class="btn primary"
    >
      🚕 نشر الرحلة للكباتن
    </button>

  </div>

</section>


<!-- MAP -->

<section
  id="mapScreen"
  class="screen"
>

  <div class="card">

    <div class="map-head">

      <div>

        <h2 id="mapTitle">
          🗺️ تحديد المكان
        </h2>

        <small id="mapHint">
          ابحث عن المكان أو حرّك الخريطة حتى الدبوس فوق المكان المطلوب.
        </small>

      </div>


      <button
        id="closeMap"
        class="btn danger small-btn"
      >
        إلغاء
      </button>

    </div>


    <input
      id="search"
      placeholder="🔎 ابحث عن شارع، قرية، مدينة أو مكان"
    />


    <div
      id="results"
      class="search-results"
    ></div>

  </div>


  <div class="map-wrapper">

    <div id="map"></div>

    <div class="map-center-pin">
      📍
    </div>

    <button
      id="mapLocation"
      class="map-control"
      title="استخدام موقعي الحالي"
    >
      🎯
    </button>

  </div>


  <div class="card">

    <div
      id="address"
      class="status"
    >
      حدد المكان.
    </div>

    <div
      id="coords"
      class="coords"
    ></div>

    <button
      id="confirmDest"
      class="btn primary"
    >
      ✅ تأكيد المكان
    </button>

  </div>

</section>


<!-- LIVE TRACKING -->

<section
  id="trackingScreen"
  class="screen"
>

  <div class="card">

    <div class="map-head">

      <div>

        <h2 id="trackingTitle">
          🚗 تتبع الرحلة
        </h2>

        <small id="trackingHint">
          جاري تحميل موقع الكابتن...
        </small>

      </div>

      <button
        id="closeTracking"
        class="btn danger small-btn"
      >
        إغلاق
      </button>

    </div>

  </div>


  <div class="map-wrapper">

    <div
      id="trackingMap"
      style="
        height:60vh;
        min-height:360px;
        width:100%;
        border-radius:16px;
        overflow:hidden;
      "
    ></div>

  </div>


  <div class="card">

    <div
      id="trackingStatus"
      class="status"
    >
      جاري تحديد حالة الرحلة...
    </div>

    <div
      id="trackingAddress"
      class="status"
    >
      جاري تحديد موقع الكابتن...
    </div>

  </div>

</section>


<!-- CUSTOMER RIDES -->

<section id="rides" class="screen">

  <div class="hero">

    <h2>
      📋 رحلاتي
    </h2>

    <p>
      تابع الرحلة من النشر حتى الانتهاء.
    </p>

  </div>

  <div id="ridesList"></div>

</section>


<!-- CAPTAIN -->

<section id="captain" class="screen">

  <div class="hero">

    <h2>
      🚗 منصة الكابتن
    </h2>

    <p>
      فعّل حالتك وشوف الرحلات الجديدة.
    </p>

  </div>


  <div class="card captain-toggle">

    <button
      id="captainAvailable"
      class="btn green"
    >
      🟢 أنا متاح
    </button>

    <button
      id="captainUnavailable"
      class="btn outline"
    >
      ⚫ غير متاح
    </button>

    <div
      id="captainState"
      class="status"
    ></div>

  </div>


  <h3>
    📢 الرحلات الجديدة
  </h3>

  <div id="captainList"></div>


  <h3>
    🚕 رحلات قبلتها
  </h3>

  <div id="captainAcceptedList"></div>

</section>


<!-- PROFILE -->

<section id="profile" class="screen">

  <div class="card">

    <div class="avatar">
      👤
    </div>

    <h2>
      حسابي
    </h2>

    <div id="profileInfo"></div>

    <button
      id="logout"
      class="btn danger"
    >
      تسجيل الخروج
    </button>

  </div>

</section>


<!-- NAV -->

<nav
  id="nav"
  class="nav"
>

  <button id="navHome">
    🏠
    <br>
    الرئيسية
  </button>

  <button id="navRides">
    📋
    <br>
    رحلاتي
  </button>

  <button id="navCaptain">
    🚗
    <br>
    الكابتن
  </button>

  <button id="navProfile">
    👤
    <br>
    حسابي
  </button>

</nav>

</div>
`;


/* =========================================================
   LOCATION
   ========================================================= */

async function exactLocation() {

  const permission =
    await Geolocation.checkPermissions();

  if (permission.location !== "granted") {

    const result =
      await Geolocation.requestPermissions();

    if (result.location !== "granted") {
      throw Error("LOCATION_DENIED");
    }
  }

  const position =
    await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    });

  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy
  };
}


/* =========================================================
   REVERSE GEOCODING
   ========================================================= */

async function reverse(lat, lng) {

  try {

    const response =
      await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ar`
      );

    const data = await response.json();

    return (
      data.display_name ||
      `موقع ${lat.toFixed(6)}, ${lng.toFixed(6)}`
    );

  } catch {

    return `موقع ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}


/* =========================================================
   MAP MARKER
   ========================================================= */

function marker(type, point) {

  const icon = L.divIcon({

    className: "custom-marker",

    html: `
      <div class="${type}-marker">
        ${type === "pickup" ? "🚕" : "📍"}
      </div>
    `,

    iconSize: [48, 48],

    iconAnchor: [24, 42]
  });

  return L.marker(
    [point.lat, point.lng],
    { icon }
  ).addTo(map);
}


/* =========================================================
   TRACKING MARKER
   ========================================================= */

function trackingIcon(type) {

  let emoji = "🚗";

  if (type === "pickup") {
    emoji = "📍";
  }

  if (type === "destination") {
    emoji = "🏁";
  }

  return L.divIcon({

    className: "tracking-marker",

    html: `
      <div
        style="
          width:44px;
          height:44px;
          border-radius:50%;
          background:white;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:28px;
          box-shadow:0 3px 12px rgba(0,0,0,.3);
          border:3px solid #0878df;
        "
      >
        ${emoji}
      </div>
    `,

    iconSize: [44, 44],

    iconAnchor: [22, 22]
  });
}


/* =========================================================
   INIT TRACKING MAP
   ========================================================= */

function initTrackingMap(ride) {

  if (!ride) return;

  let start = null;

  if (ride.captainLocation) {

    start = [
      Number(ride.captainLocation.lat),
      Number(ride.captainLocation.lng)
    ];

  } else if (ride.pickupCoords) {

    start = [
      Number(ride.pickupCoords.lat),
      Number(ride.pickupCoords.lng)
    ];

  } else if (ride.destinationCoords) {

    start = [
      Number(ride.destinationCoords.lat),
      Number(ride.destinationCoords.lng)
    ];

  } else {

    start = [
      30.5526,
      31.0106
    ];
  }


  if (!trackingMap) {

    trackingMap =
      L.map(
        "trackingMap",
        {
          zoomControl: false
        }
      ).setView(
        start,
        15
      );


    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 20,
        attribution:
          "© OpenStreetMap contributors"
      }
    ).addTo(trackingMap);


    L.control.zoom({
      position: "bottomright"
    }).addTo(trackingMap);

  } else {

    setTimeout(
      () => trackingMap.invalidateSize(),
      100
    );
  }


  trackingHasFitted = false;

  updateTrackingMap(ride);
}


/* =========================================================
   UPDATE TRACKING MAP
   ========================================================= */

async function updateTrackingMap(ride) {

  if (!ride || !trackingMap) {
    return;
  }


  $("#trackingStatus").textContent =
    `🚦 ${statusText(ride.status)}`;


  if (ride.status === "captain_to_customer") {

    $("#trackingTitle").textContent =
      "🚗 الكابتن في الطريق إليك";

    $("#trackingHint").textContent =
      "موقع الكابتن بيتحدث لحظيًا أثناء توجهه إليك.";

  } else if (ride.status === "arrived") {

    $("#trackingTitle").textContent =
      "📍 الكابتن وصل";

    $("#trackingHint").textContent =
      "الكابتن وصل إلى مكان الانطلاق.";

  } else if (ride.status === "started") {

    $("#trackingTitle").textContent =
      "🛣️ الرحلة بدأت";

    $("#trackingHint").textContent =
      "الكابتن في طريقه إلى وجهة الرحلة.";

  } else {

    $("#trackingTitle").textContent =
      "🚗 تتبع الرحلة";

    $("#trackingHint").textContent =
      "تابع حالة الرحلة على الخريطة.";
  }


  if (ride.captainLocation) {

    const captain = {
      lat:
        Number(ride.captainLocation.lat),

      lng:
        Number(ride.captainLocation.lng)
    };


    if (trackingCaptainMarker) {

      trackingCaptainMarker.setLatLng([
        captain.lat,
        captain.lng
      ]);

    } else {

      trackingCaptainMarker =
        L.marker(
          [
            captain.lat,
            captain.lng
          ],
          {
            icon:
              trackingIcon("captain")
          }
        ).addTo(trackingMap);

    }


    if (
      ride.status === "captain_to_customer" &&
      ride.pickupCoords
    ) {

      await updateTrackingRoute(
        captain,
        ride.pickupCoords
      );

    } else if (
      ride.status === "started" &&
      ride.destinationCoords
    ) {

      await updateTrackingRoute(
        captain,
        ride.destinationCoords
      );
    }


    try {

      const address =
        await reverse(
          captain.lat,
          captain.lng
        );

      $("#trackingAddress").innerHTML =
        `📍 موقع الكابتن الآن:<br><strong>${esc(address)}</strong>`;

    } catch {}

  } else {

    $("#trackingAddress").textContent =
      "📍 في انتظار إرسال موقع الكابتن...";
  }


  if (ride.pickupCoords) {

    const pickupPoint = {
      lat:
        Number(ride.pickupCoords.lat),

      lng:
        Number(ride.pickupCoords.lng)
    };


    if (trackingPickupMarker) {

      trackingPickupMarker.setLatLng([
        pickupPoint.lat,
        pickupPoint.lng
      ]);

    } else {

      trackingPickupMarker =
        L.marker(
          [
            pickupPoint.lat,
            pickupPoint.lng
          ],
          {
            icon:
              trackingIcon("pickup")
          }
        ).addTo(trackingMap);
    }
  }


  if (ride.destinationCoords) {

    const destinationPoint = {
      lat:
        Number(
          ride.destinationCoords.lat
        ),

      lng:
        Number(
          ride.destinationCoords.lng
        )
    };


    if (trackingDestinationMarker) {

      trackingDestinationMarker.setLatLng([
        destinationPoint.lat,
        destinationPoint.lng
      ]);

    } else {

      trackingDestinationMarker =
        L.marker(
          [
            destinationPoint.lat,
            destinationPoint.lng
          ],
          {
            icon:
              trackingIcon("destination")
          }
        ).addTo(trackingMap);
    }
  }


  if (!trackingHasFitted) {

    const points = [];

    if (ride.captainLocation) {

      points.push([
        Number(ride.captainLocation.lat),
        Number(ride.captainLocation.lng)
      ]);
    }

    if (ride.status === "captain_to_customer") {

      if (ride.pickupCoords) {

        points.push([
          Number(ride.pickupCoords.lat),
          Number(ride.pickupCoords.lng)
        ]);
      }

    } else if (ride.destinationCoords) {

      points.push([
        Number(ride.destinationCoords.lat),
        Number(ride.destinationCoords.lng)
      ]);
    }


    if (points.length >= 2) {

      trackingMap.fitBounds(
        L.latLngBounds(points),
        {
          padding: [50, 50]
        }
      );

    } else if (points.length === 1) {

      trackingMap.setView(
        points[0],
        16
      );
    }


    trackingHasFitted = true;
  }


  setTimeout(
    () => trackingMap.invalidateSize(),
    100
  );
}


/* =========================================================
   UPDATE TRACKING ROUTE
   ========================================================= */

async function updateTrackingRoute(
  from,
  to
) {

  if (!trackingMap || !from || !to) {
    return;
  }


  const now = Date.now();

  const moved =
    distanceMeters(
      trackingLastRoutePoint,
      from
    );


  if (
    trackingLastRoutePoint &&
    moved < 30 &&
    now - trackingLastRouteAt < 8000
  ) {

    return;
  }


  trackingLastRouteAt = now;

  trackingLastRoutePoint = {
    lat: from.lat,
    lng: from.lng
  };


  try {

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lng},${from.lat};` +
      `${to.lng},${to.lat}` +
      `?overview=full&geometries=geojson`;


    const response =
      await fetch(url);


    const data =
      await response.json();


    if (!data.routes?.length) {
      return;
    }


    if (trackingRouteLayer) {

      trackingRouteLayer.remove();
    }


    trackingRouteLayer =
      L.geoJSON(
        data.routes[0].geometry,
        {
          style: {
            weight: 6,
            opacity: 0.85
          }
        }
      ).addTo(trackingMap);

  } catch (error) {

    console.error(
      "TRACKING ROUTE ERROR:",
      error
    );
  }
}


/* =========================================================
   OPEN TRACKING
   ========================================================= */

function openTracking(ride) {

  if (!ride) return;


  activeTrackingRideId =
    ride.id;


  screen("trackingScreen");


  setTimeout(() => {

    initTrackingMap(ride);

  }, 150);


  if (trackingRideUnsubscribe) {

    trackingRideUnsubscribe();

    trackingRideUnsubscribe = null;
  }


  trackingRideUnsubscribe =
    onSnapshot(
      doc(
        db,
        "rides",
        ride.id
      ),
      (snapshot) => {

        if (!snapshot.exists()) {
          return;
        }


        const currentRide = {
          id: snapshot.id,
          ...snapshot.data()
        };


        setTimeout(() => {

          if (!trackingMap) {
            initTrackingMap(
              currentRide
            );
          } else {
            updateTrackingMap(
              currentRide
            );
          }

        }, 50);
      },
      (error) => {

        console.error(
          "TRACKING SNAPSHOT ERROR:",
          error
        );
      }
    );
}


/* =========================================================
   CLOSE TRACKING
   ========================================================= */

$("#closeTracking").onclick =
  () => {

    if (trackingRideUnsubscribe) {

      trackingRideUnsubscribe();

      trackingRideUnsubscribe =
        null;
    }


    activeTrackingRideId =
      null;


    screen(
      profile?.role === "captain"
        ? "captain"
        : "rides"
    );
  };


/* =========================================================
   START CAPTAIN LIVE LOCATION
   ========================================================= */

async function startCaptainLocationTracking(
  rideId
) {

  if (
    !user ||
    profile?.role !== "captain"
  ) {
    return false;
  }


  await stopCaptainLocationTracking();


  try {

    const permission =
      await Geolocation.checkPermissions();


    if (
      permission.location !==
      "granted"
    ) {

      const result =
        await Geolocation.requestPermissions();


      if (
        result.location !==
        "granted"
      ) {

        msg(
          "لازم تسمح للتطبيق باستخدام الموقع حتى يظهر مكانك للعميل.",
          "error"
        );

        return false;
      }
    }


    activeTrackingRideId =
      rideId;


    const position =
      await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      });


    const firstPoint = {

      lat:
        position.coords.latitude,

      lng:
        position.coords.longitude
    };


    await updateDoc(
      doc(
        db,
        "rides",
        rideId
      ),
      {
        captainLocation:
          firstPoint,

        captainLocationUpdatedAt:
          serverTimestamp()
      }
    );


    captainLocationWatchId =
      await Geolocation.watchPosition(
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 2000
        },

        async (
          position,
          error
        ) => {

          if (error) {

            console.error(
              "CAPTAIN LIVE LOCATION ERROR:",
              error
            );

            return;
          }


          if (
            !position ||
            !user ||
            activeTrackingRideId !==
              rideId
          ) {

            return;
          }


          const point = {

            lat:
              position.coords.latitude,

            lng:
              position.coords.longitude
          };


          try {

            await updateDoc(
              doc(
                db,
                "rides",
                rideId
              ),
              {
                captainLocation:
                  point,

                captainLocationUpdatedAt:
                  serverTimestamp()
              }
            );

          } catch (firestoreError) {

            console.error(
              "CAPTAIN LIVE LOCATION FIRESTORE ERROR:",
              firestoreError
            );
          }


          if (
            trackingMap &&
            activeTrackingRideId ===
              rideId
          ) {

            if (
              trackingCaptainMarker
            ) {

              trackingCaptainMarker
                .setLatLng([
                  point.lat,
                  point.lng
                ]);

            }
          }
        }
      );


    msg(
      "تم تشغيل تتبع موقعك للعميل 📍",
      "success"
    );


    return true;

  } catch (error) {

    console.error(
      "START CAPTAIN TRACKING ERROR:",
      error
    );


    msg(
      "تعذر تشغيل تتبع موقعك. تأكد من تشغيل GPS والسماح للتطبيق بالموقع.",
      "error"
    );


    return false;
  }
}


/* =========================================================
   STOP CAPTAIN LIVE LOCATION
   ========================================================= */

async function stopCaptainLocationTracking() {

  if (
    captainLocationWatchId !== null
  ) {

    try {

      await Geolocation.clearWatch({
        id:
          captainLocationWatchId
      });

    } catch (error) {

      console.error(
        "CLEAR LOCATION WATCH ERROR:",
        error
      );
    }


    captainLocationWatchId =
      null;
  }


  activeTrackingRideId =
    null;
}


/* =========================================================
   MAP MODE UI
   ========================================================= */

function updateMapModeUI() {

  const isPickup =
    mapMode === "pickup";

  $("#mapTitle").textContent =
    isPickup
      ? "📍 تحديد مكان الانطلاق"
      : "🏁 تحديد مكان الوصول";

  $("#mapHint").textContent =
    isPickup
      ? "اكتب اسم البلد أو القرية أو المدينة أو الشارع، أو حرّك الخريطة حتى الدبوس فوق المكان."
      : "اكتب اسم البلد أو القرية أو المدينة أو الشارع، أو حرّك الخريطة حتى الدبوس فوق المكان.";

  $("#search").placeholder =
    isPickup
      ? "🔎 ابحث عن بلد، قرية، مدينة أو شارع الانطلاق"
      : "🔎 ابحث عن بلد، قرية، مدينة أو شارع الوصول";

  $("#confirmDest").textContent =
    isPickup
      ? "✅ تأكيد مكان الانطلاق"
      : "✅ تأكيد مكان الوصول";

  const currentPoint =
    isPickup
      ? pickup
      : destination;

  if (currentPoint) {

    $("#coords").textContent =
      `${currentPoint.lat.toFixed(6)}, ${currentPoint.lng.toFixed(6)}`;

  }
}


/* =========================================================
   MAP CENTER
   ========================================================= */

let centerRequestId = 0;

async function centerChanged() {

  if (!map) return;

  const center = map.getCenter();

  const point = {
    lat: center.lat,
    lng: center.lng
  };

  const requestId =
    ++centerRequestId;


  if (mapMode === "pickup") {

    pickup = point;

    if (pickupMarker) {

      pickupMarker.setLatLng([
        point.lat,
        point.lng
      ]);

    } else {

      pickupMarker =
        marker("pickup", pickup);
    }

  } else {

    destination = point;

    if (destMarker) {

      destMarker.setLatLng([
        point.lat,
        point.lng
      ]);

    } else {

      destMarker =
        marker("destination", destination);
    }
  }


  $("#coords").textContent =
    `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;

  $("#address").textContent =
    "جاري تحديد العنوان...";


  const address =
    await reverse(
      point.lat,
      point.lng
    );


  if (requestId !== centerRequestId) {
    return;
  }


  $("#address").innerHTML =
    mapMode === "pickup"
      ? `📍 <strong>${esc(address)}</strong>`
      : `🏁 <strong>${esc(address)}</strong>`;


  drawRoute();
}


/* =========================================================
   INIT MAP
   ========================================================= */

function initMap() {

  if (map) {

    setTimeout(
      () => map.invalidateSize(),
      200
    );

    return;
  }


  let startPoint = null;

  if (mapMode === "pickup") {

    startPoint =
      pickup
        ? [pickup.lat, pickup.lng]
        : [30.5526, 31.0106];

  } else {

    startPoint =
      destination
        ? [destination.lat, destination.lng]
        : pickup
          ? [pickup.lat, pickup.lng]
          : [30.5526, 31.0106];
  }


  map = L.map("map", {
    zoomControl: false
  }).setView(
    startPoint,
    pickup || destination ? 18 : 13
  );


  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 20,
      attribution:
        "© OpenStreetMap contributors"
    }
  ).addTo(map);


  L.control.zoom({
    position: "bottomright"
  }).addTo(map);


  map.on(
    "moveend",
    centerChanged
  );


  if (pickup) {
    pickupMarker =
      marker("pickup", pickup);
  }


  if (destination) {
    destMarker =
      marker("destination", destination);
  }


  updateMapModeUI();


  setTimeout(
    () => centerChanged(),
    300
  );
}


/* =========================================================
   OPEN MAP IN PICKUP MODE
   ========================================================= */

function openPickupMap() {

  mapMode = "pickup";

  updateMapModeUI();

  screen("mapScreen");


  setTimeout(() => {

    initMap();

    if (!map) return;

    map.invalidateSize();


    if (pickup) {

      map.setView(
        [
          pickup.lat,
          pickup.lng
        ],
        19
      );

    } else if (destination) {

      map.setView(
        [
          destination.lat,
          destination.lng
        ],
        13
      );

    } else {

      map.setView(
        [30.5526, 31.0106],
        13
      );
    }

  }, 150);
}


/* =========================================================
   OPEN MAP IN DESTINATION MODE
   ========================================================= */

function openDestinationMap() {

  mapMode = "destination";

  updateMapModeUI();

  screen("mapScreen");


  setTimeout(() => {

    initMap();

    if (!map) return;

    map.invalidateSize();


    if (destination) {

      map.setView(
        [
          destination.lat,
          destination.lng
        ],
        19
      );

    } else if (pickup) {

      map.setView(
        [
          pickup.lat,
          pickup.lng
        ],
        13
      );

    } else {

      map.setView(
        [30.5526, 31.0106],
        13
      );
    }

  }, 150);
}


/* =========================================================
   SET PICKUP BY GPS
   ========================================================= */

async function setPickup() {

  try {

    const point =
      await exactLocation();

    pickup = {
      lat: point.lat,
      lng: point.lng
    };


    if (pickupMarker) {

      pickupMarker.setLatLng([
        point.lat,
        point.lng
      ]);

    } else if (map) {

      pickupMarker =
        marker("pickup", pickup);
    }


    if (accuracyCircle && map) {
      accuracyCircle.remove();
    }


    if (map) {

      accuracyCircle =
        L.circle(
          [point.lat, point.lng],
          {
            radius:
              Math.max(10, point.accuracy),
            weight: 2,
            fillOpacity: 0.08
          }
        ).addTo(map);
    }


    const address =
      await reverse(
        point.lat,
        point.lng
      );


    $("#pickupText").innerHTML =
      `
        📍 <strong>${esc(address)}</strong>
        <br>
        <small>
          دقة GPS تقريباً
          ${Math.round(point.accuracy)}
          متر
        </small>
      `;


    if (map) {

      mapMode = "pickup";

      updateMapModeUI();

      map.setView(
        [point.lat, point.lng],
        19
      );
    }


    msg(
      "تم تحديد مكان الانطلاق من موقعك الحالي 📍",
      "success"
    );

  } catch (error) {

    console.error(
      "GPS PICKUP ERROR:",
      error
    );

    msg(
      "لم نتمكن من استخدام GPS. يمكنك تحديد الانطلاق يدوياً من الخريطة.",
      "error"
    );
  }
}


/* =========================================================
   ROUTE
   ========================================================= */

async function drawRoute() {

  if (
    !pickup ||
    !destination ||
    !map
  ) {
    return;
  }


  try {

    const url =
      `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;


    const response =
      await fetch(url);

    const data =
      await response.json();


    if (!data.routes?.length) {
      return;
    }


    if (routeLayer) {
      routeLayer.remove();
    }


    routeLayer =
      L.geoJSON(
        data.routes[0].geometry,
        {
          style: {
            weight: 6,
            opacity: 0.85
          }
        }
      ).addTo(map);

  } catch (error) {

    console.error(error);
  }
}


/* =========================================================
   SEARCH PLACES
   ========================================================= */

async function searchPlaces(queryText) {

  const box = $("#results");

  if (queryText.length < 3) {

    box.innerHTML = "";

    return;
  }


  box.innerHTML =
    "<div class='status'>🔎 جاري البحث...</div>";


  try {

    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(queryText + ", Egypt")}&limit=8&addressdetails=1&accept-language=ar&countrycodes=eg`;


    const response =
      await fetch(url);

    const data =
      await response.json();


    box.innerHTML =
      data.length
        ? data
            .map(
              (item) =>
                `
                <button
                  class="search-result"
                  data-lat="${item.lat}"
                  data-lon="${item.lon}"
                  data-name="${esc(item.display_name)}"
                >
                  📍 ${esc(item.display_name)}
                </button>
                `
            )
            .join("")
        : "<div class='status'>لا توجد نتائج.</div>";


    box
      .querySelectorAll(".search-result")
      .forEach((button) => {

        button.onclick = () => {

          const point = {
            lat:
              Number(button.dataset.lat),

            lng:
              Number(button.dataset.lon)
          };


          if (mapMode === "pickup") {

            pickup = point;


            if (pickupMarker) {

              pickupMarker.setLatLng([
                point.lat,
                point.lng
              ]);

            } else if (map) {

              pickupMarker =
                marker(
                  "pickup",
                  pickup
                );
            }

          } else {

            destination = point;


            if (destMarker) {

              destMarker.setLatLng([
                point.lat,
                point.lng
              ]);

            } else if (map) {

              destMarker =
                marker(
                  "destination",
                  destination
                );
            }
          }


          if (map) {

            map.setView(
              [
                point.lat,
                point.lng
              ],
              19
            );
          }


          $("#search").value =
            button.dataset.name;

          box.innerHTML = "";


          $("#coords").textContent =
            `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;


          $("#address").innerHTML =
            mapMode === "pickup"
              ? `📍 <strong>${esc(button.dataset.name)}</strong>`
              : `🏁 <strong>${esc(button.dataset.name)}</strong>`;


          drawRoute();
        };
      });

  } catch (error) {

    console.error(
      "SEARCH ERROR:",
      error
    );

    box.innerHTML =
      "<div class='status'>تعذر البحث. حاول مرة أخرى.</div>";
  }
}


/* =========================================================
   MAP EVENTS
   ========================================================= */

$("#choosePickup").onclick =
  () => {
    openPickupMap();
  };


$("#myLocation").onclick =
  async () => {
    await setPickup();
  };


$("#mapLocation").onclick =
  async () => {

    if (mapMode === "pickup") {

      await setPickup();

      return;
    }


    try {

      const point =
        await exactLocation();


      destination = {
        lat: point.lat,
        lng: point.lng
      };


      if (destMarker) {

        destMarker.setLatLng([
          point.lat,
          point.lng
        ]);

      } else if (map) {

        destMarker =
          marker(
            "destination",
            destination
          );
      }


      const address =
        await reverse(
          point.lat,
          point.lng
        );


      $("#address").innerHTML =
        `🏁 <strong>${esc(address)}</strong>`;


      $("#coords").textContent =
        `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;


      if (map) {

        map.setView(
          [
            point.lat,
            point.lng
          ],
          19
        );
      }

    } catch (error) {

      console.error(
        "MAP GPS ERROR:",
        error
      );

      msg(
        "تعذر استخدام GPS. يمكنك اختيار المكان يدوياً من الخريطة.",
        "error"
      );
    }
  };


$("#chooseDest").onclick =
  () => {
    openDestinationMap();
  };


$("#closeMap").onclick =
  () => {

    $("#search").value = "";

    $("#results").innerHTML = "";

    screen("home");
  };


$("#confirmDest").onclick =
  async () => {

    if (mapMode === "pickup") {

      if (!pickup) {

        msg(
          "حدد مكان الانطلاق أولاً.",
          "error"
        );

        return;
      }


      const address =
        await reverse(
          pickup.lat,
          pickup.lng
        );


      $("#pickupText").innerHTML =
        `📍 <strong>${esc(address)}</strong>`;


      $("#search").value = "";

      $("#results").innerHTML = "";


      screen("home");


      msg(
        "تم تحديد مكان الانطلاق بدقة ✅",
        "success"
      );


      return;
    }


    if (!destination) {

      msg(
        "حدد مكان الوصول أولاً.",
        "error"
      );

      return;
    }


    const address =
      await reverse(
        destination.lat,
        destination.lng
      );


    $("#destText").innerHTML =
      `🏁 <strong>${esc(address)}</strong>`;


    $("#search").value = "";

    $("#results").innerHTML = "";


    screen("home");


    msg(
      "تم تحديد مكان الوصول بدقة ✅",
      "success"
    );
  };


let searchTimer;

$("#search").oninput =
  () => {

    clearTimeout(searchTimer);

    searchTimer =
      setTimeout(
        () =>
          searchPlaces(
            $("#search").value.trim()
          ),
        650
      );
  };


$("#rideDate").onchange =
  () => {

    $("#dayPreview").textContent =
      dayName($("#rideDate").value)
        ? `📆 ${dayName($("#rideDate").value)}`
        : "";
  };


/* =========================================================
   REQUEST RIDE
   ========================================================= */

$("#request").onclick =
  async () => {

    if (!user) {

      screen("login");

      return;
    }


    if (profile?.role !== "customer") {

      msg(
        "حساب الكابتن لا يطلب رحلة.",
        "error"
      );

      return;
    }


    if (!pickup || !destination) {

      msg(
        "حدد الانطلاق والوصول أولاً.",
        "error"
      );

      return;
    }


    const price =
      Number($("#price").value);

    const date =
      $("#rideDate").value;

    const time =
      $("#rideTime").value;


    if (!price || !date || !time) {

      msg(
        "اكتب السعر والتاريخ والوقت.",
        "error"
      );

      return;
    }


    try {

      const fromPlace =
        await reverse(
          pickup.lat,
          pickup.lng
        );


      const toPlace =
        await reverse(
          destination.lat,
          destination.lng
        );


      const ride =
        await addDoc(
          collection(db, "rides"),
          {
            customerId: user.uid,

            customerName:
              profile.name || "",

            customerPhoto:
              profile.photoURL || "",

            customerPhone:
              profile.phone ||
              "",

            fromPlace,

            toPlace,

            pickupCoords:
              pickup,

            destinationCoords:
              destination,

            price,

            originalPrice:
              price,

            offeredPrice:
              null,

            agreedPrice:
              null,

            passengers:
              Number($("#passengers").value),

            notes:
              $("#notes").value.trim(),

            rideDate: date,

            rideTime: time,

            dayName:
              dayName(date),

            status: "open",

            captainId: "",

            createdAt:
              serverTimestamp()
          }
        );


      localStorage.setItem(
        "lastRide",
        ride.id
      );


      $("#price").value = "";
      $("#notes").value = "";


      msg(
        "تم نشر الرحلة للكباتن 🚕",
        "success"
      );


      screen("rides");

      loadCustomerRides();

    } catch (error) {

      console.error(error);

      msg(
        "تعذر إرسال الرحلة.",
        "error"
      );
    }
  };


/* =========================================================
   ROLE CHANGE
   ========================================================= */

$("#role").onchange =
  () => {

    $("#captainFields").style.display =
      $("#role").value === "captain"
        ? "block"
        : "none";
  };


$("#registerOpen").onclick =
  () => screen("register");


$("#backLogin").onclick =
  () => screen("login");


/* =========================================================
   AVATAR
   ========================================================= */

function avatarHTML(
  photo,
  name,
  cls = "profile-avatar"
) {

  const n =
    String(name || "مستخدم").trim();

  const initial =
    esc(
      n
        ? Array.from(n)[0]
        : "👤"
    );


  return photo

    ? `
      <img
        class="${cls}"
        src="${esc(photo)}"
        alt="${esc(n)}"
        loading="lazy"
        onerror="
          this.style.display='none';
          this.nextElementSibling.style.display='flex'
        "
      >

      <span
        class="${cls} avatar-fallback"
        style="display:none"
      >
        ${initial}
      </span>
    `

    : `
      <span
        class="${cls} avatar-fallback"
      >
        ${initial}
      </span>
    `;
}


/* =========================================================
   IMAGE RESIZE
   ========================================================= */

function resizeImage(
  file,
  max = 512,
  quality = 0.78
) {

  return new Promise(
    (resolve, reject) => {

      if (!file) {

        resolve(null);

        return;
      }


      if (!file.type.startsWith("image/")) {

        reject(
          Error("اختر صورة فقط.")
        );

        return;
      }


      const image = new Image();

      const url =
        URL.createObjectURL(file);


      image.onload = () => {

        try {

          const scale =
            Math.min(
              1,
              max /
                Math.max(
                  image.width,
                  image.height
                )
            );


          const canvas =
            document.createElement(
              "canvas"
            );


          canvas.width =
            Math.max(
              1,
              Math.round(
                image.width * scale
              )
            );


          canvas.height =
            Math.max(
              1,
              Math.round(
                image.height * scale
              )
            );


          const ctx =
            canvas.getContext("2d");


          ctx.drawImage(
            image,
            0,
            0,
            canvas.width,
            canvas.height
          );


          canvas.toBlob(
            (blob) => {

              URL.revokeObjectURL(url);

              blob
                ? resolve(blob)
                : reject(
                    Error(
                      "تعذر تجهيز الصورة."
                    )
                  );
            },
            "image/jpeg",
            quality
          );

        } catch (error) {

          URL.revokeObjectURL(url);

          reject(error);
        }
      };


      image.onerror = () => {

        URL.revokeObjectURL(url);

        reject(
          Error("الصورة غير صالحة.")
        );
      };


      image.src = url;
    }
  );
}


/* =========================================================
   UPLOAD PROFILE PHOTO
   ========================================================= */

async function uploadProfilePhoto(
  uid,
  file
) {

  if (!file) return "";

  const blob =
    await resizeImage(
      file,
      512,
      0.78
    );


  const storageRef =
    ref(
      storage,
      `profiles/${uid}/profile.jpg`
    );


  await uploadBytes(
    storageRef,
    blob,
    {
      contentType: "image/jpeg",
      cacheControl:
        "public,max-age=3600"
    }
  );


  return await getDownloadURL(
    storageRef
  );
}


/* =========================================================
   REGISTER
   ========================================================= */

$("#finishReg").onclick =
  async () => {

    const button = $("#finishReg");

    const name =
      $("#name").value.trim();

    const phoneNumber =
      phone($("#regPhone").value);

    const password =
      $("#regPass").value;

    const password2 =
      $("#regPass2").value;

    const role =
      $("#role").value;

    $("#regMsg").textContent = "";


    if (!name) {

      $("#regMsg").textContent =
        "اكتب الاسم بالكامل.";

      return;
    }


    if (!/^\+20\d{10}$/.test(phoneNumber)) {

      $("#regMsg").textContent =
        "اكتب رقم موبايل مصري صحيح مثل 010xxxxxxxx.";

      return;
    }


    if (password.length < 6) {

      $("#regMsg").textContent =
        "كلمة المرور لازم تكون 6 أحرف أو أرقام على الأقل.";

      return;
    }


    if (password !== password2) {

      $("#regMsg").textContent =
        "كلمتا المرور غير متطابقتين.";

      return;
    }


    if (
      role === "captain" &&
      (
        !$("#age").value ||
        Number($("#age").value) < 18 ||
        !$("#carType").value.trim() ||
        !$("#carModel").value.trim() ||
        !$("#plate").value.trim()
      )
    ) {

      $("#regMsg").textContent =
        "أكمل بيانات الكابتن: السن ونوع العربية والموديل ورقم اللوحة.";

      return;
    }


    try {

      authBusy = true;

      button.disabled = true;

      button.textContent =
        "جاري إنشاء الحساب...";


      const internalEmail =
        loginEmail(
          phoneNumber,
          role
        );


      console.log(
        "REGISTER EMAIL:",
        internalEmail
      );


      const credential =
        await createUserWithEmailAndPassword(
          auth,
          internalEmail,
          password
        );


      const newUser =
        credential.user;


      const data = {

        uid:
          newUser.uid,

        name:
          name,

        phone:
          phoneNumber,

        role:
          role,

        photoURL:
          "",

        accountNumber:
          accountNo(),

        createdAt:
          serverTimestamp(),

        rating:
          0,

        ratingCount:
          0
      };


      if (role === "captain") {

        data.age =
          Number($("#age").value);

        data.carType =
          $("#carType")
            .value
            .trim();

        data.carModel =
          $("#carModel")
            .value
            .trim();

        data.plateNumber =
          $("#plate")
            .value
            .trim();

        data.captainStatus =
          "available";
      }


      try {

        await setDoc(
          doc(
            db,
            "users",
            newUser.uid
          ),
          data
        );

      } catch (firestoreError) {

        console.error(
          "FIRESTORE PROFILE ERROR:",
          firestoreError
        );


        try {

          await deleteUser(
            newUser
          );

        } catch (deleteError) {

          console.error(
            "DELETE ORPHAN ACCOUNT ERROR:",
            deleteError
          );
        }


        throw firestoreError;
      }


      user =
        newUser;

      profile =
        {
          ...data,
          uid: newUser.uid
        };


      $("#regMsg").textContent =
        "تم إنشاء الحساب بنجاح ✅";


      msg(
        "تم إنشاء الحساب وتسجيل الدخول ✅",
        "success"
      );


      if (role === "captain") {

        screen("captain");

        loadCaptain();

      } else {

        screen("home");

        loadCustomerRides();
      }


    } catch (error) {

      console.error(
        "REGISTER ERROR:",
        error
      );


      if (
        error.code ===
        "auth/email-already-in-use"
      ) {

        $("#regMsg").textContent =
          "الحساب ده موجود بالفعل. ادخل من شاشة تسجيل الدخول.";

      }

      else if (
        error.code ===
        "auth/invalid-email"
      ) {

        $("#regMsg").textContent =
          "رقم الموبايل غير صحيح.";

      }

      else if (
        error.code ===
        "auth/weak-password"
      ) {

        $("#regMsg").textContent =
          "كلمة المرور ضعيفة. لازم تكون 6 أحرف أو أرقام على الأقل.";

      }

      else if (
        error.code ===
        "auth/api-key-not-valid"
      ) {

        $("#regMsg").textContent =
          "Firebase رفض مفتاح التطبيق. بيانات Firebase في المشروع تحتاج مراجعة.";

      }

      else if (
        error.code ===
        "auth/network-request-failed"
      ) {

        $("#regMsg").textContent =
          "تعذر الاتصال بـ Firebase. تأكد من الإنترنت وحاول مرة أخرى.";

      }

      else if (
        error.code ===
        "permission-denied"
      ) {

        $("#regMsg").textContent =
          "تم إنشاء الحساب لكن Firebase رفض حفظ بيانات الحساب.";

      }

      else {

        $("#regMsg").textContent =
          error.message ||
          "تعذر إنشاء الحساب.";
      }


    } finally {

      authBusy = false;

      button.disabled = false;

      button.textContent =
        "إنشاء الحساب";
    }
  };


/* =========================================================
   LOGIN
   ========================================================= */

$("#loginBtn").onclick =
  async () => {

    const button =
      $("#loginBtn");

    const phoneNumber =
      phone(
        $("#loginPhone").value
      );

    const password =
      $("#loginPass").value;

    const role =
      $("#loginRole").value;


    $("#loginMsg").textContent = "";


    if (
      !/^\+20\d{10}$/.test(
        phoneNumber
      )
    ) {

      $("#loginMsg").textContent =
        "اكتب رقم موبايل مصري صحيح مثل 010xxxxxxxx.";

      return;
    }


    if (!password) {

      $("#loginMsg").textContent =
        "اكتب كلمة المرور.";

      return;
    }


    try {

      authBusy = true;

      button.disabled = true;

      button.textContent =
        "جاري الدخول...";


      const internalEmail =
        loginEmail(
          phoneNumber,
          role
        );


      console.log(
        "LOGIN EMAIL:",
        internalEmail
      );


      let credential;


      try {

        credential =
          await signInWithEmailAndPassword(
            auth,
            internalEmail,
            password
          );

      } catch (loginError) {

        if (
          (
            loginError.code ===
              "auth/invalid-credential" ||

            loginError.code ===
              "auth/user-not-found" ||

            loginError.code ===
              "auth/wrong-password"
          ) &&
          role === "customer"
        ) {

          const legacyEmail =
            legacyLoginEmail(
              phoneNumber
            );


          if (
            legacyEmail &&
            legacyEmail !==
              internalEmail
          ) {

            try {

              credential =
                await signInWithEmailAndPassword(
                  auth,
                  legacyEmail,
                  password
                );

            } catch (legacyError) {

              console.error(
                "LEGACY LOGIN ERROR:",
                legacyError
              );

              throw loginError;
            }

          } else {

            throw loginError;
          }

        } else {

          throw loginError;
        }
      }


      const loggedUser =
        credential.user;


      const profileRef =
        doc(
          db,
          "users",
          loggedUser.uid
        );


      const profileDoc =
        await getDoc(
          profileRef
        );


      if (!profileDoc.exists()) {

        await signOut(auth);

        user = null;

        profile = null;


        $("#loginMsg").textContent =
          "الحساب موجود في Firebase Authentication لكن بيانات الحساب غير موجودة. لازم إنشاء الحساب من جديد.";

        return;
      }


      const userProfile =
        profileDoc.data();


      if (
        userProfile.role !== role
      ) {

        await signOut(auth);

        user = null;

        profile = null;


        $("#loginMsg").textContent =
          "الحساب ده مسجل بنوع حساب مختلف. اختار النوع الصحيح: عميل أو كابتن.";

        return;
      }


      user =
        loggedUser;

      profile =
        userProfile;


      $("#loginMsg").textContent =
        "تم تسجيل الدخول بنجاح ✅";


      msg(
        "أهلاً بيك 👋 تم تسجيل الدخول بنجاح",
        "success"
      );


      if (role === "captain") {

        screen("captain");

        loadCaptain();

      } else {

        screen("home");

        loadCustomerRides();
      }


    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );


      if (
        error.code ===
        "auth/api-key-not-valid"
      ) {

        $("#loginMsg").textContent =
          "Firebase رفض مفتاح التطبيق. الكود متصل بمشروع Firebase لكن مفتاح API يحتاج مراجعة.";

      }

      else if (
        error.code ===
        "auth/network-request-failed"
      ) {

        $("#loginMsg").textContent =
          "تعذر الاتصال بـ Firebase. تأكد من الإنترنت وحاول مرة أخرى.";

      }

      else if (
        error.code ===
        "auth/too-many-requests"
      ) {

        $("#loginMsg").textContent =
          "محاولات دخول كثيرة. انتظر قليلاً ثم حاول مرة أخرى.";

      }

      else if (
        error.code ===
        "auth/user-disabled"
      ) {

        $("#loginMsg").textContent =
          "الحساب متوقف من Firebase Authentication.";

      }

      else if (
        error.code ===
        "auth/invalid-credential"
      ) {

        $("#loginMsg").textContent =
          "رقم الموبايل أو كلمة المرور غير صحيحة، أو الحساب غير موجود.";

      }

      else if (
        error.code ===
        "auth/user-not-found"
      ) {

        $("#loginMsg").textContent =
          "الحساب غير موجود بهذا النوع. جرّب اختيار عميل أو كابتن بشكل صحيح.";

      }

      else if (
        error.code ===
        "auth/wrong-password"
      ) {

        $("#loginMsg").textContent =
          "كلمة المرور غير صحيحة.";

      }

      else if (
        error.code ===
        "permission-denied"
      ) {

        $("#loginMsg").textContent =
          "تم تسجيل الدخول لكن Firebase رفض قراءة بيانات الحساب.";

      }

      else {

        $("#loginMsg").textContent =
          error.message ||
          "تعذر تسجيل الدخول. حاول مرة أخرى.";
      }


    } finally {

      authBusy = false;

      button.disabled = false;

      button.textContent =
        "تسجيل الدخول";
    }
  };
/* =========================================================
   LOAD PROFILE
   ========================================================= */

async function loadProfile() {

  if (!user) return;


  const snapshot =
    await getDoc(
      doc(
        db,
        "users",
        user.uid
      )
    );


  if (snapshot.exists()) {

    profile =
      snapshot.data();
  }


  if (!profile) return;


  $("#profileInfo").innerHTML = `

    <div class="profile-main">

      ${avatarHTML(
        profile.photoURL,
        profile.name,
        "profile-avatar-lg"
      )}

      <div>

        <strong class="profile-name">
          ${esc(
            profile.name ||
              "بدون اسم"
          )}
        </strong>

        <div class="muted">
          ${
            profile.role === "captain"
              ? "🚗 كابتن"
              : "👤 عميل"
          }
        </div>

      </div>

    </div>


    <div class="profile-row">

      <span>
        👤 الاسم
      </span>

      <strong>
        ${esc(profile.name)}
      </strong>

    </div>


    <div class="profile-row">

      <span>
        📱 الموبايل
      </span>

      <strong>
        ${esc(profile.phone)}
      </strong>

    </div>


    <div class="profile-row">

      <span>
        🔢 رقم الحساب
      </span>

      <strong>
        ${esc(profile.accountNumber)}
      </strong>

    </div>


    <div class="profile-row">

      <span>
        النوع
      </span>

      <strong>
        ${
          profile.role === "captain"
            ? "🚗 كابتن"
            : "👤 عميل"
        }
      </strong>

    </div>


    ${
      profile.role === "captain"
        ? `

          <div class="profile-row">

            <span>
              🚘 العربية
            </span>

            <strong>
              ${esc(
                profile.carType
              )}

              ${esc(
                profile.carModel
              )}

              -

              ${esc(
                profile.plateNumber
              )}
            </strong>

          </div>


          <div class="profile-row">

            <span>
              ⭐ التقييم
            </span>

            <strong>
              ${Number(
                profile.rating || 0
              ).toFixed(1)}

              (${profile.ratingCount || 0})
            </strong>

          </div>

        `
        : ""
    }

  `;
}


/* =========================================================
   CUSTOMER RIDE CARD
   ========================================================= */

function customerCard(ride) {

  let contact = "";


  if (
    ride.status === "accepted" ||
    ride.status === "captain_to_customer" ||
    ride.status === "arrived" ||
    ride.status === "started" ||
    ride.status === "completed"
  ) {

    contact =
      ride.captainPhone
        ? `

          <div class="contact-box captain-mini">

            <div class="person-line">

              ${avatarHTML(
                ride.captainPhoto,
                ride.captainName,
                "profile-avatar"
              )}

              <div>

                <strong>
                  ${esc(
                    ride.captainName ||
                      "الكابتن"
                  )}
                </strong>

                <small>
                  🚗

                  ${esc(
                    ride.captainCarType ||
                      ""
                  )}

                  ${esc(
                    ride.captainCarModel ||
                      ""
                  )}

                </small>

              </div>

            </div>

            📞

            <a
              href="tel:${esc(
                ride.captainPhone
              )}"
            >
              ${esc(
                ride.captainPhone
              )}
            </a>

          </div>

        `
        : "";
  }


  const finalPrice =
    ride.agreedPrice ??
    ride.price;


  return `

    <div class="card">

      <div class="ride-status">
        ${statusText(ride.status)}
      </div>


      <div class="person-line customer-trip-person">

        ${avatarHTML(
          ride.customerPhoto ||
            profile?.photoURL,
          ride.customerName ||
            profile?.name,
          "profile-avatar"
        )}

        <div>

          <strong>
            ${esc(
              ride.customerName ||
                profile?.name ||
                "العميل"
            )}
          </strong>

          <small>
            صاحب الرحلة
          </small>

        </div>

      </div>


      <b>
        📍
        ${esc(ride.fromPlace)}
      </b>

      <br>

      🏁
      ${esc(ride.toPlace)}


      <p>
        💰
        ${finalPrice}
        جنيه
        •
        👥
        ${ride.passengers}
      </p>


      ${
        ride.status === "price_offered"
          ? `
            <div
              class="contact-box"
              style="margin-top:12px"
            >

              <strong>
                💰 الكابتن اقترح سعر جديد
              </strong>

              <br>

              السعر الذي اقترحته أنت:
              <strong>
                ${Number(
                  ride.originalPrice ??
                  ride.price ??
                  0
                )}
                جنيه
              </strong>

              <br>

              سعر الكابتن:
              <strong>
                ${Number(
                  ride.offeredPrice || 0
                )}
                جنيه
              </strong>

            </div>


            <button
              class="btn green"
              data-accept-offer="${ride.id}"
            >
              ✅ موافقة على سعر الكابتن
            </button>


            <button
              class="btn danger"
              data-reject-offer="${ride.id}"
            >
              ❌ رفض السعر
            </button>
          `
          : ""
      }


      <p>
        📅
        ${formatDate(
          ride.rideDate
        )}

        •

        ${esc(
          ride.dayName
        )}

        •

        🕐
        ${esc(
          ride.rideTime
        )}
      </p>


      ${
        ride.notes
          ? `
            <p>
              📝
              ${esc(
                ride.notes
              )}
            </p>
          `
          : ""
      }


      ${contact}


      ${
        ride.status ===
          "captain_to_customer" ||
        ride.status === "arrived" ||
        ride.status === "started"
          ? `
            <button
              class="btn primary"
              data-track-customer="${ride.id}"
            >
              📍 متابعة الكابتن على الخريطة
            </button>
          `
          : ""
      }


      ${
        ride.status === "started"
          ? `
            <button
              class="btn green"
              data-complete-customer="${ride.id}"
            >
              🏁 إنهاء الرحلة
            </button>
          `
          : ""
      }


      ${
        ride.status === "completed"
          ? `
            <div class="status">
              ✅ الرحلة انتهت بنجاح
            </div>
          `
          : ""
      }

    </div>

  `;
}


/* =========================================================
   CUSTOMER RIDES
   ========================================================= */

async function loadCustomerRides() {

  if (
    !user ||
    profile?.role !== "customer"
  ) {
    return;
  }


  if (watchCustomer) {
    watchCustomer();
  }


  watchCustomer =
    onSnapshot(
      query(
        collection(
          db,
          "rides"
        ),

        where(
          "customerId",
          "==",
          user.uid
        ),

        limit(50)
      ),

      (snapshot) => {

        const rides =
          snapshot.docs
            .map(
              (item) => ({
                id: item.id,
                ...item.data()
              })
            )
            .sort(
              (a, b) =>
                (
                  b.createdAt?.seconds ||
                  0
                ) -
                (
                  a.createdAt?.seconds ||
                  0
                )
            );


        $("#ridesList").innerHTML =
          rides.length

            ? rides
                .map(customerCard)
                .join("")

            : `
              <div class="card">
                لا توجد رحلات حتى الآن.
              </div>
            `;


        document
          .querySelectorAll(
            "[data-complete-customer]"
          )
          .forEach((button) => {

            button.onclick =
              async () => {

                try {

                  await updateDoc(
                    doc(
                      db,
                      "rides",
                      button.dataset
                        .completeCustomer
                    ),
                    {
                      status:
                        "completed",

                      completedAt:
                        serverTimestamp(),

                      updatedAt:
                        serverTimestamp()
                    }
                  );


                  msg(
                    "تم إنهاء الرحلة بنجاح 🏁",
                    "success"
                  );

                } catch (error) {

                  console.error(
                    error
                  );

                  msg(
                    "تعذر إنهاء الرحلة.",
                    "error"
                  );
                }
              };
          });


        document
          .querySelectorAll(
            "[data-accept-offer]"
          )
          .forEach((button) => {

            button.onclick =
              () =>
                acceptCaptainOffer(
                  button.dataset
                    .acceptOffer
                );
          });


        document
          .querySelectorAll(
            "[data-reject-offer]"
          )
          .forEach((button) => {

            button.onclick =
              () =>
                rejectCaptainOffer(
                  button.dataset
                    .rejectOffer
                );
          });


        document
          .querySelectorAll(
            "[data-track-customer]"
          )
          .forEach((button) => {

            button.onclick =
              () =>
                openCustomerTrackingById(
                  button.dataset
                    .trackCustomer
                );
          });
      }
    );
}


/* =========================================================
   ACCEPT CAPTAIN PRICE OFFER
   ========================================================= */

async function acceptCaptainOffer(id) {

  if (
    !user ||
    profile?.role !== "customer"
  ) {
    return;
  }


  try {

    await runTransaction(
      db,
      async (transaction) => {

        const rideRef =
          doc(
            db,
            "rides",
            id
          );


        const snapshot =
          await transaction.get(
            rideRef
          );


        if (!snapshot.exists()) {

          throw Error(
            "الرحلة غير موجودة."
          );
        }


        const ride =
          snapshot.data();


        if (
          ride.customerId !==
          user.uid
        ) {

          throw Error(
            "هذه الرحلة ليست ملكك."
          );
        }


        if (
          ride.status !==
          "price_offered"
        ) {

          throw Error(
            "عرض السعر لم يعد متاحاً."
          );
        }


        const offeredPrice =
          Number(
            ride.offeredPrice
          );


        if (
          !offeredPrice ||
          offeredPrice <= 0
        ) {

          throw Error(
            "سعر الكابتن غير صحيح."
          );
        }


        transaction.update(
          rideRef,
          {

            status:
              "accepted",

            price:
              offeredPrice,

            agreedPrice:
              offeredPrice,

            customerAcceptedOfferAt:
              serverTimestamp(),

            acceptedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );
      }
    );


    msg(
      "تم قبول سعر الكابتن. الكابتن استلم الرحلة ✅",
      "success"
    );


  } catch (error) {

    console.error(
      "ACCEPT CAPTAIN OFFER ERROR:",
      error
    );


    msg(
      error.message ||
        "تعذر قبول السعر.",
      "error"
    );
  }
}


/* =========================================================
   REJECT CAPTAIN PRICE OFFER
   ========================================================= */

async function rejectCaptainOffer(id) {

  if (
    !user ||
    profile?.role !== "customer"
  ) {
    return;
  }


  try {

    await runTransaction(
      db,
      async (transaction) => {

        const rideRef =
          doc(
            db,
            "rides",
            id
          );


        const snapshot =
          await transaction.get(
            rideRef
          );


        if (!snapshot.exists()) {

          throw Error(
            "الرحلة غير موجودة."
          );
        }


        const ride =
          snapshot.data();


        if (
          ride.customerId !==
          user.uid
        ) {

          throw Error(
            "هذه الرحلة ليست ملكك."
          );
        }


        if (
          ride.status !==
          "price_offered"
        ) {

          throw Error(
            "عرض السعر لم يعد متاحاً."
          );
        }


        transaction.update(
          rideRef,
          {

            status:
              "open",

            price:
              Number(
                ride.originalPrice ??
                ride.price ??
                0
              ),

            offeredPrice:
              null,

            agreedPrice:
              null,

            captainId:
              "",

            captainName:
              "",

            captainPhoto:
              "",

            captainPhone:
              "",

            captainCarType:
              "",

            captainCarModel:
              "",

            captainPlateNumber:
              "",

            priceOfferRejectedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );
      }
    );


    msg(
      "تم رفض السعر وإعادة الرحلة للكباتن 🔄",
      "success"
    );


  } catch (error) {

    console.error(
      "REJECT CAPTAIN OFFER ERROR:",
      error
    );


    msg(
      error.message ||
        "تعذر رفض السعر.",
      "error"
    );
  }
}


/* =========================================================
   OPEN CUSTOMER TRACKING BY ID
   ========================================================= */

async function openCustomerTrackingById(
  rideId
) {

  try {

    const snapshot =
      await getDoc(
        doc(
          db,
          "rides",
          rideId
        )
      );


    if (!snapshot.exists()) {

      msg(
        "الرحلة غير موجودة.",
        "error"
      );

      return;
    }


    const ride = {
      id:
        snapshot.id,

      ...snapshot.data()
    };


    if (
      ride.customerId !==
      user.uid
    ) {

      msg(
        "لا يمكنك متابعة هذه الرحلة.",
        "error"
      );

      return;
    }


    openTracking(ride);

  } catch (error) {

    console.error(
      "OPEN CUSTOMER TRACKING ERROR:",
      error
    );


    msg(
      "تعذر فتح خريطة التتبع.",
      "error"
    );
  }
}


/* =========================================================
   CAPTAIN
   ========================================================= */

async function loadCaptain() {

  if (
    profile?.role !== "captain"
  ) {

    $("#captainList").innerHTML =
      `
        <div class="card">
          هذه الصفحة للكابتن فقط.
        </div>
      `;

    return;
  }


  $("#captainState").textContent =
    profile.captainStatus ===
    "available"

      ? "🟢 أنت متاح لاستقبال الرحلات"

      : "⚫ أنت غير متاح";


  if (watchRides) {
    watchRides();
  }


  watchRides =
    onSnapshot(
      query(
        collection(
          db,
          "rides"
        ),

        where(
          "status",
          "==",
          "open"
        ),

        limit(50)
      ),

      (snapshot) => {

        $("#captainList").innerHTML =

          profile.captainStatus ===
            "available" &&
          snapshot.docs.length

            ? snapshot.docs
                .map(
                  (item) => {

                    const ride =
                      item.data();


                    const ridePrice =
                      Number(
                        ride.price || 0
                      );


                    return `

                      <div class="card">

                        <div class="ride-status">
                          🆕 رحلة جديدة
                        </div>


                        <div class="person-line customer-trip-person">

                          ${avatarHTML(
                            ride.customerPhoto,
                            ride.customerName ||
                              "العميل",
                            "profile-avatar"
                          )}

                          <div>

                            <strong>
                              ${esc(
                                ride.customerName ||
                                  "العميل"
                              )}
                            </strong>

                            <small>
                              👤 صاحب الرحلة
                            </small>

                          </div>

                        </div>


                        <b>
                          📍
                          ${esc(
                            ride.fromPlace
                          )}
                        </b>

                        <br>

                        🏁
                        ${esc(
                          ride.toPlace
                        )}


                        <p>
                          💰
                          ${ridePrice}
                          جنيه
                          •
                          👥
                          ${ride.passengers}
                        </p>


                        <p>
                          📅
                          ${formatDate(
                            ride.rideDate
                          )}

                          •

                          ${esc(
                            ride.dayName
                          )}

                          •

                          🕐
                          ${esc(
                            ride.rideTime
                          )}
                        </p>


                        ${
                          ride.notes
                            ? `
                              <p>
                                📝
                                ${esc(
                                  ride.notes
                                )}
                              </p>
                            `
                            : ""
                        }


                        <button
                          class="btn green"
                          data-accept="${item.id}"
                        >
                          ✅ قبول بسعر ${ridePrice} جنيه
                        </button>


                        <button
                          class="btn outline"
                          data-offer-price="${item.id}"
                        >
                          💰 اقتراح سعر آخر
                        </button>

                      </div>

                    `;
                  }
                )
                .join("")

            : `
              <div class="card">
                لا توجد رحلات متاحة الآن.
              </div>
            `;


        document
          .querySelectorAll(
            "[data-accept]"
          )
          .forEach((button) => {

            button.onclick =
              () =>
                acceptRide(
                  button.dataset.accept
                );
          });


        document
          .querySelectorAll(
            "[data-offer-price]"
          )
          .forEach((button) => {

            button.onclick =
              () =>
                offerRidePrice(
                  button.dataset
                    .offerPrice
                );
          });
      }
    );


  if (watchCaptainAccepted) {
    watchCaptainAccepted();
  }


  watchCaptainAccepted =
    onSnapshot(
      query(
        collection(
          db,
          "rides"
        ),

        where(
          "captainId",
          "==",
          user.uid
        ),

        limit(30)
      ),

      (snapshot) => {

        $("#captainAcceptedList").innerHTML =

          snapshot.docs.length

            ? snapshot.docs
                .map(
                  (item) => {

                    const ride =
                      item.data();


                    const finalPrice =
                      ride.agreedPrice ??
                      ride.price;


                    return `

                      <div class="card">

                        <div class="ride-status">
                          ${statusText(
                            ride.status
                          )}
                        </div>


                        <div class="person-line customer-trip-person">

                          ${avatarHTML(
                            ride.customerPhoto,
                            ride.customerName ||
                              "العميل",
                            "profile-avatar"
                          )}

                          <div>

                            <strong>
                              ${esc(
                                ride.customerName ||
                                  "العميل"
                              )}
                            </strong>

                            <small>
                              👤 العميل
                            </small>

                          </div>

                        </div>


                        <b>
                          📍
                          ${esc(
                            ride.fromPlace
                          )}
                        </b>

                        <br>

                        🏁
                        ${esc(
                          ride.toPlace
                        )}


                        <p>
                          💰
                          ${finalPrice}
                          جنيه
                          •
                          👥
                          ${ride.passengers}
                        </p>


                        ${
                          ride.status ===
                          "price_offered"

                            ? `
                              <div class="contact-box">

                                ⏳ في انتظار رد العميل على السعر

                                <br>

                                السعر الأصلي:
                                <strong>
                                  ${Number(
                                    ride.originalPrice ??
                                    ride.price ??
                                    0
                                  )}
                                  جنيه
                                </strong>

                                <br>

                                سعرك المقترح:
                                <strong>
                                  ${Number(
                                    ride.offeredPrice ||
                                    0
                                  )}
                                  جنيه
                                </strong>

                              </div>
                            `
                            : ""
                        }


                        <p>
                          📅
                          ${formatDate(
                            ride.rideDate
                          )}

                          •

                          ${esc(
                            ride.dayName
                          )}

                          •

                          🕐
                          ${esc(
                            ride.rideTime
                          )}
                        </p>


                        ${
                          ride.notes
                            ? `
                              <p>
                                📝
                                ${esc(
                                  ride.notes
                                )}
                              </p>
                            `
                            : ""
                        }


                        ${
                          ride.customerPhone &&
                          (
                            ride.status ===
                              "accepted" ||
                            ride.status ===
                              "captain_to_customer" ||
                            ride.status ===
                              "arrived" ||
                            ride.status ===
                              "started" ||
                            ride.status ===
                              "completed"
                          )
                            ? `
                              <div class="contact-box">

                                📞

                                <a
                                  href="tel:${esc(
                                    ride.customerPhone
                                  )}"
                                >
                                  ${esc(
                                    ride.customerPhone
                                  )}
                                </a>

                                —

                                ${esc(
                                  ride.customerName ||
                                    "العميل"
                                )}

                              </div>
                            `
                            : ""
                        }


                        ${
                          ride.status ===
                          "accepted"

                            ? `
                              <button
                                class="btn primary"
                                data-customer-route="${item.id}"
                              >
                                🚗 أنا في الطريق للعميل
                              </button>
                            `

                            : ""
                        }


                        ${
                          ride.status ===
                          "captain_to_customer"

                            ? `

                              <button
                                class="btn primary"
                                data-track-captain="${item.id}"
                              >
                                📍 متابعة الخريطة
                              </button>

                              <button
                                class="btn green"
                                data-arrived="${item.id}"
                              >
                                📍 وصلت للعميل
                              </button>

                            `

                            : ""
                        }


                        ${
                          ride.status ===
                          "arrived"

                            ? `

                              <button
                                class="btn primary"
                                data-track-captain="${item.id}"
                              >
                                📍 فتح الخريطة
                              </button>

                              <button
                                class="btn green"
                                data-start="${item.id}"
                              >
                                ▶️ بدء الرحلة
                              </button>

                            `

                            : ""
                        }


                        ${
                          ride.status ===
                          "started"

                            ? `

                              <button
                                class="btn primary"
                                data-track-captain="${item.id}"
                              >
                                🗺️ متابعة الرحلة
                              </button>

                              <button
                                class="btn green"
                                data-complete="${item.id}"
                              >
                                🏁 إنهاء الرحلة
                              </button>

                            `

                            : ""
                        }


                        ${
                          ride.status ===
                          "completed"

                            ? `
                              <div class="status">
                                ✅ تم إنهاء الرحلة
                              </div>
                            `
                            : ""
                        }

                      </div>

                    `;
                  }
                )
                .join("")

            : `
              <div class="card">
                لا توجد رحلات قبلتها.
              </div>
            `;


        bindCaptainActions();
      }
    );
}


/* =========================================================
   OFFER NEW PRICE
   ========================================================= */

async function offerRidePrice(id) {

  if (
    !user ||
    profile?.role !== "captain"
  ) {
    return;
  }


  const value =
    window.prompt(
      "اكتب السعر الجديد الذي تريد عرضه على العميل:"
    );


  if (
    value === null
  ) {
    return;
  }


  const newPrice =
    Number(
      String(value).replace(
        /,/g,
        "."
      )
    );


  if (
    !Number.isFinite(newPrice) ||
    newPrice <= 0
  ) {

    msg(
      "اكتب سعر صحيح أكبر من صفر.",
      "error"
    );

    return;
  }


  try {

    await runTransaction(
      db,
      async (transaction) => {

        const rideRef =
          doc(
            db,
            "rides",
            id
          );


        const snapshot =
          await transaction.get(
            rideRef
          );


        if (!snapshot.exists()) {

          throw Error(
            "الرحلة غير موجودة."
          );
        }


        const ride =
          snapshot.data();


        if (
          ride.status !==
          "open"
        ) {

          throw Error(
            "الرحلة تم قبولها أو تعديلها بالفعل."
          );
        }


        transaction.update(
          rideRef,
          {

            status:
              "price_offered",

            originalPrice:
              Number(
                ride.originalPrice ??
                ride.price ??
                0
              ),

            offeredPrice:
              newPrice,

            agreedPrice:
              null,

            captainId:
              user.uid,

            captainName:
              profile.name || "",

            captainPhoto:
              profile.photoURL || "",

            captainPhone:
              profile.phone ||
              user.phoneNumber ||
              "",

            captainCarType:
              profile.carType ||
              "",

            captainCarModel:
              profile.carModel ||
              "",

            captainPlateNumber:
              profile.plateNumber ||
              "",

            priceOfferAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );
      }
    );


    msg(
      `تم إرسال عرضك للعميل بسعر ${newPrice} جنيه 💰`,
      "success"
    );


  } catch (error) {

    console.error(
      "OFFER PRICE ERROR:",
      error
    );


    msg(
      error.message ||
        "تعذر إرسال السعر الجديد.",
      "error"
    );
  }
}


/* =========================================================
   CAPTAIN ACTIONS
   ========================================================= */

function bindCaptainActions() {

  document
    .querySelectorAll(
      "[data-customer-route]"
    )
    .forEach((button) => {

      button.onclick =
        async () => {

          const rideId =
            button.dataset
              .customerRoute;


          try {

            const trackingStarted =
              await startCaptainLocationTracking(
                rideId
              );


            if (!trackingStarted) {
              return;
            }


            await updateDoc(
              doc(
                db,
                "rides",
                rideId
              ),
              {

                status:
                  "captain_to_customer",

                captainLocationStartedAt:
                  serverTimestamp(),

                updatedAt:
                  serverTimestamp()
              }
            );


            msg(
              "أنت الآن في الطريق للعميل 🚗📍",
              "success"
            );


            const snapshot =
              await getDoc(
                doc(
                  db,
                  "rides",
                  rideId
                )
              );


            if (snapshot.exists()) {

              openTracking({
                id:
                  snapshot.id,

                ...snapshot.data()
              });
            }

          } catch (error) {

            console.error(
              "START TO CUSTOMER ERROR:",
              error
            );


            msg(
              "تعذر بدء التوجه للعميل.",
              "error"
            );
          }
        };
    });


  document
    .querySelectorAll(
      "[data-track-captain]"
    )
    .forEach((button) => {

      button.onclick =
        async () => {

          const rideId =
            button.dataset
              .trackCaptain;


          try {

            const snapshot =
              await getDoc(
                doc(
                  db,
                  "rides",
                  rideId
                )
              );


            if (!snapshot.exists()) {

              msg(
                "الرحلة غير موجودة.",
                "error"
              );

              return;
            }


            openTracking({
              id:
                snapshot.id,

              ...snapshot.data()
            });

          } catch (error) {

            console.error(
              error
            );

            msg(
              "تعذر فتح خريطة الرحلة.",
              "error"
            );
          }
        };
    });


  document
    .querySelectorAll(
      "[data-arrived]"
    )
    .forEach((button) => {

      button.onclick =
        async () => {

          const rideId =
            button.dataset
              .arrived;


          try {

            let currentLocation =
              null;


            try {

              const point =
                await exactLocation();


              currentLocation = {

                lat:
                  point.lat,

                lng:
                  point.lng
              };

            } catch (locationError) {

              console.warn(
                "ARRIVED GPS ERROR:",
                locationError
              );
            }


            await updateDoc(
              doc(
                db,
                "rides",
                rideId
              ),
              {

                status:
                  "arrived",

                ...(currentLocation
                  ? {
                      captainLocation:
                        currentLocation
                    }
                  : {}),

                arrivedAt:
                  serverTimestamp(),

                updatedAt:
                  serverTimestamp()
              }
            );


            await stopCaptainLocationTracking();


            msg(
              "تم تسجيل وصولك للعميل 📍",
              "success"
            );

          } catch (error) {

            console.error(
              "ARRIVED ERROR:",
              error
            );

            msg(
              "تعذر تسجيل الوصول.",
              "error"
            );
          }
        };
    });


  document
    .querySelectorAll(
      "[data-start]"
    )
    .forEach((button) => {

      button.onclick =
        async () => {

          const rideId =
            button.dataset
              .start;


          try {

            const trackingStarted =
              await startCaptainLocationTracking(
                rideId
              );


            if (!trackingStarted) {
              return;
            }


            await updateDoc(
              doc(
                db,
                "rides",
                rideId
              ),
              {

                status:
                  "started",

                startedAt:
                  serverTimestamp(),

                updatedAt:
                  serverTimestamp()
              }
            );


            msg(
              "بدأت الرحلة إلى الوجهة 🛣️",
              "success"
            );


            const snapshot =
              await getDoc(
                doc(
                  db,
                  "rides",
                  rideId
                )
              );


            if (snapshot.exists()) {

              openTracking({
                id:
                  snapshot.id,

                ...snapshot.data()
              });
            }

          } catch (error) {

            console.error(
              "START RIDE ERROR:",
              error
            );


            msg(
              "تعذر بدء الرحلة.",
              "error"
            );
          }
        };
    });


  document
    .querySelectorAll(
      "[data-complete]"
    )
    .forEach((button) => {

      button.onclick =
        async () => {

          const rideId =
            button.dataset
              .complete;


          try {

            await updateDoc(
              doc(
                db,
                "rides",
                rideId
              ),
              {

                status:
                  "completed",

                completedAt:
                  serverTimestamp(),

                updatedAt:
                  serverTimestamp()
              }
            );


            if (
              activeTrackingRideId ===
              rideId
            ) {

              await stopCaptainLocationTracking();
            }


            msg(
              "تم إنهاء الرحلة بنجاح 🏁",
              "success"
            );

          } catch (error) {

            console.error(
              "COMPLETE RIDE ERROR:",
              error
            );


            msg(
              "تعذر إنهاء الرحلة.",
              "error"
            );
          }
        };
    });
}


/* =========================================================
   ACCEPT RIDE
   ========================================================= */

async function acceptRide(id) {

  if (
    !user ||
    profile?.role !== "captain"
  ) {
    return;
  }


  try {

    await runTransaction(
      db,
      async (transaction) => {

        const rideRef =
          doc(
            db,
            "rides",
            id
          );


        const snapshot =
          await transaction.get(
            rideRef
          );


        if (
          !snapshot.exists() ||
          snapshot.data().status !==
            "open"
        ) {

          throw Error(
            "الرحلة اتقبلت بالفعل"
          );
        }


        const ride =
          snapshot.data();


        transaction.update(
          rideRef,
          {

            status:
              "accepted",

            captainId:
              user.uid,

            captainName:
              profile.name || "",

            captainPhoto:
              profile.photoURL || "",

            captainPhone:
              profile.phone ||
              user.phoneNumber ||
              "",

            captainCarType:
              profile.carType ||
              "",

            captainCarModel:
              profile.carModel ||
              "",

            captainPlateNumber:
              profile.plateNumber ||
              "",

            originalPrice:
              Number(
                ride.originalPrice ??
                ride.price ??
                0
              ),

            agreedPrice:
              Number(
                ride.price || 0
              ),

            acceptedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );
      }
    );


    msg(
      "تم قبول الرحلة. رقم العميل ظهر لك 📞",
      "success"
    );


    loadCaptain();

  } catch (error) {

    console.error(error);

    msg(
      error.message ||
        "تعذر قبول الرحلة",
      "error"
    );
  }
}


/* =========================================================
   CAPTAIN AVAILABILITY
   ========================================================= */

$("#captainAvailable").onclick =
  async () => {

    if (
      profile?.role !== "captain"
    ) {
      return;
    }


    await updateDoc(
      doc(
        db,
        "users",
        user.uid
      ),
      {
        captainStatus:
          "available"
      }
    );


    profile.captainStatus =
      "available";


    loadCaptain();
  };


$("#captainUnavailable").onclick =
  async () => {

    if (
      profile?.role !== "captain"
    ) {
      return;
    }


    await updateDoc(
      doc(
        db,
        "users",
        user.uid
      ),
      {
        captainStatus:
          "unavailable"
      }
    );


    profile.captainStatus =
      "unavailable";


    loadCaptain();
  };


/* =========================================================
   NAVIGATION
   ========================================================= */

$("#navHome").onclick =
  () => {

    if (
      profile?.role === "captain"
    ) {

      screen("captain");

    } else {

      screen("home");
    }
  };


$("#navRides").onclick =
  () => {

    if (
      profile?.role !== "customer"
    ) {

      msg(
        "رحلاتي هنا للعميل.",
        "error"
      );

      return;
    }


    screen("rides");

    loadCustomerRides();
  };


$("#navCaptain").onclick =
  () => {

    if (
      profile?.role !== "captain"
    ) {

      msg(
        "صفحة الكابتن للحسابات المسجلة ككابتن فقط.",
        "error"
      );

      return;
    }


    screen("captain");

    loadCaptain();
  };


$("#navProfile").onclick =
  async () => {

    await loadProfile();

    screen("profile");
  };


$("#profileTop").onclick =
  async () => {

    await loadProfile();

    screen("profile");
  };


/* =========================================================
   LOGOUT
   ========================================================= */

$("#logout").onclick =
  async () => {

    if (watchRides) {
      watchRides();
      watchRides = null;
    }


    if (watchCustomer) {
      watchCustomer();
      watchCustomer = null;
    }


    if (watchCaptainAccepted) {
      watchCaptainAccepted();
      watchCaptainAccepted = null;
    }


    if (trackingRideUnsubscribe) {

      trackingRideUnsubscribe();

      trackingRideUnsubscribe =
        null;
    }


    await stopCaptainLocationTracking();


    await signOut(auth);


    user = null;

    profile = null;

    pickup = null;

    destination = null;

    activeTrackingRideId = null;

    screen("login");
  };


/* =========================================================
   AUTH STATE
   ========================================================= */

onAuthStateChanged(
  auth,
  async (firebaseUser) => {

    if (authBusy) {
      return;
    }


    user = firebaseUser;


    if (!firebaseUser) {

      await stopCaptainLocationTracking();


      if (trackingRideUnsubscribe) {

        trackingRideUnsubscribe();

        trackingRideUnsubscribe =
          null;
      }


      profile = null;

      screen("login");

      return;
    }


    try {

      await loadProfile();


      if (
        profile?.role === "captain"
      ) {

        screen("captain");

        loadCaptain();

      } else if (
        profile?.role === "customer"
      ) {

        screen("home");

        loadCustomerRides();

      } else {

        await signOut(auth);

        user = null;

        profile = null;

        screen("login");
      }

    } catch (error) {

      console.error(
        "AUTH STATE ERROR:",
        error
      );

      await signOut(auth);

      user = null;

      profile = null;

      screen("login");
    }
  }
);


/* =========================================================
   INITIAL SCREEN
   ========================================================= */

screen("login");
